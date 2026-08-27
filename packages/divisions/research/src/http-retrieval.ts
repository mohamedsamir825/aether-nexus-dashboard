/**
 * The HTTP retriever -- the division's first route to the live internet.
 *
 * It implements the existing `SourceRetriever` interface and nothing else. No
 * second retrieval path exists, and the tool, permission, budget and event
 * machinery above it is unchanged: from the ToolBelt's point of view this is
 * the same corpus read it has always performed.
 *
 * ## It does not discover, and that is the design
 *
 * `discover(query)` presumes a known corpus. A web retriever cannot turn a
 * question into URLs without a search engine, so this one does not try: it is
 * given the sources its owner chose, and ranks that list by term overlap with
 * no network access at all. Only `retrieve()` makes a request.
 *
 * That keeps it inside the interface without bending it, and it is also the
 * safer posture -- there is no path by which a retrieved document can cause the
 * next fetch. Crawling is not "not implemented yet"; it is refused.
 *
 * ## Every fetch is bounded before it starts
 *
 * A URL guard that fails closed, a request timeout, a byte cap enforced while
 * the body streams rather than after it arrives, and a rolling-window rate
 * limit. A retriever that can be made to hang or to allocate without bound is a
 * denial-of-service primitive handed to whoever writes the source list.
 */
import {
  type LimitTracker,
  type ProviderLimits,
  type Result,
  createLimitTracker,
  err,
  nexusError,
  ok,
  providerId,
} from '@nexus/core';
import type { RetrievedContent, SourceRef } from './types.ts';
import { type SourceRetriever, contentHashBytes, relevanceScore } from './retrieval.ts';
import { normalizePublicHttpUrl } from './url-guard.ts';

/** Just the part of `fetch` this needs, so tests never touch the network. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpRetrieverOptions {
  /**
   * The sources the owner chose. Nothing else is reachable, and this list is
   * never extended at runtime by anything a retrieved document says.
   */
  readonly sources: readonly SourceRef[];
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
  /**
   * Rate limiting. Reuses the Core's rolling-window tracker rather than adding
   * a second limiter with its own bugs.
   */
  readonly limits?: LimitTracker;
  readonly perHostLimits?: ProviderLimits;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  /**
   * Optional reader service, as a template containing `{url}` (for example
   * `https://r.jina.ai/{url}`). Off by default: a reader service learns every
   * page its user reads, and its output is a rendering rather than the source.
   * When set, the transformation is recorded on the result, never hidden.
   */
  readonly readerService?: string;
  /** Redirects to follow, each re-checked against the URL guard. */
  readonly maxRedirects?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_MAX_REDIRECTS = 3;
/** Conservative enough to be a good citizen on someone else's server. */
const DEFAULT_HOST_LIMITS: ProviderLimits = { requestsPerMinute: 20, requestsPerDay: 1_000 };

/** Rate limits are per host: one slow site must not starve the others. */
function hostKey(url: URL) {
  return providerId(`web:${url.hostname.toLowerCase()}`);
}

interface FetchedBytes {
  readonly bytes: Uint8Array;
  readonly finalUrl: URL;
}

/**
 * Reads a body with the cap enforced *during* streaming.
 *
 * Checking `Content-Length` is not enough -- it is a claim by the server, and
 * a hostile or misconfigured one can omit it or lie. Reading first and
 * measuring afterwards is exactly the allocation the cap exists to prevent, so
 * the read stops the moment the budget is exceeded.
 */
async function readCapped(response: Response, maxBytes: number): Promise<Result<Uint8Array>> {
  const body = response.body;
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      return err(nexusError('UNSUPPORTED', `response exceeds ${maxBytes} bytes`));
    }
    return ok(buffer);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        return err(
          nexusError('UNSUPPORTED', `response exceeds ${maxBytes} bytes`, {
            details: { maxBytes },
          }),
        );
      }
      chunks.push(value);
    }
  } catch (cause) {
    return err(nexusError('PROVIDER_UNAVAILABLE', 'the response body could not be read', { cause }));
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return ok(out);
}

export function createHttpRetriever(options: HttpRetrieverOptions): SourceRetriever {
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  // The tracker treats an unlisted key as unlimited, so every host the owner
  // configured is registered up front. Hosts are known in advance precisely
  // because this retriever does not discover new ones.
  const perHost = options.perHostLimits ?? DEFAULT_HOST_LIMITS;
  const configured: Record<string, ProviderLimits> = {};
  for (const source of options.sources) {
    const parsed = normalizePublicHttpUrl(source.locator);
    if (parsed.ok) configured[hostKey(parsed.value)] = perHost;
  }
  const limits = options.limits ?? createLimitTracker({ limits: configured });

  /** Applies the reader service, if one is configured. */
  const target = (url: URL): string =>
    options.readerService === undefined
      ? url.toString()
      : options.readerService.replace('{url}', url.toString());

  const fetchOnce = async (url: URL, redirectsLeft: number): Promise<Result<FetchedBytes>> => {
    const key = hostKey(url);
    if (!limits.available(key)) {
      const status = limits.status(key);
      return err(
        nexusError('RATE_LIMITED', `rate limit reached for ${url.hostname}`, {
          details: { host: url.hostname, reason: status.reason, retryAtMs: status.retryAtMs },
        }),
      );
    }
    // Recorded before dispatch: the request counts whether or not it succeeds.
    limits.recordAttempt(key);

    let response: Response;
    try {
      response = await doFetch(target(url), {
        method: 'GET',
        // Manual, so every hop is re-checked by the URL guard. Letting fetch
        // follow redirects would make the guard decorative -- a public URL that
        // 302s to 169.254.169.254 is the standard way past a URL allowlist.
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'text/html, text/plain, text/markdown;q=0.9, */*;q=0.1' },
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && /abort|timeout/i.test(cause.name + cause.message);
      return err(
        nexusError(timedOut ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE', `request to ${url.hostname} failed`, {
          cause,
          details: { host: url.hostname, timeoutMs },
        }),
      );
    }

    if (response.status === 429) {
      const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
      limits.recordRateLimited(key, Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined);
      return err(nexusError('RATE_LIMITED', `${url.hostname} returned 429`));
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null) {
        return err(nexusError('PROVIDER_UNAVAILABLE', 'redirect without a location header'));
      }
      if (redirectsLeft <= 0) {
        return err(nexusError('UNSUPPORTED', 'too many redirects'));
      }
      // Resolved against the URL that was actually FETCHED, which differs from
      // `url` whenever a reader service is in play -- resolving a relative
      // Location against the origin URL would silently aim at the wrong host.
      let next: string;
      try {
        next = new URL(location, target(url)).toString();
      } catch {
        return err(nexusError('PROVIDER_UNAVAILABLE', 'redirect location is malformed'));
      }
      const checked = normalizePublicHttpUrl(next);
      if (!checked.ok) return checked;
      return fetchOnce(checked.value, redirectsLeft - 1);
    }

    if (!response.ok) {
      return err(
        nexusError(response.status === 404 ? 'NOT_FOUND' : 'PROVIDER_UNAVAILABLE', `HTTP ${response.status}`, {
          details: { status: response.status, host: url.hostname },
        }),
      );
    }

    const bytes = await readCapped(response, maxBytes);
    if (!bytes.ok) return bytes;
    return ok({ bytes: bytes.value, finalUrl: url });
  };

  return {
    async discover(query, limit) {
      // No network. Ranking the owner's own list is not a web search, and this
      // is the boundary that keeps it from becoming one.
      const ranked = options.sources
        .map((source) => ({
          source,
          score: relevanceScore(query, `${source.title} ${source.locator}`),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id))
        .slice(0, limit)
        .map((entry) => entry.source);
      return ok(ranked);
    },

    async retrieve(ref) {
      const checked = normalizePublicHttpUrl(ref.locator);
      if (!checked.ok) return checked;

      const fetched = await fetchOnce(checked.value, maxRedirects);
      if (!fetched.ok) return fetched;

      // Decoded for reading, hashed as received. The hash attests to the bytes
      // that arrived, so a later re-fetch compares like with like.
      const text = new TextDecoder('utf-8').decode(fetched.value.bytes);

      const finalLocator = fetched.value.finalUrl.toString();
      const content: RetrievedContent = {
        source: ref,
        text,
        retrievedAt: now().toISOString(),
        contentHash: contentHashBytes(fetched.value.bytes),
        ...(options.readerService !== undefined ? { via: options.readerService } : {}),
        // Only when a redirect actually moved it. Recording it unconditionally
        // would add noise to every result to describe the common case.
        ...(finalLocator !== checked.value.toString() ? { finalLocator } : {}),
      };
      return ok(content);
    },
  };
}
