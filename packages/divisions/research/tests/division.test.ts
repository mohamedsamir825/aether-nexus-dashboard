/**
 * The Research vertical slice, end to end through the real Core.
 *
 *   request -> Supervisor -> permissions -> ToolBelt -> retrieval
 *           -> evidence -> claims -> verification -> contradictions
 *           -> synthesis -> ResearchResult
 *
 * Deterministic fixtures throughout. No network, no live pages, no model, no
 * credential, no cost.
 */
import { test, expect, describe } from 'bun:test';
import {
  DISPATCH_CAPABILITY,
  allowListPolicy,
  agentId,
  createNexusSystem,
  divisionId,
  fixedClock,
  loadConfig,
  nullLogger,
  unwrap,
  type NexusEvent,
  type PermissionPolicy,
} from '@nexus/core';
import { createFixtureRetriever } from '../src/retrieval.ts';
import { createResearchDivision } from '../src/division.ts';
import { RESEARCH_RETRIEVE_TOOL_ID } from '../src/tool.ts';
import type { ResearchResult } from '../src/types.ts';
import {
  agreeingCorpus,
  conflictingCorpus,
  hostileCorpus,
  numericConflictCorpus,
} from './fixtures.ts';

const clock = fixedClock(new Date('2026-06-01T12:00:00Z'));

const fullGrant = allowListPolicy('research', [
  { subject: { kind: 'system' }, capabilities: [DISPATCH_CAPABILITY] },
  {
    subject: { kind: 'agent' },
    capabilities: [DISPATCH_CAPABILITY, 'tool:execute', 'research:retrieve'],
  },
]);

function build(corpus: typeof agreeingCorpus, policies: readonly PermissionPolicy[] = [fullGrant]) {
  const system = createNexusSystem({
    config: unwrap(loadConfig({})),
    policies,
    logger: nullLogger,
    clock,
  });

  const division = createResearchDivision({
    retriever: createFixtureRetriever({ documents: corpus, now: () => clock.now() }),
  });

  // The division installs itself through the narrow installer surface.
  const installed = division.install({
    registerAgent: (agent) => system.registries.agents.register(agent),
    registerTool: (tool) => system.registries.tools.register(tool),
  });
  expect(installed.ok).toBe(true);

  const events: NexusEvent[] = [];
  system.events.subscribe('*', (e) => void events.push(e));
  return { system, division, events };
}

const ask = (
  built: ReturnType<typeof build>,
  question: string,
  subjects: readonly string[],
) =>
  built.system.supervisor.dispatch({
    target: { agentId: agentId('research.analyst') },
    task: { id: 'r1', objective: 'research', input: { question, subjects } },
  });

describe('division contract', () => {
  test('declares identity, roster and entry points', () => {
    const { division } = build(agreeingCorpus);
    expect(division.descriptor.id).toBe(divisionId('research'));
    expect(division.descriptor.agents).toHaveLength(1);
    // Narrower than the roster: internals are not addressable from outside.
    expect(division.descriptor.entryPoints).toEqual(['analyst']);
  });

  test('declares the capabilities it needs rather than assuming them', () => {
    const { division } = build(agreeingCorpus);
    expect(division.descriptor.requiredCapabilities).toContain('research:retrieve');
  });

  test('installs exactly one agent and one tool', () => {
    const { system } = build(agreeingCorpus);
    expect(system.registries.agents.size).toBe(1);
    expect(system.registries.tools.size).toBe(1);
  });

  test('reports health', async () => {
    const { division } = build(agreeingCorpus);
    expect((await division.health?.())?.status).toBe('healthy');
  });
});

describe('the vertical slice', () => {
  test('a research request returns a structured result', async () => {
    const built = build(agreeingCorpus);
    const result = await ask(built, 'is the harbour seal population recovering?', [
      'harbour seal population',
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const research = result.value.output as ResearchResult;

    expect(research.sources.length).toBeGreaterThan(0);
    expect(research.evidence.length).toBeGreaterThan(0);
    expect(research.claims.length).toBeGreaterThan(0);
    expect(research.verifications).toHaveLength(research.claims.length);
    expect(research.synthesis.length).toBeGreaterThan(0);
  });

  test('claims are typed, not undifferentiated prose', async () => {
    const built = build(agreeingCorpus);
    const result = await ask(built, 'harbour seal population', ['harbour seal population']);
    if (!result.ok) throw new Error('expected success');
    const research = result.value.output as ResearchResult;

    const statuses = new Set(research.claims.map((c) => c.status));
    expect(statuses.has('fact')).toBe(true);
    expect(statuses.has('inference')).toBe(true);
  });

  test('provenance survives the whole chain: source -> evidence -> claim', async () => {
    const built = build(agreeingCorpus);
    const result = await ask(built, 'harbour seal population', ['harbour seal population']);
    if (!result.ok) throw new Error('expected success');
    const research = result.value.output as ResearchResult;

    const fact = research.claims.find((c) => c.status === 'fact');
    expect(fact).toBeDefined();

    const cited = research.evidence.find((e) => e.id === fact?.supportedBy[0]);
    expect(cited).toBeDefined();
    expect(cited?.source.uri).toStartWith('fixture:');
    expect(cited?.source.retrievedAt).toBe('2026-06-01T12:00:00.000Z');
    expect(cited?.excerpt).toBeTruthy();

    const source = research.sources.find((s) => s.locator === cited?.source.uri);
    expect(source).toBeDefined();
  });

  test('a subject with no source becomes uncertain, and the run still succeeds', async () => {
    const built = build(agreeingCorpus);
    const result = await ask(built, 'harbour seal population', [
      'harbour seal population',
      'volcanic activity',
    ]);
    if (!result.ok) throw new Error('expected success');
    const research = result.value.output as ResearchResult;

    const unknown = research.claims.find((c) => c.subject === 'volcanic activity');
    expect(unknown?.status).toBe('uncertain');
    expect(unknown?.uncertaintyReason).toBeTruthy();
  });

  test('a query matching nothing yields uncertainty rather than a failure', async () => {
    const built = build(agreeingCorpus);
    const result = await ask(built, 'quantum chromodynamics', ['quarks']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const research = result.value.output as ResearchResult;
    expect(research.claims.every((c) => c.status === 'uncertain')).toBe(true);
    expect(research.confidence).toBe(0);
  });

  test('the run is traceable through events', async () => {
    const built = build(agreeingCorpus);
    await ask(built, 'harbour seal population', ['harbour seal population']);
    expect(built.events.map((e) => e.type)).toEqual([
      'agent.task.started',
      'agent.task.completed',
    ]);
  });

  test('synthesis is derived, and says it was not model-written', async () => {
    const built = build(agreeingCorpus);
    const result = await ask(built, 'harbour seal population', ['harbour seal population']);
    if (!result.ok) throw new Error('expected success');
    const research = result.value.output as ResearchResult;

    // No provider is registered, so the deterministic writer produced this and
    // the flag says so rather than the result going silent.
    expect(research.synthesisFromModel).toBe(false);
    expect(research.synthesis).toContain('Sources state');
  });
});

describe('contradictions stay visible', () => {
  test('opposing sources produce a recorded conflict', async () => {
    const built = build(conflictingCorpus);
    const result = await ask(built, 'harbour seal population', ['harbour seal population']);
    if (!result.ok) throw new Error('expected success');
    const research = result.value.output as ResearchResult;

    expect(research.contradictions.length).toBeGreaterThan(0);
    // Both claims survive; neither is merged away (§19.2).
    expect(research.claims.filter((c) => c.status === 'fact').length).toBeGreaterThanOrEqual(2);
    expect(research.synthesis).toContain('Unresolved conflicts');
  });

  test('disagreeing numbers produce a recorded conflict', async () => {
    const built = build(numericConflictCorpus);
    const result = await ask(built, 'harbour seals recorded', ['harbour seals']);
    if (!result.ok) throw new Error('expected success');
    const research = result.value.output as ResearchResult;
    expect(research.contradictions.length).toBeGreaterThan(0);
  });

  test('an unresolved conflict lowers aggregate confidence', async () => {
    const agreed = build(agreeingCorpus);
    const conflicted = build(conflictingCorpus);

    const a = await ask(agreed, 'harbour seal population', ['harbour seal population']);
    const c = await ask(conflicted, 'harbour seal population', ['harbour seal population']);
    if (!a.ok || !c.ok) throw new Error('expected success');

    const agreedResult = a.value.output as ResearchResult;
    const conflictedResult = c.value.output as ResearchResult;
    expect(conflictedResult.confidence).toBeLessThan(agreedResult.confidence);
  });
});

describe('permissions are enforced, not assumed', () => {
  test('dispatch is denied with no grant', async () => {
    const built = build(agreeingCorpus, []);
    const result = await ask(built, 'harbour seal population', ['harbour seal population']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');
  });

  test('retrieval is refused without the research:retrieve capability', async () => {
    // Declaring a capability requests it; only policy grants it (ADR 0005).
    const partial = allowListPolicy('partial', [
      { subject: { kind: 'system' }, capabilities: [DISPATCH_CAPABILITY] },
      { subject: { kind: 'agent' }, capabilities: [DISPATCH_CAPABILITY, 'tool:execute'] },
    ]);
    const built = build(agreeingCorpus, [partial]);
    const result = await ask(built, 'harbour seal population', ['harbour seal population']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');
  });

  test('an invalid request is rejected before anything runs', async () => {
    const built = build(agreeingCorpus);
    const result = await built.system.supervisor.dispatch({
      target: { agentId: agentId('research.analyst') },
      task: { id: 'bad', objective: 'research', input: { question: '', subjects: [] } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
  });
});

describe('retrieved content is DATA, never instructions', () => {
  test('an injected instruction is excerpted and attributed, never obeyed', async () => {
    const built = build(hostileCorpus);
    const result = await ask(built, 'harbour seal population', ['harbour seal population']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const research = result.value.output as ResearchResult;

    // The hostile text names a tool and demands a capability, and it DID reach
    // the result -- quoted verbatim and attributed to its source, which is
    // exactly what evidence is. Being carried is not the risk; being obeyed is.
    const quoted = research.evidence.some((e) => e.excerpt?.includes('IGNORE ALL PREVIOUS'));
    expect(quoted).toBe(true);
    expect(research.claims.some((c) => c.statement.includes('states:'))).toBe(true);

    // And it changed nothing: one retrieval, the declared tool, normal events.
    expect(built.events.map((e) => e.type)).toEqual([
      'agent.task.started',
      'agent.task.completed',
    ]);
    expect(result.value.usage.toolCalls).toBe(1);
  });

  test('the hostile document cannot widen the agent tool belt', async () => {
    const built = build(hostileCorpus);
    await ask(built, 'harbour seal population', ['harbour seal population']);
    // Still exactly the one tool the division installed.
    expect(built.system.registries.tools.list().map((t) => t.descriptor.id)).toEqual([
      RESEARCH_RETRIEVE_TOOL_ID,
    ]);
  });

  test('the hostile document cannot grant itself a capability', async () => {
    const built = build(hostileCorpus);
    await ask(built, 'harbour seal population', ['harbour seal population']);
    // Deny-by-default is unchanged by anything a document said.
    const decision = built.system.permissions.check({
      subject: { kind: 'agent', id: 'research.analyst' },
      capability: 'admin',
    });
    expect(decision.allowed).toBe(false);
  });
});
