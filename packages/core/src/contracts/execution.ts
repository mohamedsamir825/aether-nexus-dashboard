/**
 * ExecutionContext is what every tool, skill and agent receives instead of
 * reaching for globals or importing singletons. It carries identity, budget,
 * cancellation, and the permission-checked capabilities of the current run.
 */
import type { Result } from '../result.ts';
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
  /**
   * How many agent runs the whole tree may contain (ADR 0019).
   *
   * `MAX_DELEGATION_DEPTH` bounds how *deep* a chain may go and says nothing
   * about how *wide* it may get: an agent that delegates once per item in its
   * input produces one run per item, all at depth 1, and no other dimension
   * charges them. A model call and a tool call each cost something here; a
   * delegation hop did not, which made breadth the one unbounded resource in
   * an otherwise budgeted system.
   *
   * Counted across the whole tree against the shared guard, so a child cannot
   * widen the ceiling its parent was given. Unset means no limit for this
   * dimension -- never zero.
   */
  readonly maxAgentRuns?: number;
}

export interface BudgetUsage {
  readonly modelCalls: number;
  readonly toolCalls: number;
  /** Agent runs started anywhere in this tree, the root included. */
  readonly agentRuns: number;
  readonly elapsedMs: number;
}

/**
 * Enforces an ExecutionBudget across a whole run tree.
 *
 * One guard is created per top-level dispatch and SHARED with every child
 * context, so a delegation chain cannot escape the ceiling its parent was given
 * by spawning children (spec §18.2). Charging happens before the work, so a
 * refused call costs nothing.
 *
 * An unset field in the budget means "no limit for this dimension" -- not zero.
 */
export interface BudgetGuard {
  readonly budget: ExecutionBudget;
  /** Charge one model call, or fail with BUDGET_EXCEEDED. */
  chargeModelCall(): Result<void>;
  /** Charge one tool call, or fail with BUDGET_EXCEEDED. */
  chargeToolCall(): Result<void>;
  /**
   * Charge one agent run, or fail with BUDGET_EXCEEDED.
   *
   * Charged by the Supervisor before the agent is resolved or run, so a
   * refused run costs nothing and emits no lifecycle event -- there is no
   * half-started run to explain away afterwards.
   */
  chargeAgentRun(): Result<void>;
  /** Wall-clock check; fails with BUDGET_EXCEEDED once timeoutMs has passed. */
  checkDeadline(): Result<void>;
  readonly usage: BudgetUsage;
}

export interface ExecutionContext {
  readonly runId: RunId;
  readonly parentRunId?: RunId;
  /** Who this run acts as; permission checks are made against it. */
  readonly actor: Subject;
  readonly startedAt: string;
  readonly budget: ExecutionBudget;
  /** Shared with every child context; a nested run cannot reset it. */
  readonly budgetGuard: BudgetGuard;
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
  /**
   * Cost in minor currency units (e.g. cents), when the provider publishes
   * pricing. Omitted -- never zero -- when cost is unknown, so "free" and
   * "unmeasured" stay distinguishable (spec §21).
   */
  readonly costMinorUnits?: number;
}

export const emptyUsage: UsageMetrics = {
  modelCalls: 0,
  toolCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  durationMs: 0,
};
