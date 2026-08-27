import { test, expect, describe } from 'bun:test';
import { agentId, divisionId } from '../src/ids.ts';
import { ok } from '../src/result.ts';
import { emptyUsage } from '../src/contracts/execution.ts';
import { installDivision } from '../src/runtime/install-division.ts';
import type { AnyAgent } from '../src/contracts/agent.ts';
import type { Division, DivisionDescriptor } from '../src/contracts/division.ts';

const DIV = divisionId('example');

const agent = (id: string, role: string, capabilities: string[] = ['tool:execute']): AnyAgent => ({
  descriptor: {
    id: agentId(id),
    division: DIV,
    role,
    displayName: id,
    description: 'test agent',
    version: '1.0.0',
    skills: [],
    tools: [],
    capabilities,
    memoryScopes: [],
    modelPolicy: { requiredCapabilities: ['text'], allowFallback: true },
  },
  async handle() {
    return ok({ output: null, summary: '', evidence: [], usage: emptyUsage });
  },
});

const descriptor = (over: Partial<DivisionDescriptor> = {}): DivisionDescriptor => ({
  id: DIV,
  displayName: 'Example',
  description: 'test division',
  version: '1.0.0',
  agents: [agentId('a.one')],
  entryPoints: ['one'],
  requiredCapabilities: ['tool:execute'],
  ...over,
});

const division = (d: DivisionDescriptor, agents: readonly AnyAgent[]): Division => ({
  descriptor: d,
  install(installer) {
    for (const a of agents) {
      const registered = installer.registerAgent(a);
      if (!registered.ok) return registered;
    }
    return ok(undefined);
  },
});

const install = (d: Division) =>
  installDivision({ division: d, registerAgent: () => ok(null), registerTool: () => ok(null) });

describe('a division is held to its own descriptor', () => {
  test('a truthful division installs', () => {
    const result = install(division(descriptor(), [agent('a.one', 'one')]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.agents).toHaveLength(1);
  });

  test('a roster naming an agent it never registers is caught', () => {
    // Before this check, the mistake surfaced much later as a delegation
    // failing with NOT_FOUND for reasons nobody traces back to a string array.
    const result = install(
      division(descriptor({ agents: [agentId('a.one'), agentId('a.ghost')] }), [
        agent('a.one', 'one'),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('never registered');
  });

  test('an agent registered without being on the roster is caught', () => {
    const result = install(
      division(descriptor(), [agent('a.one', 'one'), agent('a.secret', 'secret')]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('without declaring it');
  });

  test('an entry point no agent serves is caught', () => {
    // §3.2 says entry points are the surface other divisions may address.
    // Publishing one that resolves to nothing is a broken promise, not a typo.
    const result = install(
      division(descriptor({ entryPoints: ['one', 'nobody'] }), [agent('a.one', 'one')]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("'nobody' is served by no registered agent");
  });

  test('an undeclared capability is caught — the check that matters most', () => {
    // A division whose agents need more than it declares has a stated blast
    // radius smaller than its real one, which defeats the point of the field.
    const result = install(
      division(descriptor(), [agent('a.one', 'one', ['tool:execute', 'secrets:read'])]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("needs 'secrets:read'");
  });

  test('every problem is reported at once, not just the first', () => {
    const result = install(
      division(descriptor({ entryPoints: ['nobody'] }), [
        agent('a.other', 'other', ['tool:execute', 'x:y']),
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const problems = result.error.details?.problems as string[];
      expect(problems.length).toBeGreaterThan(2);
    }
  });

  test('a failing install is returned as-is, not masked by descriptor problems', () => {
    const failing: Division = {
      descriptor: descriptor(),
      install: () => ({ ok: false, error: { code: 'INTERNAL', message: 'boom' } }) as never,
    };
    const result = installDivision({
      division: failing,
      registerAgent: () => ok(null),
      registerTool: () => ok(null),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('boom');
  });
});
