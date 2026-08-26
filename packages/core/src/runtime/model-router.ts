/**
 * Capability-based model router.
 *
 * Selection is: filter candidates by the policy, order by preference, then try
 * them in order when fallback is allowed. Agents express intent; this file
 * turns intent into a vendor choice. No agent or skill ever names a provider.
 *
 * Unconfigured providers (no API key) are excluded from candidacy rather than
 * being called and failing -- that is what "fail safely" means here.
 */
import { type Result, ok, err } from '../result.ts';
import { nexusError, fromUnknown } from '../errors.ts';
import type { ProviderRegistry } from '../registry/registries.ts';
import type {
  ModelRouter,
  ModelSelection,
  ModelSelectionPolicy,
  RoutedGenerationRequest,
} from '../contracts/model-router.ts';
import type {
  GenerationResponse,
  ModelDescriptor,
  ModelProvider,
} from '../contracts/model-provider.ts';
import type { Logger } from '../logger.ts';
import { nullLogger } from '../logger.ts';
import { type LimitTracker, unlimitedTracker } from './limits.ts';

interface Candidate {
  readonly model: ModelDescriptor;
  readonly provider: ModelProvider;
}

function satisfies(model: ModelDescriptor, policy: ModelSelectionPolicy): boolean {
  const hasCapabilities = policy.requiredCapabilities.every((capability) =>
    model.capabilities.includes(capability),
  );
  if (!hasCapabilities) return false;
  if (policy.minContextWindow !== undefined && model.contextWindow < policy.minContextWindow) {
    return false;
  }
  if (policy.maxInputCostPer1k !== undefined) {
    if (model.inputCostPer1k === undefined) return false;
    if (model.inputCostPer1k > policy.maxInputCostPer1k) return false;
  }
  return true;
}

/** Lower sorts first. Explicit model preference beats provider preference. */
function rank(candidate: Candidate, policy: ModelSelectionPolicy): number {
  const modelIndex = policy.preferredModels?.indexOf(candidate.model.id) ?? -1;
  if (modelIndex >= 0) return modelIndex;
  const providerIndex = policy.preferredProviders?.indexOf(candidate.provider.id) ?? -1;
  if (providerIndex >= 0) return 1_000 + providerIndex;
  return 1_000_000;
}

export interface ModelRouterOptions {
  readonly logger?: Logger;
  /**
   * Excludes providers that are at their rate limit or daily quota. Omitted
   * means no limits are enforced -- correct for tests and for paid tiers with
   * headroom, wrong for the free tiers NEXUS actually runs on (ADR 0011).
   */
  readonly limits?: LimitTracker;
}

export function createModelRouter(
  providers: ProviderRegistry,
  options: ModelRouterOptions = {},
): ModelRouter {
  const logger = options.logger ?? nullLogger;
  const limits = options.limits ?? unlimitedTracker();
  async function candidates(policy: ModelSelectionPolicy): Promise<Result<Candidate[]>> {
    const configured = providers.list().filter((provider) => provider.isConfigured());
    if (configured.length === 0) {
      return err(
        nexusError('NOT_CONFIGURED', 'no model provider is registered and configured', {
          details: { registered: providers.list().map((provider) => provider.id) },
        }),
      );
    }

    // A provider at its limit is excluded from candidacy rather than called and
    // failed: spending a request to learn it is rate limited wastes the very
    // allowance being protected.
    const withinLimits = configured.filter((provider) => limits.available(provider.id));
    if (withinLimits.length === 0) {
      const blocked = configured.map((provider) => {
        const status = limits.status(provider.id);
        return {
          provider: provider.id,
          reason: status.reason,
          ...(status.retryAtMs !== undefined ? { retryAtMs: status.retryAtMs } : {}),
        };
      });
      const soonest = blocked
        .map((b) => b.retryAtMs)
        .filter((t): t is number => t !== undefined)
        .sort((a, b) => a - b)[0];
      return err(
        nexusError('RATE_LIMITED', 'every configured provider is at its rate limit or quota', {
          details: { blocked, ...(soonest !== undefined ? { retryAtMs: soonest } : {}) },
        }),
      );
    }

    const found: Candidate[] = [];
    for (const provider of withinLimits) {
      const models = await provider.listModels();
      if (!models.ok) {
        logger.log('warn', 'provider could not list models; skipping', {
          provider: provider.id,
          error: models.error.message,
        });
        continue;
      }
      for (const model of models.value) {
        if (satisfies(model, policy)) found.push({ model, provider });
      }
    }

    if (found.length === 0) {
      return err(
        nexusError('PROVIDER_UNAVAILABLE', 'no configured model satisfies the selection policy', {
          details: {
            requiredCapabilities: policy.requiredCapabilities,
            ...(policy.minContextWindow !== undefined
              ? { minContextWindow: policy.minContextWindow }
              : {}),
          },
        }),
      );
    }

    return ok(found.sort((a, b) => rank(a, policy) - rank(b, policy)));
  }

  return {
    async route(policy): Promise<Result<ModelSelection>> {
      const found = await candidates(policy);
      if (!found.ok) return found;
      const [first, ...rest] = found.value;
      if (!first) {
        return err(nexusError('PROVIDER_UNAVAILABLE', 'no candidate models after ranking'));
      }
      return ok({
        model: first.model,
        provider: first.provider.id,
        fallbacks: rest.map((candidate) => candidate.model),
      });
    },

    async generate(policy, request: RoutedGenerationRequest): Promise<Result<GenerationResponse>> {
      const found = await candidates(policy);
      if (!found.ok) return found;

      const attempts = policy.allowFallback === true ? found.value : found.value.slice(0, 1);
      let lastError = nexusError('PROVIDER_UNAVAILABLE', 'no model attempt was made');

      for (const candidate of attempts) {
        // Counted before dispatch: the provider counts the request whether or
        // not it succeeds.
        limits.recordAttempt(candidate.provider.id);

        try {
          const response = await candidate.provider.generate({
            ...request,
            model: candidate.model.id,
          });
          if (response.ok) {
            limits.recordTokens(
              candidate.provider.id,
              response.value.usage.inputTokens + response.value.usage.outputTokens,
            );
            return response;
          }
          lastError = response.error;
        } catch (cause) {
          // A provider adapter that throws is a broken adapter; contain it so
          // one bad vendor cannot take down the run.
          lastError = fromUnknown(cause, 'PROVIDER_UNAVAILABLE');
        }

        if (lastError.code === 'RATE_LIMITED') {
          // The provider knows its own window better than any local estimate,
          // so its Retry-After wins when it supplies one.
          const retryAfterMs = lastError.details?.['retryAfterMs'];
          limits.recordRateLimited(
            candidate.provider.id,
            typeof retryAfterMs === 'number' ? retryAfterMs : undefined,
          );
        }

        logger.log('warn', 'model attempt failed', {
          provider: candidate.provider.id,
          model: candidate.model.id,
          error: lastError.message,
        });
      }

      return err(lastError);
    },
  };
}
