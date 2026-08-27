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
import { type AgentId, type IdGenerator, cryptoIdGenerator, type RunId } from '../ids.ts';
import type { AgentRegistry, ToolRegistry } from '../registry/registries.ts';
import type { AnyAgent, AgentContext, AgentResult, DelegationRequest } from '../contracts/agent.ts';
import type { DispatchRequest, DispatchTarget, Supervisor } from '../contracts/supervisor.ts';
import type { BudgetGuard, ExecutionBudget } from '../contracts/execution.ts';
import type { EventBus } from '../contracts/events.ts';
import type { PermissionEngine, Subject } from '../contracts/permissions.ts';
import type { MemoryStore } from '../contracts/memory.ts';
import type { ModelRouter } from '../contracts/model-router.ts';
import type { SystemHealth } from '../contracts/health.ts';
import { createExecutionContext, createEvent } from './execution.ts';
import { createBudgetGuard } from './budget.ts';
import { createBudgetedRouter } from './budgeted-router.ts';
import { createToolBelt } from './tool-belt.ts';
import { createScopedMemory } from './memory.ts';
import { type HealthRegistry, createHealthRegistry } from './health.ts';

/** Capability a subject must hold to ask the Supervisor to run an agent. */
export const DISPATCH_CAPABILITY = 'agent:dispatch';

/**
 * Backstop for a chain that is long without being circular.
 *
 * A real cycle is caught by name before this (see `agentPath` below); this
 * bounds a legitimate but runaway chain, and reports the bound rather than
 * pretending to have diagnosed anything.
 */
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

  /**
   * Depth and budget guard of every run currently in flight.
   *
   * The public `delegate()` used to take depth from its caller, which meant an
   * Orchestrator could restart the count on every hop and walk straight past
   * MAX_DELEGATION_DEPTH. Depth is a property of the run tree, not something a
   * caller should be trusted to report, so it is derived here instead.
   *
   * Entries are removed when a run finishes. A parent always outlives its
   * children, so the map cannot grow without bound.
   *
   * `agentPath` is the chain of agents from the root of the tree to this run.
   * It is what makes a cycle diagnosable: an agent asked to run while it is
   * already its own ancestor is a loop, and saying so is more useful than
   * exhausting the depth bound eight hops later. Derived here for the same
   * reason as depth -- a caller must not be able to report its own lineage.
   */
  const inFlight = new Map<
    RunId,
    { depth: number; guard: BudgetGuard; agentPath: readonly AgentId[] }
  >();

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
    inheritedGuard: BudgetGuard | undefined,
    ancestors: readonly AgentId[],
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

    // A cycle is refused by name, immediately. Ancestors only: A -> B -> C -> B
    // is a loop, while A -> B and A -> C -> B is two agents legitimately asking
    // the same specialist, and treating those alike would break real chains.
    //
    // UNSUPPORTED, not INTERNAL: nothing has gone wrong inside the system, and
    // not INVALID_INPUT: the task is fine. It is the *shape* that is refused.
    if (ancestors.includes(descriptor.id)) {
      return err(
        nexusError('UNSUPPORTED', `delegation cycle: ${[...ancestors, descriptor.id].join(' -> ')}`, {
          details: { path: [...ancestors, descriptor.id], agentId: descriptor.id },
        }),
      );
    }

    const permitted = params.permissions.require({
      subject: caller,
      capability: DISPATCH_CAPABILITY,
      resource: descriptor.id,
    });
    // Lineage, assembled from the Supervisor's own state (ADR 0018). Every
    // field here comes from the run tree or the registered descriptor: none of
    // it is read from the task, the caller's metadata, or anything an agent
    // returned, because a run that can describe its own position in the tree
    // can misdescribe it.
    //
    // It is a record, never a permission. Nothing below branches on it.
    const lineage = {
      agentId: descriptor.id,
      division: descriptor.division,
      role: descriptor.role,
      depth,
      // Omitted at the top of a tree. Absent means "this run has no parent",
      // which is a fact about the run rather than a missing field.
      ...(parentRunId !== undefined ? { parentRunId } : {}),
    };

    if (!permitted.ok) {
      await params.events.publish(
        createEvent({
          type: 'agent.dispatch.denied',
          source: supervisorSubject,
          payload: { ...lineage, caller: `${caller.kind}:${caller.id}` },
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

    // A delegated run inherits its parent's guard, so the whole chain shares one
    // ceiling (spec §18.2). Only the top of a tree creates a new one.
    const guard = inheritedGuard ?? createBudgetGuard(budget, clock);

    // Charged before anything is built or published, so a refused run leaves no
    // half-started trace. Charged AFTER the permission check, because a denied
    // dispatch never became a run and must not consume the tree's allowance.
    const charged = guard.chargeAgentRun();
    if (!charged.ok) return charged;

    const base = createExecutionContext({
      actor: agentSubject,
      events: params.events,
      permissions: params.permissions,
      budget,
      budgetGuard: guard,
      ...(parentRunId !== undefined ? { parentRunId } : {}),
      clock,
      logger,
      ids,
      metadata: { ...(request.metadata ?? {}), taskId: request.task.id, depth },
    });

    const agentPath: readonly AgentId[] = [...ancestors, descriptor.id];
    inFlight.set(base.runId, { depth, guard, agentPath });

    const context: AgentContext = {
      ...base,
      tools: createToolBelt({
        registry: params.tools,
        subject: agentSubject,
        allowed: descriptor.tools,
      }),
      models: createBudgetedRouter(params.models, guard),
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
          guard,
          agentPath,
        ),
    };

    await params.events.publish(
      createEvent({
        type: 'agent.task.started',
        source: supervisorSubject,
        runId: base.runId,
        payload: { ...lineage, taskId: request.task.id },
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
    } finally {
      inFlight.delete(base.runId);
    }

    await params.events.publish(
      createEvent({
        type: outcome.ok ? 'agent.task.completed' : 'agent.task.failed',
        source: supervisorSubject,
        runId: base.runId,
        payload: {
          ...lineage,
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
        undefined,
        [],
      );
    },

    delegate<O = unknown>(request: DelegationRequest, parent: { runId: string; budget: ExecutionBudget }) {
      // Depth and guard come from the parent run's own record, not from the
      // caller. An unknown parent means no chain is in flight, so this is the
      // top of a new tree (depth 0) -- see the `inFlight` note above.
      const parentRun = inFlight.get(parent.runId as RunId);
      return run<O>(
        request.target,
        { target: request.target, task: request.task },
        supervisorSubject,
        parent.budget,
        parent.runId as RunId,
        parentRun ? parentRun.depth + 1 : 0,
        parentRun?.guard,
        parentRun?.agentPath ?? [],
      );
    },

    health(): Promise<SystemHealth> {
      return health.report();
    },
  };
}
