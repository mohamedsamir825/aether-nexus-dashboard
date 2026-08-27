/**
 * `bun run demo` — the vertical slice, against real configuration.
 *
 * Assembles the real system from the real environment and runs one task through
 * every layer: permissions, tool belt, schema validation, a real tool, evidence,
 * budget, events.
 *
 * With no API key configured this reports the model layer as unavailable and
 * the tool path as working. That is the honest state of Phase 4, and printing
 * anything rosier would be the fake demo this project exists not to build.
 */
import { createMathEvaluateTool, MATH_EVALUATE_TOOL_ID } from '@nexus/tool-arithmetic';
import { createNexusSystem } from '../system.ts';
import { describeConfig, loadConfig } from '../config/config.ts';
import { DISPATCH_CAPABILITY } from '../runtime/supervisor.ts';
import { allowListPolicy } from '../runtime/permissions.ts';
import { nullLogger } from '../logger.ts';
import { ok } from '../result.ts';
import { agentId, divisionId } from '../ids.ts';
import { emptyUsage } from '../contracts/execution.ts';
import type { AnyAgent, AgentContext, AgentTask } from '../contracts/agent.ts';

const line = (label: string, value: string) => console.log(`  ${label.padEnd(22)} ${value}`);
const heading = (text: string) => console.log(`\n\x1b[1m${text}\x1b[0m`);

const config = loadConfig(process.env);
if (!config.ok) {
  console.error('configuration is invalid:', config.error.message);
  process.exit(2);
}

const system = createNexusSystem({
  config: config.value,
  // Deny-by-default means nothing runs until something is granted.
  policies: [
    allowListPolicy('demo', [
      { subject: { kind: 'system' }, capabilities: [DISPATCH_CAPABILITY] },
      { subject: { kind: 'agent' }, capabilities: [DISPATCH_CAPABILITY, 'tool:execute'] },
    ]),
  ],
  logger: nullLogger,
});

system.registries.tools.register(createMathEvaluateTool());

/** Written here on purpose: divisions are Phase 5. This is a demo agent. */
const calculator: AnyAgent = {
  descriptor: {
    id: agentId('demo.calculator'),
    division: divisionId('demo'),
    role: 'calculator',
    displayName: 'Calculator',
    description: 'Demo agent for the vertical slice.',
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
      output,
      summary: `${String(task.input)} = ${output.result}`,
      evidence: outcome.value.evidence ?? [],
      usage: { ...emptyUsage, toolCalls: 1 },
    });
  },
};
system.registries.agents.register(calculator);

const trace: string[] = [];
system.events.subscribe('*', (event) => void trace.push(event.type));

const expression = process.argv[2] ?? '(2 + 3) * 4 ^ 2';

console.log('\n\x1b[1mNEXUS — vertical slice\x1b[0m');

heading('Configuration');
const summary = describeConfig(config.value);
line('environment', summary.environment);
// Presence only. describeConfig never emits key material.
const configured = summary.providers.filter((p) => p.credentialPresent).map((p) => p.id);
line('credentials present', configured.length > 0 ? configured.join(', ') : 'none');

heading('Run');
line('expression', expression);

const started = Date.now();
const result = await system.supervisor.dispatch({
  target: { agentId: agentId('demo.calculator') },
  task: { id: 'demo-1', objective: 'evaluate an expression', input: expression },
  budget: { maxToolCalls: 4, maxModelCalls: 2, timeoutMs: 10_000 },
});

if (result.ok) {
  line('result', String((result.value.output as { result: number }).result));
  line('summary', result.value.summary);
  for (const evidence of result.value.evidence) {
    line('evidence', `${evidence.claim}  (${evidence.source.kind}, confidence ${evidence.confidence})`);
  }
} else {
  line('failed', `${result.error.code}: ${result.error.message}`);
}
line('duration', `${Date.now() - started}ms`);
line('events', trace.join(' → '));

heading('Health');
const health = await system.reportHealth();
line('system', health.status);
for (const component of health.components) {
  line(`  ${component.component}`, `${component.status}${component.detail ? ` — ${component.detail}` : ''}`);
}

heading('What this proves');
console.log('  A task crossed every layer the architecture claims to have:');
console.log('  dispatch → permissions → tool belt → schema → tool → evidence → budget → events.');
if (health.status === 'unavailable') {
  console.log('\n  The model layer is unavailable because no provider adapter is');
  console.log('  registered. That is the honest state, not a failure of the run:');
  console.log('  add a free API key to .env and register an adapter to change it.');
}
console.log('');

process.exit(result.ok ? 0 : 1);
