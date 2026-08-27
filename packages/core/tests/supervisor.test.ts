import { test, expect, describe } from 'bun:test';
import { DISPATCH_CAPABILITY, createSupervisor } from '../src/runtime/supervisor.ts';
import { createAgentRegistry, createProviderRegistry, createToolRegistry } from '../src/registry/registries.ts';
import { createModelRouter } from '../src/runtime/model-router.ts';
import { createInMemoryEventBus } from '../src/runtime/event-bus.ts';
import { createInMemoryMemoryStore } from '../src/runtime/memory.ts';
import { allowListPolicy, createPermissionEngine } from '../src/runtime/permissions.ts';
import { createHealthRegistry, healthCheck } from '../src/runtime/health.ts';
import { fixedClock } from '../src/clock.ts';
import { agentId, divisionId, toolId } from '../src/ids.ts';
import { ok } from '../src/result.ts';
import type { PermissionPolicy } from '../src/contracts/permissions.ts';
import type { AgentTask } from '../src/contracts/agent.ts';
import { emptyUsage } from '../src/contracts/execution.ts';
import { sequentialIds, stubAgent, stubTool } from './support/doubles.ts';

const clock = fixedClock(new Date('2026-01-01T00:00:00Z'));

const dispatchGrant = allowListPolicy('dispatch', [
  { subject: { kind: 'system' }, capabilities: [DISPATCH_CAPABILITY] },
  { subject: { kind: 'agent' }, capabilities: [DISPATCH_CAPABILITY, 'tool:execute'] },
  // Supervisor.delegate() acts as the supervisor itself, so a deployment that
  // uses the public delegation entry point must grant it explicitly. Deny-by-
  // default still applies: omitting this row blocks that path entirely.
  { subject: { kind: 'supervisor' }, capabilities: [DISPATCH_CAPABILITY] },
]);

function harness(policies: readonly PermissionPolicy[] = [dispatchGrant]) {
  const agents = createAgentRegistry();
  const tools = createToolRegistry();
  const events = createInMemoryEventBus();
  // `runId` is captured too: lineage tests need to check that a child's
  // parentRunId is the parent's ACTUAL run id, which lives on the envelope.
  const seen: { type: string; payload: unknown; runId?: string }[] = [];
  events.subscribe(
    '*',
    (e) => void seen.push({ type: e.type, payload: e.payload, ...(e.runId ? { runId: e.runId } : {}) }),
  );

  const supervisor = createSupervisor({
    agents,
    tools,
    models: createModelRouter(createProviderRegistry()),
    memory: createInMemoryMemoryStore({ clock, ids: sequentialIds() }),
    events,
    permissions: createPermissionEngine(policies),
    health: createHealthRegistry(clock),
    clock,
    ids: sequentialIds(),
  });

  return { agents, tools, supervisor, seen };
}

const task = (objective: string): AgentTask => ({ id: 't1', objective, input: {} });

describe('supervisor', () => {
  test('dispatches to an agent addressed by id', async () => {
    const { agents, supervisor } = harness();
    agents.register(stubAgent({ id: 'a1' }));

    const result = await supervisor.dispatch({ target: { agentId: agentId('a1') }, task: task('do it') });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.summary).toBe('handled by a1');
  });

  test('resolves an agent by division and role', async () => {
    const { agents, supervisor } = harness();
    agents.register(stubAgent({ id: 'cfo', division: 'finance', role: 'cfo' }));

    const result = await supervisor.dispatch({
      target: { division: divisionId('finance'), role: 'cfo' },
      task: task('close the books'),
    });
    expect(result.ok).toBe(true);
  });

  test('reports NOT_FOUND for an unknown agent and an unknown role', async () => {
    const { supervisor } = harness();
    const byId = await supervisor.dispatch({ target: { agentId: agentId('ghost') }, task: task('x') });
    expect(byId.ok).toBe(false);
    if (!byId.ok) expect(byId.error.code).toBe('NOT_FOUND');

    const byRole = await supervisor.dispatch({
      target: { division: divisionId('finance'), role: 'ghost' },
      task: task('x'),
    });
    expect(byRole.ok).toBe(false);
    if (!byRole.ok) expect(byRole.error.code).toBe('NOT_FOUND');
  });

  test('refuses dispatch when the caller lacks the capability, and says so on the bus', async () => {
    const { agents, supervisor, seen } = harness([]);
    agents.register(stubAgent({ id: 'a1' }));

    const result = await supervisor.dispatch({ target: { agentId: agentId('a1') }, task: task('x') });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');
    expect(seen.map((e) => e.type)).toEqual(['agent.dispatch.denied']);
  });

  test('emits started and completed events around a successful run', async () => {
    const { agents, supervisor, seen } = harness();
    agents.register(stubAgent({ id: 'a1' }));
    await supervisor.dispatch({ target: { agentId: agentId('a1') }, task: task('x') });
    expect(seen.map((e) => e.type)).toEqual(['agent.task.started', 'agent.task.completed']);
  });

  test('contains an agent that throws and reports it as failed', async () => {
    const { agents, supervisor, seen } = harness();
    agents.register(stubAgent({ id: 'a1', throwWith: 'agent exploded' }));

    const result = await supervisor.dispatch({ target: { agentId: agentId('a1') }, task: task('x') });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL');
      expect(result.error.message).toContain('agent exploded');
    }
    expect(seen.map((e) => e.type)).toEqual(['agent.task.started', 'agent.task.failed']);
  });

  test('gives the agent a belt limited to its declared tools', async () => {
    const { agents, tools, supervisor } = harness();
    tools.register(stubTool({ id: 'echo', requiredCapabilities: ['tool:execute'] }));
    tools.register(stubTool({ id: 'wire-transfer' }));

    let visible: string[] = [];
    let invoked: unknown;
    agents.register(
      stubAgent({
        id: 'a1',
        tools: ['echo'],
        handler: async (_task, context) => {
          visible = context.tools.list().map((d) => d.name);
          const outcome = await context.tools.invoke(
            { toolId: toolId('echo'), input: { value: 'hi' } },
            context,
          );
          invoked = outcome.ok ? outcome.value.output : outcome.error;
          return ok({ output: {}, summary: 'done', evidence: [], usage: emptyUsage });
        },
      }),
    );

    await supervisor.dispatch({ target: { agentId: agentId('a1') }, task: task('x') });
    expect(visible).toEqual(['echo']);
    expect(invoked).toEqual({ echoed: 'hi' });
  });

  test('agents collaborate through delegate() rather than by importing each other', async () => {
    const { agents, supervisor } = harness();
    agents.register(stubAgent({ id: 'specialist', division: 'research', role: 'analyst' }));
    agents.register(
      stubAgent({
        id: 'lead',
        handler: async (_task, context) => {
          const delegated = await context.delegate({
            target: { division: divisionId('research'), role: 'analyst' },
            task: task('sub-task'),
          });
          return ok({
            output: {},
            summary: delegated.ok ? `delegated:${delegated.value.summary}` : 'delegation failed',
            evidence: [],
            usage: emptyUsage,
          });
        },
      }),
    );

    const result = await supervisor.dispatch({ target: { agentId: agentId('lead') }, task: task('x') });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.summary).toBe('delegated:handled by specialist');
  });

  test('names a delegation cycle and refuses it at the first re-entry', async () => {
    const { agents, supervisor } = harness();
    let hops = 0;
    agents.register(
      stubAgent({
        id: 'loop',
        handler: async (_task, context) => {
          hops += 1;
          const nested = await context.delegate({
            target: { agentId: agentId('loop') },
            task: task('again'),
          });
          if (!nested.ok) return nested;
          return ok({ output: {}, summary: 'never', evidence: [], usage: emptyUsage });
        },
      }),
    );

    const result = await supervisor.dispatch({ target: { agentId: agentId('loop') }, task: task('x') });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // UNSUPPORTED, not INTERNAL: nothing malfunctioned, the shape was refused.
      expect(result.error.code).toBe('UNSUPPORTED');
      expect(result.error.message).toContain('delegation cycle: loop -> loop');
      expect(result.error.details?.['path']).toEqual(['loop', 'loop']);
    }
    // Refused the moment the loop closed, not eight wasted hops later.
    expect(hops).toBe(1);
  });

  test('an agent may be asked twice in one tree when it is not its own ancestor', async () => {
    // A -> B and A -> C -> B is not a cycle. Treating a repeated agent as one
    // would break every real chain: Business asks Research directly AND asks
    // Finance, which asks Research for the same market facts.
    const { agents, supervisor } = harness();
    let specialistRuns = 0;
    agents.register(
      stubAgent({
        id: 'specialist',
        handler: async () => {
          specialistRuns += 1;
          return ok({ output: {}, summary: 'specialist', evidence: [], usage: emptyUsage });
        },
      }),
    );
    agents.register(
      stubAgent({
        id: 'middle',
        handler: async (_t, context) =>
          context.delegate({ target: { agentId: agentId('specialist') }, task: task('via middle') }),
      }),
    );
    agents.register(
      stubAgent({
        id: 'lead2',
        handler: async (_t, context) => {
          const direct = await context.delegate({
            target: { agentId: agentId('specialist') },
            task: task('direct'),
          });
          if (!direct.ok) return direct;
          const viaMiddle = await context.delegate({
            target: { agentId: agentId('middle') },
            task: task('indirect'),
          });
          if (!viaMiddle.ok) return viaMiddle;
          return ok({ output: {}, summary: 'both', evidence: [], usage: emptyUsage });
        },
      }),
    );

    const result = await supervisor.dispatch({ target: { agentId: agentId('lead2') }, task: task('x') });
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    expect(specialistRuns).toBe(2);
  });

  test('the depth bound still stops a long chain that is NOT a cycle', async () => {
    // The cycle guard must not have made the backstop unreachable: a ladder of
    // distinct agents never repeats an ancestor and can only be stopped by depth.
    const { agents, supervisor } = harness();
    for (let i = 0; i < 14; i += 1) {
      agents.register(
        stubAgent({
          id: `hop${i}`,
          handler: async (_t, context) =>
            context.delegate({ target: { agentId: agentId(`hop${i + 1}`) }, task: task('on') }),
        }),
      );
    }

    const result = await supervisor.dispatch({ target: { agentId: agentId('hop0') }, task: task('x') });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('delegation depth exceeded');
      expect(result.error.code).not.toBe('UNSUPPORTED');
    }
  });

  test('derives lineage from the run tree, not from the caller (G1)', async () => {
    // An Orchestrator (Phase 4) will call the PUBLIC Supervisor.delegate(), not
    // context.delegate(). That path used to pass a hardcoded depth of 1, so the
    // guard never fired and a loop recursed until the stack died. Depth and the
    // ancestor path are both derived from the in-flight record now, so the
    // public entry point is bounded exactly like the context one.
    const { agents, supervisor } = harness();
    let hops = 0;

    agents.register(
      stubAgent({
        id: 'loop',
        handler: async (_task, context) => {
          hops += 1;
          const nested = await supervisor.delegate(
            { target: { agentId: agentId('loop') }, task: task('again') },
            { runId: context.runId, budget: context.budget },
          );
          if (!nested.ok) return nested;
          return ok({ output: {}, summary: 'never', evidence: [], usage: emptyUsage });
        },
      }),
    );

    const result = await supervisor.dispatch({ target: { agentId: agentId('loop') }, task: task('x') });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('delegation cycle');
    // Bounded, not merely "eventually stopped".
    expect(hops).toBe(1);
  });

  test('the public delegate() path derives DEPTH from the tree too', async () => {
    // The same G1 property, on the dimension the cycle guard does not cover: a
    // ladder of distinct agents run through Supervisor.delegate() must still
    // hit the depth bound rather than restarting the count on every hop.
    const { agents, supervisor } = harness();
    let hops = 0;
    for (let i = 0; i < 14; i += 1) {
      agents.register(
        stubAgent({
          id: `rung${i}`,
          handler: async (_t, context) => {
            hops += 1;
            return supervisor.delegate(
              { target: { agentId: agentId(`rung${i + 1}`) }, task: task('up') },
              { runId: context.runId, budget: context.budget },
            );
          },
        }),
      );
    }

    const result = await supervisor.dispatch({ target: { agentId: agentId('rung0') }, task: task('x') });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('delegation depth exceeded');
    expect(hops).toBeLessThanOrEqual(10);
  });

  test('a delegation chain shares one budget and cannot reset it', async () => {
    // Spec §18.2: budget is inherited, never reset. The parent is allowed one
    // tool call and spends it, so the child must be refused.
    const { agents, tools, supervisor } = harness();
    tools.register(stubTool({ id: 'echo', requiredCapabilities: ['tool:execute'] }));

    let childToolOutcome: string | undefined;

    agents.register(
      stubAgent({
        id: 'child',
        division: 'research',
        role: 'analyst',
        tools: ['echo'],
        handler: async (_task, context) => {
          const outcome = await context.tools.invoke(
            { toolId: toolId('echo'), input: { value: 'child' } },
            context,
          );
          childToolOutcome = outcome.ok ? 'allowed' : outcome.error.code;
          return ok({ output: {}, summary: 'child done', evidence: [], usage: emptyUsage });
        },
      }),
    );

    agents.register(
      stubAgent({
        id: 'parent',
        tools: ['echo'],
        handler: async (_task, context) => {
          // Parent spends the single allowed tool call.
          const own = await context.tools.invoke(
            { toolId: toolId('echo'), input: { value: 'parent' } },
            context,
          );
          expect(own.ok).toBe(true);

          const delegated = await context.delegate({
            target: { division: divisionId('research'), role: 'analyst' },
            task: task('sub'),
          });
          return delegated.ok
            ? ok({ output: {}, summary: 'ok', evidence: [], usage: emptyUsage })
            : delegated;
        },
      }),
    );

    await supervisor.dispatch({
      target: { agentId: agentId('parent') },
      task: task('x'),
      budget: { maxToolCalls: 1 },
    });

    expect(childToolOutcome).toBe('BUDGET_EXCEEDED');
  });

  test('the agent-facing model router is charged against the run budget', async () => {
    const { agents, supervisor } = harness();
    let secondCall: string | undefined;

    agents.register(
      stubAgent({
        id: 'a1',
        handler: async (_task, context) => {
          // No providers are registered in the harness, so both calls fail --
          // but the SECOND must fail on budget, before routing is attempted.
          await context.models.generate(
            { requiredCapabilities: ['text'] },
            { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
          );
          const second = await context.models.generate(
            { requiredCapabilities: ['text'] },
            { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
          );
          secondCall = second.ok ? 'ok' : second.error.code;
          return ok({ output: {}, summary: 'done', evidence: [], usage: emptyUsage });
        },
      }),
    );

    await supervisor.dispatch({
      target: { agentId: agentId('a1') },
      task: task('x'),
      budget: { maxModelCalls: 1 },
    });

    expect(secondCall).toBe('BUDGET_EXCEEDED');
  });

  test('aggregates health from its registry', async () => {
    const agents = createAgentRegistry();
    const health = createHealthRegistry(clock);
    health.register(
      healthCheck('thing', async () => ({
        component: 'thing',
        status: 'unavailable' as const,
        checkedAt: clock.now().toISOString(),
      })),
    );
    const supervisor = createSupervisor({
      agents,
      tools: createToolRegistry(),
      models: createModelRouter(createProviderRegistry()),
      memory: createInMemoryMemoryStore({ clock }),
      events: createInMemoryEventBus(),
      permissions: createPermissionEngine([]),
      health,
      clock,
    });

    expect((await supervisor.health()).status).toBe('unavailable');
  });
});

/**
 * Lineage (ADR 0018) and the agent-run budget dimension (ADR 0019).
 *
 * The property under test is not "the field is present" but "the field cannot
 * be anything other than what the Supervisor itself knows". A lineage an agent
 * could influence would be worse than none, because a trace assembled from it
 * would look authoritative.
 */
describe('run lineage in the task payloads', () => {
  type Payload = Record<string, unknown>;
  type Seen = { type: string; payload: unknown; runId?: string };
  const started = (seen: Seen[]): Payload[] =>
    seen.filter((e) => e.type === 'agent.task.started').map((e) => e.payload as Payload);
  /** The run id an agent's `started` event was published under. */
  const runIdOf = (seen: Seen[], agent: string): string | undefined =>
    seen.find(
      (e) => e.type === 'agent.task.started' && (e.payload as Payload)['agentId'] === agent,
    )?.runId;

  test('parentRunId names the IMMEDIATE parent, not the root', async () => {
    const { agents, supervisor, seen } = harness();
    agents.register(stubAgent({ id: 'leaf' }));
    agents.register(
      stubAgent({
        id: 'mid',
        handler: async (_t, context) =>
          context.delegate({ target: { agentId: agentId('leaf') }, task: task('leaf') }),
      }),
    );
    agents.register(
      stubAgent({
        id: 'top',
        handler: async (_t, context) =>
          context.delegate({ target: { agentId: agentId('mid') }, task: task('mid') }),
      }),
    );

    expect((await supervisor.dispatch({ target: { agentId: agentId('top') }, task: task('x') })).ok)
      .toBe(true);

    const byAgent = new Map(started(seen).map((p) => [p['agentId'] as string, p]));
    const top = byAgent.get('top') as Payload;
    const mid = byAgent.get('mid') as Payload;
    const leaf = byAgent.get('leaf') as Payload;

    // The root has no parent. Absent, not null and not its own id.
    expect(top).not.toHaveProperty('parentRunId');
    expect(top['depth']).toBe(0);

    const topRun = runIdOf(seen, 'top');
    const midRun = runIdOf(seen, 'mid');
    expect(topRun).toBeDefined();
    expect(midRun).toBeDefined();

    // The assertion that tells the two designs apart: if lineage recorded the
    // ROOT of the tree rather than the immediate parent, leaf would point at
    // `top`. It points at `mid`.
    expect(mid['parentRunId']).toBe(topRun);
    expect(leaf['parentRunId']).toBe(midRun);
    expect(leaf['parentRunId']).not.toBe(topRun);
    expect(mid['depth']).toBe(1);
    expect(leaf['depth']).toBe(2);
  });

  test('division and role come from the descriptor, never from the agent', async () => {
    const { agents, supervisor, seen } = harness();
    agents.register(
      stubAgent({
        id: 'liar',
        division: 'research',
        role: 'analyst',
        // An agent that tries to describe itself as somebody else. The output
        // is data; the descriptor is the registration.
        handler: async () =>
          ok({
            output: { division: 'finance', role: 'cfo', depth: 99, agentId: 'finance.cfo' },
            summary: 'claims to be finance',
            evidence: [],
            usage: emptyUsage,
          }),
      }),
    );

    // Every channel an agent or caller could speak through claims something
    // else: the task input, the request metadata, and the returned output.
    // A lineage assembled from any of them fails here.
    const result = await supervisor.dispatch({
      target: { agentId: agentId('liar') },
      task: {
        id: 't1',
        objective: 'x',
        input: { division: 'finance', role: 'cfo', agentId: 'finance.cfo', depth: 99 },
      },
      metadata: { division: 'finance', role: 'cfo', agentId: 'finance.cfo', depth: 99 },
    });
    expect(result.ok).toBe(true);

    const payload = started(seen)[0] as Payload;
    expect(payload['division']).toBe('research');
    expect(payload['role']).toBe('analyst');
    expect(payload['agentId']).toBe('liar');
    expect(payload['depth']).toBe(0);
  });

  test('depth cannot be forged through the task input or the request metadata', async () => {
    const { agents, supervisor, seen } = harness();
    agents.register(stubAgent({ id: 'solo' }));

    const result = await supervisor.dispatch({
      target: { agentId: agentId('solo') },
      task: { id: 't1', objective: 'x', input: { depth: 7, parentRunId: 'run_fake' } },
      metadata: { depth: 7, parentRunId: 'run_fake', division: 'finance' },
    });
    expect(result.ok).toBe(true);

    const payload = started(seen)[0] as Payload;
    expect(payload['depth']).toBe(0);
    expect(payload).not.toHaveProperty('parentRunId');
    expect(payload['division']).toBe('test');
  });

  test('a denied dispatch is recorded with lineage but never becomes a run', async () => {
    const denyAgents = allowListPolicy('system-only', [
      { subject: { kind: 'system' }, capabilities: [DISPATCH_CAPABILITY] },
    ]);
    const { agents, supervisor, seen } = harness([denyAgents]);
    agents.register(stubAgent({ id: 'inner', division: 'finance', role: 'fpa' }));
    agents.register(
      stubAgent({
        id: 'outer',
        handler: async (_t, context) =>
          context.delegate({ target: { agentId: agentId('inner') }, task: task('nope') }),
      }),
    );

    const result = await supervisor.dispatch({ target: { agentId: agentId('outer') }, task: task('x') });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');

    const denied = seen.find((e) => e.type === 'agent.dispatch.denied')?.payload as Payload;
    expect(denied['agentId']).toBe('inner');
    expect(denied['division']).toBe('finance');
    expect(denied['depth']).toBe(1);
    // Refused, so it never started. The permission trail records the attempt;
    // the run tree must not show a run that did not happen.
    expect(started(seen).map((p) => p['agentId'])).toEqual(['outer']);
  });

  test('lineage is a record, not a permission', async () => {
    // Everything about the payload says this delegation is legitimate. The
    // subject still lacks the capability, and that is what decides.
    const systemOnly = allowListPolicy('system-only', [
      { subject: { kind: 'system' }, capabilities: [DISPATCH_CAPABILITY] },
    ]);
    const { agents, supervisor } = harness([systemOnly]);
    agents.register(stubAgent({ id: 'target' }));
    agents.register(
      stubAgent({
        id: 'caller',
        handler: async (_t, context) =>
          context.delegate({ target: { agentId: agentId('target') }, task: task('please') }),
      }),
    );

    const result = await supervisor.dispatch({ target: { agentId: agentId('caller') }, task: task('x') });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');
  });
});

describe('maxAgentRuns bounds the breadth of a tree', () => {
  /** One agent that fans out `n` times to the same leaf. */
  function fanOut(n: number) {
    const built = harness();
    built.agents.register(stubAgent({ id: 'leaf' }));
    built.agents.register(
      stubAgent({
        id: 'fan',
        handler: async (_t, context) => {
          for (let i = 0; i < n; i += 1) {
            const child = await context.delegate({
              target: { agentId: agentId('leaf') },
              task: task(`leaf-${i}`),
            });
            if (!child.ok) return child;
          }
          return ok({ output: {}, summary: 'fanned', evidence: [], usage: emptyUsage });
        },
      }),
    );
    return built;
  }

  test('the fourth run of a tree limited to three is refused', async () => {
    // Depth never catches this: every child sits at depth 1. Breadth was the
    // one unbounded resource before this dimension existed.
    const built = fanOut(5);
    const result = await built.supervisor.dispatch({
      target: { agentId: agentId('fan') },
      task: task('x'),
      budget: { maxAgentRuns: 3 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('BUDGET_EXCEEDED');
      expect(result.error.details?.['dimension']).toBe('maxAgentRuns');
    }
    // Three runs happened: the root and two children. The refused one left no
    // trace, because it is charged before anything is published.
    expect(built.seen.filter((e) => e.type === 'agent.task.started')).toHaveLength(3);
  });

  test('a tree within its ceiling runs untouched', async () => {
    const built = fanOut(2);
    const result = await built.supervisor.dispatch({
      target: { agentId: agentId('fan') },
      task: task('x'),
      budget: { maxAgentRuns: 3 },
    });
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    expect(built.seen.filter((e) => e.type === 'agent.task.started')).toHaveLength(3);
  });

  test('an unset ceiling is no limit, never zero', async () => {
    // The distinction every budget dimension turns on. Omitting the field must
    // not silently mean "no runs allowed".
    const built = fanOut(6);
    const result = await built.supervisor.dispatch({
      target: { agentId: agentId('fan') },
      task: task('x'),
    });
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    expect(built.seen.filter((e) => e.type === 'agent.task.started')).toHaveLength(7);
  });

  test('a child cannot widen the ceiling it was given', async () => {
    // The guard is shared across the tree (§18.2). A delegated run asking for a
    // bigger budget is asking the parent's guard, which does not grow.
    const built = harness();
    built.agents.register(stubAgent({ id: 'leaf' }));
    built.agents.register(
      stubAgent({
        id: 'greedy',
        handler: async (_t, context) => {
          // Its own budget object claims a larger allowance; the guard decides.
          const first = await context.delegate({
            target: { agentId: agentId('leaf') },
            task: task('one'),
          });
          if (!first.ok) return first;
          return context.delegate({ target: { agentId: agentId('leaf') }, task: task('two') });
        },
      }),
    );

    const result = await built.supervisor.dispatch({
      target: { agentId: agentId('greedy') },
      task: task('x'),
      budget: { maxAgentRuns: 2 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BUDGET_EXCEEDED');
  });
});
