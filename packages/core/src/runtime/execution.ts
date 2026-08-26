import { type IdGenerator, cryptoIdGenerator, type RunId, runId as toRunId } from '../ids.ts';
import { type Clock, systemClock } from '../clock.ts';
import { type Logger, nullLogger } from '../logger.ts';
import type { EventBus, NexusEvent } from '../contracts/events.ts';
import type { PermissionEngine, Subject } from '../contracts/permissions.ts';
import type { ExecutionBudget, ExecutionContext } from '../contracts/execution.ts';

export interface CreateExecutionContextParams {
  readonly actor: Subject;
  readonly events: EventBus;
  readonly permissions: PermissionEngine;
  readonly budget?: ExecutionBudget;
  readonly parentRunId?: RunId;
  readonly signal?: AbortSignal;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly ids?: IdGenerator;
  readonly metadata?: Record<string, unknown>;
}

export function createExecutionContext(params: CreateExecutionContextParams): ExecutionContext {
  const clock = params.clock ?? systemClock;
  const ids = params.ids ?? cryptoIdGenerator;
  const logger = params.logger ?? nullLogger;
  const budget = params.budget ?? {};
  const id = toRunId(ids.next('run'));

  const build = (
    actor: Subject,
    parentRunId: RunId | undefined,
    metadata: Record<string, unknown>,
    currentId: RunId,
  ): ExecutionContext => ({
    runId: currentId,
    ...(parentRunId !== undefined ? { parentRunId } : {}),
    actor,
    startedAt: clock.now().toISOString(),
    budget,
    ...(params.signal !== undefined ? { signal: params.signal } : {}),
    clock,
    logger: logger.child({ runId: currentId, actor: `${actor.kind}:${actor.id}` }),
    events: params.events,
    permissions: params.permissions,
    metadata,
    child(overrides) {
      // A child run keeps the parent's budget and signal: a nested step must
      // not be able to escape the ceiling its parent was given.
      return build(
        overrides.actor ?? actor,
        currentId,
        { ...metadata, ...(overrides.metadata ?? {}) },
        toRunId(ids.next('run')),
      );
    },
  });

  return build(params.actor, params.parentRunId, params.metadata ?? {}, id);
}

/** Builds a well-formed event; the only place event ids are minted. */
export function createEvent<T>(params: {
  readonly type: string;
  readonly source: Subject;
  readonly payload: T;
  readonly runId?: RunId;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}): NexusEvent<T> {
  const clock = params.clock ?? systemClock;
  const ids = params.ids ?? cryptoIdGenerator;
  return {
    id: ids.next('evt'),
    type: params.type,
    occurredAt: clock.now().toISOString(),
    source: params.source,
    ...(params.runId !== undefined ? { runId: params.runId } : {}),
    payload: params.payload,
  };
}
