/**
 * The event bus is the decoupling seam. Divisions observe the system through
 * events rather than by importing each other (core principle 12), and future
 * background jobs, notifications and audit logging attach here without the
 * Core changing.
 */
import type { RunId } from '../ids.ts';
import type { Subject } from './permissions.ts';

export interface NexusEvent<T = unknown> {
  readonly id: string;
  /** Dotted namespace, e.g. 'agent.task.completed', 'tool.execution.denied'. */
  readonly type: string;
  readonly occurredAt: string;
  readonly source: Subject;
  readonly runId?: RunId;
  readonly payload: T;
}

export type EventHandler<T = unknown> = (event: NexusEvent<T>) => void | Promise<void>;

export type Unsubscribe = () => void;

export interface EventBus {
  publish<T>(event: NexusEvent<T>): Promise<void>;
  /** `type` accepts an exact type or '*' for all events. */
  subscribe<T>(type: string, handler: EventHandler<T>): Unsubscribe;
}
