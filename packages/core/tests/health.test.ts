import { test, expect, describe } from 'bun:test';
import { createHealthRegistry, healthCheck, worstStatus } from '../src/runtime/health.ts';
import { fixedClock } from '../src/clock.ts';
import type { HealthReport } from '../src/contracts/health.ts';

const clock = fixedClock(new Date('2026-01-01T00:00:00Z'));

const report = (component: string, status: HealthReport['status']): HealthReport => ({
  component,
  status,
  checkedAt: clock.now().toISOString(),
});

describe('worstStatus', () => {
  test('healthy only when everything is healthy', () => {
    expect(worstStatus(['healthy', 'healthy'])).toBe('healthy');
    expect(worstStatus([])).toBe('healthy');
  });

  test('a single degraded component degrades the system', () => {
    expect(worstStatus(['healthy', 'degraded', 'healthy'])).toBe('degraded');
  });

  test('unavailable outranks degraded', () => {
    expect(worstStatus(['degraded', 'unavailable', 'healthy'])).toBe('unavailable');
  });
});

describe('health registry', () => {
  test('aggregates every registered component', async () => {
    const registry = createHealthRegistry(clock);
    registry.register(healthCheck('a', async () => report('a', 'healthy')));
    registry.register(healthCheck('b', async () => report('b', 'degraded')));

    const result = await registry.report();
    expect(result.status).toBe('degraded');
    expect(result.components).toHaveLength(2);
  });

  test('a check that throws is reported as unavailable, not propagated', async () => {
    const registry = createHealthRegistry(clock);
    registry.register(healthCheck('a', async () => report('a', 'healthy')));
    registry.register(
      healthCheck('broken', async () => {
        throw new Error('probe failed');
      }),
    );

    const result = await registry.report();
    expect(result.status).toBe('unavailable');
    const broken = result.components.find((c) => c.component === 'broken');
    expect(broken?.status).toBe('unavailable');
    expect(broken?.detail).toContain('probe failed');
  });

  test('an empty registry is healthy', async () => {
    expect((await createHealthRegistry(clock).report()).status).toBe('healthy');
  });
});
