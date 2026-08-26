/**
 * Google Gemini adapter, native `generateContent` protocol.
 *
 * Zero dependencies. `fetch` is injectable so the adapter is fully testable
 * without a network or a credential.
 *
 * As with the OpenAI-compatible adapter, model descriptors come from
 * configuration. This package will not invent context windows, output caps or
 * pricing -- those are facts about Google's current offering that it cannot
 * know, and guessing them would be fabricated data.
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

/** Default endpoint. Overridable through configuration. */
export const GOOGLE_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GoogleProviderOptions {
  readonly id?: string | undefined;
  readonly displayName?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly apiKey?: string | undefined;
  /** Required: the adapter does not guess model specifications. */
  readonly models: readonly ModelDescriptor[];
  readonly timeoutMs?: number | undefined;
  readonly fetch?: FetchLike | undefined;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function httpError(status: number, body: string, retryAfter?: string | null) {
  const detail = body.slice(0, 500);
  if (status === 400 && /API key not valid/i.test(body)) {
    return nexusError('NOT_CONFIGURED', 'credential rejected by Google', { details: { status } });
  }
  if (status === 401) {
    return nexusError('NOT_CONFIGURED', 'credential rejected by Google', { details: { status } });
  }
  if (status === 403) {
    return nexusError('PERMISSION_DENIED', 'Google refused the request', { details: { status, detail } });
  }
  if (status === 404) {
    return nexusError('NOT_FOUND', 'model or endpoint not found', { details: { status, detail } });
  }
  if (status === 429) {
    const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
    return nexusError('RATE_LIMITED', 'Google rate limit reached', {
      details: { status, ...(Number.isFinite(seconds) ? { retryAfterMs: seconds * 1_000 } : {}) },
    });
  }
  if (status >= 500) {
    return nexusError('PROVIDER_UNAVAILABLE', `Google returned ${status}`, { details: { status, detail } });
  }
  return nexusError('INVALID_INPUT', `Google rejected the request (${status})`, {
    details: { status, detail },
  });
}

export function createGoogleProvider(options: GoogleProviderOptions): ModelProvider {
  const name = options.id ?? 'google';
  const id: ProviderId = toProviderId(name);
  const baseUrl = options.baseUrl ?? GOOGLE_DEFAULT_BASE_URL;
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const isConfigured = (): boolean => (options.apiKey ?? '').trim() !== '';

  async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<Result<T>> {
    if (signal?.aborted) return err(nexusError('CANCELLED', 'request aborted before dispatch'));

    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Header rather than a ?key= query parameter: query strings end up in
          // proxy logs and browser history.
          'x-goog-api-key': options.apiKey ?? '',
        },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (cause) {
      if (signal?.aborted) return err(nexusError('CANCELLED', 'request aborted', { cause }));
      if (timeout.aborted) {
        return err(nexusError('TIMEOUT', `Google did not respond within ${timeoutMs}ms`, { cause }));
      }
      return err(nexusError('PROVIDER_UNAVAILABLE', 'could not reach Google', { cause }));
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return err(httpError(response.status, text, response.headers.get('retry-after')));
    }

    try {
      return ok((await response.json()) as T);
    } catch (cause) {
      return err(nexusError('PROVIDER_UNAVAILABLE', 'Google returned malformed JSON', { cause }));
    }
  }

  return {
    id,
    displayName: options.displayName ?? 'Google Gemini',
    isConfigured,

    async listModels(): Promise<Result<readonly ModelDescriptor[]>> {
      return ok(options.models);
    },

    async generate(request: GenerationRequest): Promise<Result<GenerationResponse>> {
      if (!isConfigured()) {
        return err(
          nexusError('NOT_CONFIGURED', `provider '${name}' has no credential configured`, {
            details: { provider: name },
          }),
        );
      }

      // The model is addressed in the URL path, not the body.
      const wire = await post<WireResponse>(
        `/models/${encodeURIComponent(request.model)}:generateContent`,
        toWireRequest(request),
        request.signal,
      );
      if (!wire.ok) return wire;

      // A prompt blocked before generation returns no candidates at all. That is
      // a content decision, not an empty answer, and must not look like one.
      const blockReason = wire.value.promptFeedback?.blockReason;
      if (blockReason !== undefined) {
        return err(
          nexusError('UNSUPPORTED', `prompt blocked by Google: ${blockReason}`, {
            details: { blockReason },
          }),
        );
      }

      const candidate = wire.value.candidates?.[0];
      if (!candidate) {
        return err(nexusError('PROVIDER_UNAVAILABLE', 'Google returned no candidates'));
      }

      const content = toContentParts(candidate.content?.parts);
      const hasToolCalls = content.some((part) => part.type === 'tool_call');

      return ok({
        model: request.model,
        provider: id,
        content,
        stopReason: toStopReason(candidate.finishReason, hasToolCalls),
        usage: {
          inputTokens: wire.value.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: wire.value.usageMetadata?.candidatesTokenCount ?? 0,
        },
        raw: wire.value,
      });
    },

    async embed(request: EmbeddingRequest): Promise<Result<EmbeddingResponse>> {
      if (!isConfigured()) {
        return err(nexusError('NOT_CONFIGURED', `provider '${name}' has no credential configured`));
      }
      const wire = await post<{ embeddings?: { values?: number[] }[] }>(
        `/models/${encodeURIComponent(request.model)}:batchEmbedContents`,
        {
          requests: request.input.map((text) => ({
            model: `models/${request.model}`,
            content: { parts: [{ text }] },
          })),
        },
      );
      if (!wire.ok) return wire;
      return ok({
        model: request.model,
        vectors: (wire.value.embeddings ?? []).map((e) => e.values ?? []),
        // Google does not report token usage for embeddings.
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    },

    async health(): Promise<HealthReport> {
      const checkedAt = new Date().toISOString();
      if (!isConfigured()) {
        return {
          component: `provider:${name}`,
          status: 'unavailable',
          checkedAt,
          detail: 'no credential configured',
        };
      }
      // Not probed: the free tier charges for every request and health is polled
      // often. Real failures surface through generate() and feed the router.
      return {
        component: `provider:${name}`,
        status: 'healthy',
        checkedAt,
        detail: `configured; ${options.models.length} model(s) declared`,
      };
    },
  };
}
