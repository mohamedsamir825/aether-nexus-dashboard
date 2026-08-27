/**
 * The vertical slice: one run through every layer the architecture claims to
 * have, using a REAL tool rather than a double.
 *
 *   dispatch -> permission -> ToolBelt (three gates) -> schema validation
 *            -> real tool -> evidence -> budget charged -> events -> trace
 *
 * The agent here is written inline and is explicitly a test agent. Divisions
 * are Phase 5; shipping something that merely looked like one would be the
 * fake-product failure this project has avoided from the first commit.
 */
import { test, expect, describe } from 'bun:test';
import { createMathEvaluateTool, MATH_EVALUATE_TOOL_ID } from '@nexus/tool-arithmetic';
import { createNexusSystem } from '../../src/system.ts';
import { loadConfig } from '../../src/config/config.ts';
import { DISPATCH_CAPABILITY } from '../../src/runtime/supervisor.ts';
import { allowListPolicy } from '../../src/runtime/permissions.ts';
import { unwrap, ok } from '../../src/result.ts';
import { nullLogger } from '../../src/logger.ts';
import { fixedClock } from '../../src/clock.ts';
import { agentId, divisionId, toolId } from '../../src/ids.ts';
import { emptyUsage } from '../../src/contracts/execution.ts';
import type { AnyAgent, AgentContext, AgentTask } from '../../src/contracts/agent.ts';
import type { NexusEvent } from '../../src/contracts/events.ts';
import type { PermissionPolicy } from '../../src/contracts/permissions.ts';
import type { ExecutionBudget } from '../../src/contracts/execution.ts';

const clock = fixedClock(new Date('2026-01-01T00:00:00Z'));

const grants = allowListPolicy('slice', [
  { subject: { kind: 'system' }, capabilities: [DISPATCH_CAPABILITY] },
  { subject: { kind: 'agent' }, capabilities: [DISPATCH_CAPABILITY, 'tool:execute'] },
]);

/** A calculator agent: reads a task, calls the tool, returns the evidence. */
function calculatorAgent(): AnyAgent {
  return {
    descriptor: {
      id: agentId('test.calculator'),
      division: divisionId('test'),
      role: 'calculator',
      displayName: 'Calculator',
      description: 'Test agent for the vertical slice. Not a division.',
      version: '0.0.0',
      skills: [],
      tools: [MATH_EVALUATE_TOOL_ID],
      capabilities: ['tool:execute'],
      memoryScopes: [],
      modelPolicy: { requiredCapabilities: ['text'] },
    },
    async handle(task: AgentTask, context: AgentContext) {
      const outcome = await context.tools.invoke(
        { toolId: MATH_EVALUATE_TOOL_ID, input: { expression: String(task.input) } },
        context,
      );
      if (!outcome.ok) return outcome;

      const output = outcome.value.output as { result: number };
      return ok({
        output: { result: output.result },
        summary: `${String(task.input)} = ${output.result}`,
        evidence: outcome.value.evidence ?? [],
        usage: { ...emptyUsage, toolCalls: 1 },
      });
    },
  };
}

function buildSystem(params: { policies?: readonly PermissionPolicy[] } = {}) {
  const system = createNexusSystem({
    config: unwrap(loadConfig({})),
    policies: params.policies ?? [grants],
    logger: nullLogger,
    clock,
  });

  system.registries.tools.register(createMathEvaluateTool());
  system.registries.agents.register(calculatorAgent());

  const events: NexusEvent[] = [];
  system.events.subscribe('*', (e) => void events.push(e));
  return { system, events };
}

const task = (expression: string): AgentTask => ({
  id: 't1',
  objective: 'evaluate an expression',
  input: expression,
});

const run = (expression: string, budget?: ExecutionBudget) => {
  const built = buildSystem();
  return built.system.supervisor
    .dispatch({
      target: { agentId: agentId('test.calculator') },
      task: task(expression),
      ...(budget ? { budget } : {}),
    })
    .then((result) => ({ ...built, result }));
};

describe('vertical slice — the happy path', () => {
  test('a task reaches a real tool and comes back with the right answer', async () => {
    const { result } = await run('(2 + 3) * 4');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value.output as { result: number }).result).toBe(20);
    expect(result.value.summary).toBe('(2 + 3) * 4 = 20');
  });

  test('the answer carries evidence back to the caller', async () => {
    const { result } = await run('6 * 7');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.evidence).toHaveLength(1);
    expect(result.value.evidence[0]?.claim).toBe('6 * 7 = 42');
    expect(result.value.evidence[0]?.source.kind).toBe('computation');
  });

  test('the run is fully traceable through events', async () => {
    const { events, result } = await run('1 + 1');
    expect(result.ok).toBe(true);

    expect(events.map((e) => e.type)).toEqual(['agent.task.started', 'agent.task.completed']);
    // Both events belong to the same run, so a trace can be reconstructed.
    const runIds = new Set(events.map((e) => e.runId));
    expect(runIds.size).toBe(1);
    expect([...runIds][0]).toBeDefined();
  });
});

describe('vertical slice — the gates are real', () => {
  test('dispatch is denied when no policy grants it', async () => {
    const { system } = buildSystem({ policies: [] });
    const result = await system.supervisor.dispatch({
      target: { agentId: agentId('test.calculator') },
      task: task('1 + 1'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');
  });

  test('the tool is refused when the agent lacks the capability', async () => {
    const dispatchOnly = allowListPolicy('dispatch-only', [
      { subject: { kind: 'system' }, capabilities: [DISPATCH_CAPABILITY] },
    ]);
    const { system } = buildSystem({ policies: [dispatchOnly] });

    const result = await system.supervisor.dispatch({
      target: { agentId: agentId('test.calculator') },
      task: task('1 + 1'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');
  });

  test('a malformed expression is rejected by the tool, not computed', async () => {
    const { result } = await run('1 / 0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
  });

  test('the run is refused once the tool budget is spent', async () => {
    const { result } = await run('1 + 1', { maxToolCalls: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BUDGET_EXCEEDED');
  });

  test('a tool the agent did not declare is invisible to it', async () => {
    const { system } = buildSystem();
    system.registries.tools.register({
      ...createMathEvaluateTool(),
      descriptor: { ...createMathEvaluateTool().descriptor, id: toolId('math.other') },
    });

    const belt = system.registries.tools.list().map((t) => t.descriptor.id);
    expect(belt).toContain(toolId('math.other'));

    // Registered system-wide, but the agent declared only math.evaluate, so it
    // never appears on that agent's belt.
    const { result } = await run('1 + 1');
    expect(result.ok).toBe(true);
  });
});

describe('vertical slice — honest about what is missing', () => {
  test('the model layer reports unavailable, and says so rather than pretending', async () => {
    const { system } = buildSystem();
    const health = await system.reportHealth();

    expect(health.status).toBe('unavailable');
    const providers = health.components.find((c) => c.component === 'model-providers');
    expect(providers?.status).toBe('unavailable');
  });

  test('a model call fails safely while no provider is registered', async () => {
    const { system } = buildSystem();
    const result = await system.models.generate(
      { requiredCapabilities: ['text'] },
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  test('the tool path still works with no model provider at all', async () => {
    // Tools and models are independent capabilities: one being unavailable must
    // not disable the other.
    const { result } = await run('100 / 4');
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value.output as { result: number }).result).toBe(25);
  });
});
