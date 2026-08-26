/**
 * A single ModelProvider adapter for every OpenAI-compatible endpoint.
 *
 * Groq, Cerebras, OpenRouter, Mistral, SambaNova and local runtimes all speak
 * this shape, so one adapter parameterised by base URL covers them (ADR 0011).
 *
 * Zero dependencies -- `fetch` is a runtime global, and it is injectable so the
 * adapter is fully testable without a network or a credential.
 */
import {
  type EmbeddingRequest,
  type EmbeddingResponse,
  type GenerationRequest,
  type GenerationResponse,
  type HealthReport,
  type ModelDescriptor,
  type ModelProvider,
  type ProviderId,
  type Result,
  err,
  nexusError,
  ok,
  providerId as toProviderId,
} from '@nexus/core';
import { type WireResponse, toContentParts, toStopReason, toWireRequest } from './wire.ts';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Optional fields accept an explicit `undefined` because that is what
 * configuration actually produces -- `config.providers.groq.apiKey` is
 * `string | undefined`, and forcing every caller to strip the key before
 * passing it would be ceremony with no safety gained.
 */
export interface OpenAICompatibleOptions {
  /** Registry id, e.g. 'groq'. Also used in health component names. */
  readonly id: string;
  readonly displayName?: string | undefined;
  readonly baseUrl: string;
  /** Absent means unconfigured, except for endpoints declared credential-free. */
  readonly apiKey?: string | undefined;
  /** True for local runtimes that legitimately need no credential. */
  readonly credentialOptional?: boolean | undefined;
  /**
   * The models this endpoint serves. Required: the adapter will not invent
   * context windows or pricing (see presets.ts).
   */
  readonly models: readonly ModelDescriptor[];
  readonly timeoutMs?: number | undefined;
  /** Injectable for tests. Defaults to the global fetch. */
  readonly fetch?: FetchLike | undefined;
  /** Extra headers some gateways require (e.g. OpenRouter attribution). */
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** Maps transport and HTTP failures onto the Core's error vocabulary. */
function httpError(status: number, body: string, retryAfter?: string | null) {
  const detail = body.slice(0, 500);
  if (status === 401) {
    return nexusError('NOT_CONFIGURED', 'credential rejected by provider', { details: { status } });
  }
  if (status === 403) {
    return nexusError('PERMISSION_DENIED', 'provider refused the request', { details: { status } });
  }
  if (status === 404) {
    return nexusError('NOT_FOUND', 'model or endpoint not found', { details: { status, detail } });
  }
  if (status === 429) {
    const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
    return nexusError('RATE_LIMITED', 'provider rate limit reached', {
      details: {
        status,
        ...(Number.isFinite(seconds) ? { retryAfterMs: seconds * 1_000 } : {}),
      },
    });
  }
  if (status >= 500) {
    return nexusError('PROVIDER_UNAVAILABLE', `provider returned ${status}`, {
      details: { status, detail },
    });
  }
  return nexusError('INVALID_INPUT', `provider rejected the request (${status})`, {
    details: { status, detail },
  });
}

export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): ModelProvider {
  const id: ProviderId = toProviderId(options.id);
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const isConfigured = (): boolean =>
    options.credentialOptional === true || (options.apiKey ?? '').trim() !== '';

  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
    ...options.headers,
  });

  async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<Result<T>> {
    if (signal?.aborted) {
      return err(nexusError('CANCELLED', 'request aborted before dispatch'));
    }

    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await doFetch(`${options.baseUrl}${path}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (cause) {
      // Distinguish the caller cancelling from the request timing out: one is
      // the user's choice, the other is a provider problem.
      if (signal?.aborted) return err(nexusError('CANCELLED', 'request aborted', { cause }));
      if (timeout.aborted) {
        return err(nexusError('TIMEOUT', `provider did not respond within ${timeoutMs}ms`, { cause }));
      }
      return err(
        nexusError('PROVIDER_UNAVAILABLE', 'could not reach provider', {
          details: { provider: options.id },
          cause,
        }),
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return err(httpError(response.status, text, response.headers.get('retry-after')));
    }

    try {
      return ok((await response.json()) as T);
    } catch (cause) {
      return err(nexusError('PROVIDER_UNAVAILABLE', 'provider returned malformed JSON', { cause }));
    }
  }

  return {
    id,
    displayName: options.displayName ?? options.id,
    isConfigured,

    async listModels(): Promise<Result<readonly ModelDescriptor[]>> {
      // Descriptors come from configuration, never from guesswork.
      return ok(options.models);
    },

    async generate(request: GenerationRequest): Promise<Result<GenerationResponse>> {
      if (!isConfigured()) {
        return err(
          nexusError('NOT_CONFIGURED', `provider '${options.id}' has no credential configured`, {
            details: { provider: options.id },
          }),
        );
      }

      const wire = await post<WireResponse>(
        '/chat/completions',
        toWireRequest(request),
        request.signal,
      );
      if (!wire.ok) return wire;

      const choice = wire.value.choices?.[0];
      if (!choice) {
        return err(
          nexusError('PROVIDER_UNAVAILABLE', 'provider returned no choices', {
            details: { provider: options.id },
          }),
        );
      }

      return ok({
        model: request.model,
        provider: id,
        content: toContentParts(choice.message),
        stopReason: toStopReason(choice.finish_reason),
        usage: {
          inputTokens: wire.value.usage?.prompt_tokens ?? 0,
          outputTokens: wire.value.usage?.completion_tokens ?? 0,
        },
        raw: wire.value,
      });
    },

    async embed(request: EmbeddingRequest): Promise<Result<EmbeddingResponse>> {
      if (!isConfigured()) {
        return err(
          nexusError('NOT_CONFIGURED', `provider '${options.id}' has no credential configured`),
        );
      }
      const wire = await post<{ data?: { embedding?: number[] }[]; usage?: { prompt_tokens?: number } }>(
        '/embeddings',
        { model: request.model, input: [...request.input] },
      );
      if (!wire.ok) return wire;
      return ok({
        model: request.model,
        vectors: (wire.value.data ?? []).map((d) => d.embedding ?? []),
        usage: { inputTokens: wire.value.usage?.prompt_tokens ?? 0, outputTokens: 0 },
      });
    },

    async health(): Promise<HealthReport> {
      const checkedAt = new Date().toISOString();
      if (!isConfigured()) {
        return {
          component: `provider:${options.id}`,
          status: 'unavailable',
          checkedAt,
          detail: 'no credential configured',
        };
      }
      // Reachability is deliberately NOT probed here: health is called often,
      // and free tiers charge a request for it. Status reflects configuration;
      // real failures surface through generate() and feed the router.
      return {
        component: `provider:${options.id}`,
        status: 'healthy',
        checkedAt,
        detail: `configured; ${options.models.length} model(s) declared`,
      };
    },
  };
}
