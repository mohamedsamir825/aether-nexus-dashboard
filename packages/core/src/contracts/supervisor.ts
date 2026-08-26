/**
 * The Supervisor is the single entry point into the agent layer and the only
 * component that knows the full agent roster. It resolves a target, enforces
 * permissions, builds the ExecutionContext, and records the run.
 *
 * It is deliberately *not* a planner. Multi-step decomposition, scheduling and
 * autonomous workflows are later, additive concerns that sit on top of this
 * interface rather than inside it.
 */
import type { Result } from '../result.ts';
import type { AgentId, DivisionId } from '../ids.ts';
import type { AgentResult, AgentTask, DelegationRequest } from './agent.ts';
import type { ExecutionBudget } from './execution.ts';
import type { SystemHealth } from './health.ts';

export type DispatchTarget =
  | { readonly agentId: AgentId }
  | { readonly division: DivisionId; readonly role: string };

export interface DispatchRequest<I = unknown> {
  readonly target: DispatchTarget;
  readonly task: AgentTask<I>;
  readonly budget?: ExecutionBudget;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Supervisor {
  dispatch<I = unknown, O = unknown>(request: DispatchRequest<I>): Promise<Result<AgentResult<O>>>;
  /** Delegation from inside a run; carries the parent run for the audit trail. */
  delegate<O = unknown>(
    request: DelegationRequest,
    parent: { readonly runId: string; readonly budget: ExecutionBudget },
  ): Promise<Result<AgentResult<O>>>;
  health(): Promise<SystemHealth>;
}
