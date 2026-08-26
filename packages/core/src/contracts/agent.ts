/**
 * An Agent is a specialist: a role, a set of skills and tools, a model policy,
 * and a memory scope. Agents do not import one another. When an agent needs
 * another specialist it calls `context.delegate`, which routes through the
 * Supervisor (core principle 12).
 */
import type { Result } from '../result.ts';
import type { AgentId, DivisionId, RunId, SkillId, ToolId } from '../ids.ts';
import type { Capability } from './permissions.ts';
import type { ExecutionContext } from './execution.ts';
import type { ModelRouter, ModelSelectionPolicy } from './model-router.ts';
import type { MemoryScope, ScopedMemory } from './memory.ts';
import type { ToolBelt } from './tool.ts';
import type { Evidence } from './evidence.ts';
import type { UsageMetrics } from './execution.ts';
import type { HealthReporter } from './health.ts';

export interface AgentDescriptor {
  readonly id: AgentId;
  readonly division: DivisionId;
  /** The specialist role, e.g. 'controller', 'fpna', 'code-review'. */
  readonly role: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly skills: readonly SkillId[];
  readonly tools: readonly ToolId[];
  readonly capabilities: readonly Capability[];
  readonly memoryScopes: readonly MemoryScope[];
  readonly modelPolicy: ModelSelectionPolicy;
}

export interface AgentTask<I = unknown> {
  readonly id: string;
  /** Plain-language statement of what is wanted. */
  readonly objective: string;
  readonly input: I;
  readonly constraints?: readonly string[];
  readonly deadline?: string;
}

export interface AgentResult<O = unknown> {
  readonly output: O;
  readonly summary: string;
  readonly evidence: readonly Evidence[];
  readonly usage: UsageMetrics;
}

export interface DelegationRequest<I = unknown> {
  /** Address a specific agent, or a role within a division. */
  readonly target: { readonly agentId: AgentId } | { readonly division: DivisionId; readonly role: string };
  readonly task: AgentTask<I>;
}

export interface AgentContext extends ExecutionContext {
  readonly tools: ToolBelt;
  readonly models: ModelRouter;
  readonly memory: ScopedMemory;
  /** Collaboration seam. Backed by the Supervisor, never by a peer import. */
  delegate<O = unknown>(request: DelegationRequest): Promise<Result<AgentResult<O>>>;
}

export interface Agent<I = unknown, O = unknown> extends Partial<HealthReporter> {
  readonly descriptor: AgentDescriptor;
  handle(task: AgentTask<I>, context: AgentContext): Promise<Result<AgentResult<O>>>;
}

export interface AgentRun {
  readonly runId: RunId;
  readonly agentId: AgentId;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly status: 'running' | 'succeeded' | 'failed' | 'denied' | 'cancelled';
}

/** An agent with its input/output parameterisation erased. See AnyTool. */
export type AnyAgent = Agent<unknown, unknown>;
