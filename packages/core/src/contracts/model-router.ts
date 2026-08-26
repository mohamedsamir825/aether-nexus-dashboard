/**
 * The Model Router is the only thing agents talk to. An agent states what it
 * needs (a policy); the router decides which provider and model satisfies it.
 * Consequently, switching or adding a vendor is a configuration change.
 */
import type { Result } from '../result.ts';
import type { ModelId, ProviderId } from '../ids.ts';
import type {
  GenerationRequest,
  GenerationResponse,
  ModelCapability,
  ModelDescriptor,
} from './model-provider.ts';

export interface ModelSelectionPolicy {
  /** A candidate model must advertise all of these. */
  readonly requiredCapabilities: readonly ModelCapability[];
  /** Tried in order before any other candidate. */
  readonly preferredModels?: readonly ModelId[];
  readonly preferredProviders?: readonly ProviderId[];
  readonly minContextWindow?: number;
  readonly maxInputCostPer1k?: number;
  /** When false, a failure of the first choice is returned, not retried. */
  readonly allowFallback?: boolean;
}

export interface ModelSelection {
  readonly model: ModelDescriptor;
  readonly provider: ProviderId;
  /** Ordered remaining candidates, used when allowFallback is set. */
  readonly fallbacks: readonly ModelDescriptor[];
}

/** Request with `model` omitted -- the router fills it in from the policy. */
export type RoutedGenerationRequest = Omit<GenerationRequest, 'model'>;

export interface ModelRouter {
  /** Resolve a policy to a concrete model without calling it. */
  route(policy: ModelSelectionPolicy): Promise<Result<ModelSelection>>;
  /** Resolve and invoke, applying fallback when the policy permits it. */
  generate(
    policy: ModelSelectionPolicy,
    request: RoutedGenerationRequest,
  ): Promise<Result<GenerationResponse>>;
}
