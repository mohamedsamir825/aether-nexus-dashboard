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
