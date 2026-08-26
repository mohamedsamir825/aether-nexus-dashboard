/**
 * ExecutionContext is what every tool, skill and agent receives instead of
 * reaching for globals or importing singletons. It carries identity, budget,
 * cancellation, and the permission-checked capabilities of the current run.
 */
import type { RunId } from '../ids.ts';
import type { Clock } from '../clock.ts';
import type { Logger } from '../logger.ts';
import type { EventBus } from './events.ts';
import type { PermissionEngine, Subject } from './permissions.ts';

export interface ExecutionBudget {
  /** Wall-clock ceiling for the run. */
  readonly timeoutMs?: number;
  readonly maxModelCalls?: number;
  readonly maxToolCalls?: number;
}

export interface ExecutionContext {
  readonly runId: RunId;
  readonly parentRunId?: RunId;
  /** Who this run acts as; permission checks are made against it. */
  readonly actor: Subject;
  readonly startedAt: string;
  readonly budget: ExecutionBudget;
  readonly signal?: AbortSignal;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly events: EventBus;
  readonly permissions: PermissionEngine;
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Derive a child context for a nested step, inheriting budget and actor. */
  child(overrides: { actor?: Subject; metadata?: Record<string, unknown> }): ExecutionContext;
}

export interface UsageMetrics {
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
}

export const emptyUsage: UsageMetrics = {
  modelCalls: 0,
  toolCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  durationMs: 0,
};
