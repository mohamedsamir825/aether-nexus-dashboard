/**
 * The Core Supervisor.
 *
 * Responsibilities, deliberately narrow: resolve a target agent, verify the
 * caller may dispatch to it, assemble the AgentContext (tool belt, scoped
 * memory, model router, delegation hook), run it, and emit lifecycle events.
 *
 * It performs no planning, no decomposition and no scheduling. Those belong in
 * a layer above, so that adding them later does not modify this file.
 */
import { type Result, ok, err } from '../result.ts';
import { nexusError, fromUnknown } from '../errors.ts';
import { type Clock, systemClock } from '../clock.ts';
import { type Logger, nullLogger } from '../logger.ts';
import { type IdGenerator, cryptoIdGenerator, type RunId } from '../ids.ts';
import type { AgentRegistry, ToolRegistry } from '../registry/registries.ts';
import type { AnyAgent, AgentContext, AgentResult, DelegationRequest } from '../contracts/agent.ts';
import type { DispatchRequest, DispatchTarget, Supervisor } from '../contracts/supervisor.ts';
import type { ExecutionBudget } from '../contracts/execution.ts';
import type { EventBus } from '../contracts/events.ts';
import type { PermissionEngine, Subject } from '../contracts/permissions.ts';
import type { MemoryStore } from '../contracts/memory.ts';
import type { ModelRouter } from '../contracts/model-router.ts';
import type { SystemHealth } from '../contracts/health.ts';
import { createExecutionContext, createEvent } from './execution.ts';
import { createToolBelt } from './tool-belt.ts';
import { createScopedMemory } from './memory.ts';
import { type HealthRegistry, createHealthRegistry } from './health.ts';

/** Capability a subject must hold to ask the Supervisor to run an agent. */
export const DISPATCH_CAPABILITY = 'agent:dispatch';

/** Guards against a delegation cycle: A -> B -> A -> ... */
const MAX_DELEGATION_DEPTH = 8;

export interface CreateSupervisorParams {
  readonly agents: AgentRegistry;
  readonly tools: ToolRegistry;
  readonly models: ModelRouter;
  readonly memory: MemoryStore;
  readonly events: EventBus;
  readonly permissions: PermissionEngine;
  readonly health?: HealthRegistry;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly ids?: IdGenerator;
}

export function createSupervisor(params: CreateSupervisorParams): Supervisor {
  const clock = params.clock ?? systemClock;
  const logger = params.logger ?? nullLogger;
  const ids = params.ids ?? cryptoIdGenerator;
  const health = params.health ?? createHealthRegistry(clock);

  const supervisorSubject: Subject = { kind: 'supervisor', id: 'core' };

  function resolve(target: DispatchTarget): Result<AnyAgent> {
    if ('agentId' in target) {
      return params.agents.get(target.agentId);
    }
    const found = params.agents.findByRole(target.division, target.role);
    if (!found) {
      return err(
        nexusError('NOT_FOUND', `no agent for role '${target.role}' in division '${target.division}'`, {
          details: { division: target.division, role: target.role },
        }),
      );
    }
    return ok(found);
  }

  async function run<O>(
    target: DispatchTarget,
    request: DispatchRequest,
    caller: Subject,
    budget: ExecutionBudget,
    parentRunId: RunId | undefined,
    depth: number,
  ): Promise<Result<AgentResult<O>>> {
    if (depth > MAX_DELEGATION_DEPTH) {
      return err(
        nexusError('INTERNAL', `delegation depth exceeded ${MAX_DELEGATION_DEPTH}`, {
          details: { depth },
        }),
      );
    }

    const resolved = resolve(target);
    if (!resolved.ok) return resolved;
    const agent = resolved.value;
    const descriptor = agent.descriptor;

    const permitted = params.permissions.require({
      subject: caller,
      capability: DISPATCH_CAPABILITY,
      resource: descriptor.id,
    });
    if (!permitted.ok) {
      await params.events.publish(
        createEvent({
          type: 'agent.dispatch.denied',
          source: supervisorSubject,
          payload: { agentId: descriptor.id, caller: `${caller.kind}:${caller.id}` },
          clock,
          ids,
        }),
      );
      return permitted;
    }

    const agentSubject: Subject = {
      kind: 'agent',
      id: descriptor.id,
      division: descriptor.division,
    };

    const base = createExecutionContext({
      actor: agentSubject,
      events: params.events,
      permissions: params.permissions,
      budget,
      ...(parentRunId !== undefined ? { parentRunId } : {}),
      clock,
      logger,
      ids,
      metadata: { ...(request.metadata ?? {}), taskId: request.task.id, depth },
    });

    const context: AgentContext = {
      ...base,
      tools: createToolBelt({
        registry: params.tools,
        subject: agentSubject,
        allowed: descriptor.tools,
      }),
      models: params.models,
      memory: createScopedMemory({
        store: params.memory,
        subject: agentSubject,
        scopes: descriptor.memoryScopes,
        permissions: params.permissions,
      }),
      delegate: <R = unknown>(delegation: DelegationRequest) =>
        run<R>(
          delegation.target,
          { target: delegation.target, task: delegation.task },
          agentSubject,
          budget,
          base.runId,
          depth + 1,
        ),
    };

    await params.events.publish(
      createEvent({
        type: 'agent.task.started',
        source: supervisorSubject,
        runId: base.runId,
        payload: { agentId: descriptor.id, taskId: request.task.id },
        clock,
        ids,
      }),
    );

    const startedAt = clock.now().getTime();
    let outcome: Result<AgentResult<O>>;
    try {
      outcome = (await agent.handle(request.task, context)) as Result<AgentResult<O>>;
    } catch (cause) {
      // An agent that throws must not take the Supervisor down with it.
      outcome = err(fromUnknown(cause, 'INTERNAL'));
    }

    await params.events.publish(
      createEvent({
        type: outcome.ok ? 'agent.task.completed' : 'agent.task.failed',
        source: supervisorSubject,
        runId: base.runId,
        payload: {
          agentId: descriptor.id,
          taskId: request.task.id,
          durationMs: clock.now().getTime() - startedAt,
          ...(outcome.ok ? {} : { errorCode: outcome.error.code, error: outcome.error.message }),
        },
        clock,
        ids,
      }),
    );

    return outcome;
  }

  return {
    dispatch<I = unknown, O = unknown>(request: DispatchRequest<I>) {
      return run<O>(
        request.target,
        request as DispatchRequest,
        // An external caller acts as the system; policy decides what that may do.
        { kind: 'system', id: 'dispatch' },
        request.budget ?? {},
        undefined,
        0,
      );
    },

    delegate<O = unknown>(request: DelegationRequest, parent: { runId: string; budget: ExecutionBudget }) {
      return run<O>(
        request.target,
        { target: request.target, task: request.task },
        supervisorSubject,
        parent.budget,
        parent.runId as RunId,
        1,
      );
    },

    health(): Promise<SystemHealth> {
      return health.report();
    },
  };
}
