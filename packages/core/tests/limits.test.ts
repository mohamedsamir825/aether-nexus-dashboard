/**
 * Running entirely on free tiers makes limit awareness structural: no single
 * provider can serve the system, so the router must know who can take a request
 * right now.
 */
import { test, expect, describe } from 'bun:test';
import { createLimitTracker, unlimitedTracker } from '../src/runtime/limits.ts';
import { createModelRouter } from '../src/runtime/model-router.ts';
import { createProviderRegistry } from '../src/registry/registries.ts';
import { fixedClock } from '../src/clock.ts';
import { providerId } from '../src/ids.ts';
import { stubProvider } from './support/doubles.ts';
import type { Message } from '../src/contracts/model-provider.ts';

const messages: readonly Message[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
const start = () => fixedClock(new Date('2026-01-01T00:00:00Z'));
const p = providerId('free');

describe('limit tracker', () => {
  test('a provider with no configured limits is always available', () => {
    const tracker = createLimitTracker({ clock: start() });
    for (let i = 0; i < 100; i++) tracker.recordAttempt(p);
    expect(tracker.available(p)).toBe(true);
  });

  test('enforces requests per minute', () => {
    const clock = start();
    const tracker = createLimitTracker({ limits: { free: { requestsPerMinute: 2 } }, clock });

    tracker.recordAttempt(p);
    tracker.recordAttempt(p);
    expect(tracker.available(p)).toBe(false);
    expect(tracker.status(p).reason).toBe('requestsPerMinute');
  });

  test('the minute window rolls: capacity returns as the oldest call ages out', () => {
    const clock = start();
    const tracker = createLimitTracker({ limits: { free: { requestsPerMinute: 1 } }, clock });

    tracker.recordAttempt(p);
    expect(tracker.available(p)).toBe(false);

    clock.advance(59_000);
    expect(tracker.available(p)).toBe(false);

    clock.advance(2_000); // just past 60s
    expect(tracker.available(p)).toBe(true);
  });

  test('enforces requests per day independently of the minute window', () => {
    const clock = start();
    const tracker = createLimitTracker({ limits: { free: { requestsPerDay: 3 } }, clock });

    for (let i = 0; i < 3; i++) {
      tracker.recordAttempt(p);
      clock.advance(5 * 60_000); // spread out, so RPM is never the binding limit
    }
    expect(tracker.available(p)).toBe(false);
    expect(tracker.status(p).reason).toBe('requestsPerDay');
  });

  test('enforces tokens per day', () => {
    const clock = start();
    const tracker = createLimitTracker({ limits: { free: { tokensPerDay: 1_000 } }, clock });

    tracker.recordTokens(p, 600);
    expect(tracker.available(p)).toBe(true);
    tracker.recordTokens(p, 500);
    expect(tracker.available(p)).toBe(false);
    expect(tracker.status(p).reason).toBe('tokensPerDay');
  });

  test('a 429 backs the provider off for the interval it asked for', () => {
    const clock = start();
    const tracker = createLimitTracker({ clock });

    tracker.recordRateLimited(p, 30_000);
    expect(tracker.available(p)).toBe(false);
    expect(tracker.status(p).reason).toBe('backoff');

    clock.advance(29_000);
    expect(tracker.available(p)).toBe(false);
    clock.advance(2_000);
    expect(tracker.available(p)).toBe(true);
  });

  test('a 429 without Retry-After still backs off, using a default', () => {
    const clock = start();
    const tracker = createLimitTracker({ clock });
    tracker.recordRateLimited(p);
    expect(tracker.available(p)).toBe(false);
    clock.advance(61_000);
    expect(tracker.available(p)).toBe(true);
  });

  test('a longer backoff is never shortened by a later, shorter one', () => {
    const clock = start();
    const tracker = createLimitTracker({ clock });
    tracker.recordRateLimited(p, 120_000);
    tracker.recordRateLimited(p, 1_000);
    clock.advance(5_000);
    expect(tracker.available(p)).toBe(false);
  });

  test('reports when the provider is expected back', () => {
    const clock = start();
    const tracker = createLimitTracker({ limits: { free: { requestsPerMinute: 1 } }, clock });
    tracker.recordAttempt(p);
    const status = tracker.status(p);
    expect(status.retryAtMs).toBe(clock.now().getTime() + 60_000);
  });

  test('exposes usage for observability', () => {
    const clock = start();
    const tracker = createLimitTracker({ clock });
    tracker.recordAttempt(p);
    tracker.recordTokens(p, 42);
    expect(tracker.status(p).usage).toEqual({
      requestsLastMinute: 1,
      requestsLastDay: 1,
      tokensLastDay: 42,
    });
  });

  test('unlimitedTracker holds nothing back', () => {
    const tracker = unlimitedTracker();
    tracker.recordRateLimited(p, 999_999);
    expect(tracker.available(p)).toBe(true);
  });
});

describe('router under limits', () => {
  const twoProviders = () => {
    const registry = createProviderRegistry();
    registry.register(stubProvider({ id: 'primary', models: [{ id: 'p', capabilities: ['text'] }] }));
    registry.register(stubProvider({ id: 'backup', models: [{ id: 'b', capabilities: ['text'] }] }));
    return registry;
  };

  test('routes around a provider that is at its limit', async () => {
    const clock = start();
    const limits = createLimitTracker({ limits: { primary: { requestsPerMinute: 0 } }, clock });
    const router = createModelRouter(twoProviders(), { limits });

    const result = await router.route({
      requiredCapabilities: ['text'],
      preferredProviders: [providerId('primary')],
    });
    expect(result.ok).toBe(true);
    // Primary is preferred but unavailable, so backup serves.
    if (result.ok) expect(result.value.provider).toBe(providerId('backup'));
  });

  test('a blocked provider is never contacted', async () => {
    const clock = start();
    const registry = createProviderRegistry();
    const blocked = stubProvider({ id: 'primary', models: [{ id: 'p', capabilities: ['text'] }] });
    registry.register(blocked);
    registry.register(stubProvider({ id: 'backup', models: [{ id: 'b', capabilities: ['text'] }] }));

    const limits = createLimitTracker({ limits: { primary: { requestsPerMinute: 0 } }, clock });
    await createModelRouter(registry, { limits }).generate(
      { requiredCapabilities: ['text'], preferredProviders: [providerId('primary')], allowFallback: true },
      { messages },
    );
    // Spending a request to discover a known rate limit wastes the allowance
    // the limit exists to protect.
    expect(blocked.calls).toEqual([]);
  });

  test('every provider blocked yields RATE_LIMITED with when to retry', async () => {
    const clock = start();
    const limits = createLimitTracker({
      limits: { primary: { requestsPerMinute: 0 }, backup: { requestsPerMinute: 0 } },
      clock,
    });
    const result = await createModelRouter(twoProviders(), { limits }).route({
      requiredCapabilities: ['text'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RATE_LIMITED');
      expect(Array.isArray(result.error.details?.['blocked'])).toBe(true);
    }
  });

  test('a 429 from one provider fails over and backs that provider off', async () => {
    const clock = start();
    const registry = createProviderRegistry();
    registry.register(
      stubProvider({
        id: 'primary',
        models: [{ id: 'p', capabilities: ['text'] }],
        rateLimitedWith: 45_000,
      }),
    );
    registry.register(stubProvider({ id: 'backup', models: [{ id: 'b', capabilities: ['text'] }] }));

    const limits = createLimitTracker({ clock });
    const router = createModelRouter(registry, { limits });
    const policy = {
      requiredCapabilities: ['text'] as const,
      preferredProviders: [providerId('primary')],
      allowFallback: true,
    };

    const first = await router.generate(policy, { messages });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.provider).toBe(providerId('backup'));

    // The 429 is remembered, so the next call skips primary outright.
    expect(limits.available(providerId('primary'))).toBe(false);
    expect(limits.status(providerId('primary')).retryAtMs).toBe(clock.now().getTime() + 45_000);
  });

  test('successful calls consume the daily token quota', async () => {
    const clock = start();
    const limits = createLimitTracker({ limits: { primary: { tokensPerDay: 3 } }, clock });
    const registry = createProviderRegistry();
    registry.register(stubProvider({ id: 'primary', models: [{ id: 'p', capabilities: ['text'] }] }));

    const router = createModelRouter(registry, { limits });
    // The stub reports 1 input + 1 output token per call.
    await router.generate({ requiredCapabilities: ['text'] }, { messages });
    expect(limits.available(providerId('primary'))).toBe(true);
    await router.generate({ requiredCapabilities: ['text'] }, { messages });
    expect(limits.available(providerId('primary'))).toBe(false);
  });
});
