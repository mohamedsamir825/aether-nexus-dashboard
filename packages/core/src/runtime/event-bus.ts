/**
 * In-process event bus. Real, not a placeholder -- it is the correct
 * implementation for a single-process deployment. A future distributed bus
 * implements the same EventBus interface; nothing upstream changes.
 *
 * A failing subscriber must never fail the publisher: handler errors are
 * isolated and reported, because an audit listener throwing should not abort
 * an agent run (core principle 8).
 */
import type { EventBus, EventHandler, NexusEvent, Unsubscribe } from '../contracts/events.ts';
import type { Logger } from '../logger.ts';
import { nullLogger } from '../logger.ts';

const WILDCARD = '*';

export function createInMemoryEventBus(logger: Logger = nullLogger): EventBus {
  const handlers = new Map<string, Set<EventHandler<never>>>();

  return {
    async publish<T>(event: NexusEvent<T>): Promise<void> {
      const targets = [
        ...(handlers.get(event.type) ?? []),
        ...(handlers.get(WILDCARD) ?? []),
      ] as EventHandler<T>[];

      for (const handler of targets) {
        try {
          await handler(event);
        } catch (cause) {
          logger.log('error', 'event handler failed', {
            eventType: event.type,
            eventId: event.id,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    },

    subscribe<T>(type: string, handler: EventHandler<T>): Unsubscribe {
      const set = handlers.get(type) ?? new Set<EventHandler<never>>();
      set.add(handler as EventHandler<never>);
      handlers.set(type, set);
      return () => {
        set.delete(handler as EventHandler<never>);
        if (set.size === 0) handlers.delete(type);
      };
    },
  };
}
