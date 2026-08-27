/**
 * Rate-limit and quota tracking.
 *
 * Running NEXUS entirely on free tiers (ADR 0011) makes this structural rather
 * than optional. Every free tier is capped differently -- some per minute, some
 * per day, some by tokens -- so no single provider can serve the system. The
 * router has to know which provider can take a request *right now* and route
 * around the ones that cannot.
 *
 * Two design choices worth naming:
 *
 * 1. **Windows are rolling, not calendar-aligned.** Vendors differ on when a
 *    daily quota resets and rarely document it precisely. A rolling window is
 *    the conservative reading: it may hold a provider back slightly longer than
 *    strictly necessary, but it will not let the system walk into a 429 by
 *    assuming a reset that has not happened.
 *
 * 2. **An attempt is recorded before dispatch, not after.** The provider counts
 *    a request whether or not it succeeds, so counting only successes would
 *    drift below the real usage and overrun the limit.
 */
import { type Clock, systemClock } from '../clock.ts';
import type { ProviderId } from '../ids.ts';

export interface ProviderLimits {
  readonly requestsPerMinute?: number;
  readonly requestsPerDay?: number;
  readonly tokensPerDay?: number;
}

export type LimitReason = 'requestsPerMinute' | 'requestsPerDay' | 'tokensPerDay' | 'backoff';

export interface ProviderLimitStatus {
  readonly available: boolean;
  readonly reason?: LimitReason;
  /** Epoch ms when the provider is expected to become available again. */
  readonly retryAtMs?: number;
  readonly usage: {
    readonly requestsLastMinute: number;
    readonly requestsLastDay: number;
    readonly tokensLastDay: number;
  };
}

export interface LimitTracker {
  /** Whether the provider can take a request right now. */
  available(provider: ProviderId): boolean;
  status(provider: ProviderId): ProviderLimitStatus;
  /** Record a request about to be dispatched. */
  recordAttempt(provider: ProviderId): void;
  /** Record tokens once a response reports them. */
  recordTokens(provider: ProviderId, tokens: number): void;
  /** Record a 429. `retryAfterMs` comes from the provider when it supplies it. */
  recordRateLimited(provider: ProviderId, retryAfterMs?: number): void;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
/** Used when a provider returns 429 without a Retry-After header. */
const DEFAULT_BACKOFF_MS = 60_000;

interface ProviderState {
  requests: number[];
  tokens: { at: number; count: number }[];
  backoffUntil: number;
}

export interface CreateLimitTrackerParams {
  /** Per-provider limits. A provider with no entry is treated as unlimited. */
  readonly limits?: Readonly<Partial<Record<string, ProviderLimits>>>;
  readonly clock?: Clock;
}

export function createLimitTracker(params: CreateLimitTrackerParams = {}): LimitTracker {
  const clock = params.clock ?? systemClock;
  const limits = params.limits ?? {};
  const states = new Map<string, ProviderState>();

  const EMPTY: ProviderState = { requests: [], tokens: [], backoffUntil: 0 };

  /** Read-only view. A query must not allocate: `status()` is called for every
   *  provider on every routing decision, and allocating there would grow the
   *  map with entries for providers that never took a request. */
  const peek = (provider: ProviderId): ProviderState => states.get(provider) ?? EMPTY;

  /** Write path. Only called when something is actually being recorded. */
  const stateOf = (provider: ProviderId): ProviderState => {
    const existing = states.get(provider);
    if (existing) return existing;
    const fresh: ProviderState = { requests: [], tokens: [], backoffUntil: 0 };
    states.set(provider, fresh);
    return fresh;
  };

  /** Drops entries that have aged out of the widest window we track. */
  const prune = (state: ProviderState, now: number): void => {
    const dayAgo = now - DAY_MS;
    state.requests = state.requests.filter((at) => at > dayAgo);
    state.tokens = state.tokens.filter((t) => t.at > dayAgo);
  };

  function status(provider: ProviderId): ProviderLimitStatus {
    const now = clock.now().getTime();
    const state = peek(provider);

    const limit = limits[provider] ?? {};
    const minuteAgo = now - MINUTE_MS;
    const dayAgo = now - DAY_MS;
    // Ageing is applied to the read rather than by mutating here, so a query
    // stays a query. The write path prunes for real.
    const inDay = state.requests.filter((at) => at > dayAgo);
    const requestsLastMinute = inDay.filter((at) => at > minuteAgo).length;
    const requestsLastDay = inDay.length;
    const tokensLastDay = state.tokens
      .filter((t) => t.at > dayAgo)
      .reduce((sum, t) => sum + t.count, 0);
    const usage = { requestsLastMinute, requestsLastDay, tokensLastDay };

    if (state.backoffUntil > now) {
      return { available: false, reason: 'backoff', retryAtMs: state.backoffUntil, usage };
    }

    if (limit.requestsPerMinute !== undefined && requestsLastMinute >= limit.requestsPerMinute) {
      // Available again once the oldest request in the window ages out.
      const oldest = inDay.filter((at) => at > minuteAgo)[0];
      return {
        available: false,
        reason: 'requestsPerMinute',
        ...(oldest !== undefined ? { retryAtMs: oldest + MINUTE_MS } : {}),
        usage,
      };
    }

    if (limit.requestsPerDay !== undefined && requestsLastDay >= limit.requestsPerDay) {
      const oldest = inDay[0];
      return {
        available: false,
        reason: 'requestsPerDay',
        ...(oldest !== undefined ? { retryAtMs: oldest + DAY_MS } : {}),
        usage,
      };
    }

    if (limit.tokensPerDay !== undefined && tokensLastDay >= limit.tokensPerDay) {
      const oldest = state.tokens.filter((t) => t.at > dayAgo)[0];
      return {
        available: false,
        reason: 'tokensPerDay',
        ...(oldest !== undefined ? { retryAtMs: oldest.at + DAY_MS } : {}),
        usage,
      };
    }

    return { available: true, usage };
  }

  return {
    status,
    available: (provider) => status(provider).available,

    recordAttempt(provider) {
      const now = clock.now().getTime();
      const state = stateOf(provider);
      state.requests.push(now);
      prune(state, now);
    },

    recordTokens(provider, tokens) {
      if (tokens <= 0) return;
      const now = clock.now().getTime();
      const state = stateOf(provider);
      state.tokens.push({ at: now, count: tokens });
      prune(state, now);
    },

    recordRateLimited(provider, retryAfterMs) {
      const now = clock.now().getTime();
      const state = stateOf(provider);
      // Trust the provider's own Retry-After when it gives one; it knows its
      // window better than any local estimate.
      state.backoffUntil = Math.max(state.backoffUntil, now + (retryAfterMs ?? DEFAULT_BACKOFF_MS));
    },
  };
}

/** A tracker that never holds anything back. Default when no limits are configured. */
export function unlimitedTracker(): LimitTracker {
  return {
    available: () => true,
    status: () => ({
      available: true,
      usage: { requestsLastMinute: 0, requestsLastDay: 0, tokensLastDay: 0 },
    }),
    recordAttempt: () => {},
    recordTokens: () => {},
    recordRateLimited: () => {},
  };
}
