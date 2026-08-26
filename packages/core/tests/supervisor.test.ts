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
  const seen: { type: string; payload: unknown }[] = [];
  events.subscribe('*', (e) => void seen.push({ type: e.type, payload: e.payload }));

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

  test('breaks a delegation cycle instead of recursing forever', async () => {
    const { agents, supervisor } = harness();
    agents.register(
      stubAgent({
        id: 'loop',
        handler: async (_task, context) => {
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
    if (!result.ok) expect(result.error.message).toContain('delegation depth exceeded');
  });

  test('derives delegation depth from the run tree, not from the caller (G1)', async () => {
    // An Orchestrator (Phase 4) will call the PUBLIC Supervisor.delegate(), not
    // context.delegate(). That path used to pass a hardcoded depth of 1, so the
    // cycle guard never fired and a loop recursed until the stack died.
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
    if (!result.ok) expect(result.error.message).toContain('delegation depth exceeded');
    // Bounded, not merely "eventually stopped".
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
