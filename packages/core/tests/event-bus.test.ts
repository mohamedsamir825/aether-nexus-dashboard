import { test, expect, describe } from 'bun:test';
import { createInMemoryEventBus } from '../src/runtime/event-bus.ts';
import { createEvent } from '../src/runtime/execution.ts';
import { fixedClock } from '../src/clock.ts';
import type { NexusEvent } from '../src/contracts/events.ts';
import type { Logger, LogLevel } from '../src/logger.ts';
import { sequentialIds } from './support/doubles.ts';

const source = { kind: 'system' as const, id: 'test' };
const clock = fixedClock(new Date('2026-01-01T00:00:00Z'));

const event = (type: string): NexusEvent<{ n: number }> =>
  createEvent({ type, source, payload: { n: 1 }, clock, ids: sequentialIds() });

describe('in-memory event bus', () => {
  test('delivers to subscribers of the exact type', async () => {
    const bus = createInMemoryEventBus();
    const seen: string[] = [];
    bus.subscribe('agent.task.started', (e) => void seen.push(e.type));
    await bus.publish(event('agent.task.started'));
    await bus.publish(event('agent.task.failed'));
    expect(seen).toEqual(['agent.task.started']);
  });

  test('delivers every event to wildcard subscribers', async () => {
    const bus = createInMemoryEventBus();
    const seen: string[] = [];
    bus.subscribe('*', (e) => void seen.push(e.type));
    await bus.publish(event('a'));
    await bus.publish(event('b'));
    expect(seen).toEqual(['a', 'b']);
  });

  test('unsubscribe stops delivery', async () => {
    const bus = createInMemoryEventBus();
    let count = 0;
    const off = bus.subscribe('a', () => void count++);
    await bus.publish(event('a'));
    off();
    await bus.publish(event('a'));
    expect(count).toBe(1);
  });

  test('awaits async handlers', async () => {
    const bus = createInMemoryEventBus();
    let done = false;
    bus.subscribe('a', async () => {
      await Promise.resolve();
      done = true;
    });
    await bus.publish(event('a'));
    expect(done).toBe(true);
  });

  test('a throwing handler is isolated and does not fail the publisher', async () => {
    const logged: string[] = [];
    const logger: Logger = {
      log: (level: LogLevel, message: string) => void logged.push(`${level}:${message}`),
      child: () => logger,
    };
    const bus = createInMemoryEventBus(logger);
    let reachedSecond = false;

    bus.subscribe('a', () => {
      throw new Error('subscriber exploded');
    });
    bus.subscribe('a', () => void (reachedSecond = true));

    await bus.publish(event('a'));

    expect(reachedSecond).toBe(true);
    expect(logged).toContain('error:event handler failed');
  });
});
