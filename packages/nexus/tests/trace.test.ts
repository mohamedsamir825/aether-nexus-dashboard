/**
 * The real chain, reconstructed from its own event trail.
 *
 * Every other test of lineage uses stub agents, which proves the Supervisor
 * stamps what it is told to stamp. This one runs the actual
 * Business → {Research, Finance} chain through `assembleNexus` on the standard
 * policy, and rebuilds the tree from nothing but the events it published.
 *
 * That is the claim worth making: after a real run, you can say who called
 * whom. Before this slice you could count eleven runs and not relate any two.
 */
import { test, expect, describe, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentId,
  buildRunTree,
  fixedClock,
  loadConfig,
  nullLogger,
  unwrap,
  type NexusEvent,
  type RunNode,
} from '@nexus/core';
import { createFixtureRetriever } from '@nexus/division-research';
import { createFixtureActualsSource } from '@nexus/division-finance';
import { assembleNexus } from '../src/assemble.ts';
import { createNodeFileSystem } from '../src/filesystem.ts';
import { NEXUS_POLICIES } from '../src/policy.ts';

const clock = fixedClock(new Date('2026-06-01T12:00:00Z'));
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-trace-'));
  directories.push(dir);
  return dir;
}

const CORPUS = [
  {
    source: {
      id: 'outlook',
      title: 'Sector Outlook 2026',
      locator: 'fixture:outlook',
      publisher: 'Trade Body',
      publishedAt: '2026-02-01',
    },
    text:
      'Enterprise buyers increasingly prefer hosted delivery. ' +
      'Self-hosted deployments continue to decline across the sector.',
  },
];

const ACTUALS = {
  period: '2026-Q1',
  validatedAt: '2026-04-05T09:00:00.000Z',
  validatedBy: agentId('finance.controller'),
  amounts: [{ lineItem: 'revenue', period: '2026-Q1', value: 56_000, origin: 'actual' as const }],
};

const BASELINE = {
  id: 'fv_base',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: agentId('finance.fpa'),
  runId: 'run_seed' as never,
  supersedes: null,
  reason: 'opening plan',
  drivers: [{ id: 'units', displayName: 'Units', value: 1_000, basis: 'plan' }],
  amounts: [{ lineItem: 'revenue', period: '2026-Q1', value: 50_000, origin: 'forecast' as const }],
  confidence: 0.8,
};

function boot(dir: string) {
  const events: NexusEvent[] = [];
  const assembled = assembleNexus({
    config: unwrap(loadConfig({})),
    memoryPath: join(dir, 'memory.log'),
    fs: createNodeFileSystem(),
    retriever: createFixtureRetriever({ documents: CORPUS, now: () => clock.now() }),
    actuals: createFixtureActualsSource([ACTUALS]),
    sensitivities: { revenue: { units: 50 } },
    horizon: ['2026-Q1'],
    observedDrivers: { '2026-Q1': [{ id: 'units', value: 1_120 }] },
    clock,
    logger: nullLogger,
    policies: NEXUS_POLICIES,
  });
  expect(assembled.ok, assembled.ok ? '' : assembled.error.message).toBe(true);
  if (!assembled.ok) throw new Error(assembled.error.message);
  assembled.value.system.events.subscribe('*', (e) => void events.push(e));
  return { nexus: assembled.value, events };
}

const strategy = (booted: ReturnType<typeof boot>, budget?: { maxAgentRuns: number }) =>
  booted.nexus.system.supervisor.dispatch({
    target: { agentId: agentId('business.strategy') },
    task: {
      id: 'strategy-1',
      objective: 'strategy',
      input: {
        question: 'Should we self-host or move to hosted delivery?',
        criteria: ['hosted delivery', 'revenue'],
        pricingPeriod: '2026-Q1',
        options: [
          {
            id: 'self-host',
            label: 'Keep self-hosting',
            description: 'Continue running our own infrastructure',
            marketQuestions: ['hosted delivery'],
            costDrivers: ['revenue'],
            pricingBaseline: BASELINE,
          },
          {
            id: 'hosted',
            label: 'Move to hosted',
            description: 'Adopt a hosted delivery model',
            marketQuestions: ['hosted delivery'],
            costDrivers: ['revenue'],
            pricingBaseline: BASELINE,
          },
        ],
      },
    },
    ...(budget !== undefined ? { budget } : {}),
  });

/** Every node, depth-first, so a whole tree can be asserted over. */
function flatten(nodes: readonly RunNode[]): RunNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

describe('the real chain reconstructs from its own events', () => {
  test('one root, and every delegated run hangs off the run that asked for it', async () => {
    const booted = boot(tempDir());
    const result = await strategy(booted);
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);

    const tree = buildRunTree(booted.events);

    // Exactly one root: the Business run the user dispatched. Everything else
    // is somebody's child, which is the property that was unassertable before.
    expect(tree.roots).toHaveLength(1);
    expect(tree.orphans).toHaveLength(0);
    expect(tree.unreadable).toBe(0);

    const root = tree.roots[0] as RunNode;
    expect(root.agentId).toBe('business.strategy');
    expect(root.division).toBe('business');
    expect(root.role).toBe('strategy');
    expect(root.depth).toBe(0);
    expect(root.parentRunId).toBeUndefined();
    expect(root.status).toBe('completed');

    // Two options, each asking Research once and Finance once.
    const children = root.children;
    expect(children).toHaveLength(4);
    expect(children.every((c) => c.depth === 1)).toBe(true);
    expect(children.every((c) => c.parentRunId === root.runId)).toBe(true);
    expect(children.filter((c) => c.division === 'research')).toHaveLength(2);
    expect(children.filter((c) => c.division === 'finance')).toHaveLength(2);

    // Two levels here, and the trace is what shows why: Finance only delegates
    // on to Research when it is GIVEN market inputs to source, and Business
    // asks Research itself rather than routing that through Finance. Asserting
    // a third level would have been asserting a chain this system does not run.
    expect(children.flatMap((c) => c.children)).toHaveLength(0);
    expect(flatten(tree.roots)).toHaveLength(5);

    // Research is asked twice, once per option. Repeated, never a cycle: it is
    // never its own ancestor.
    const research = flatten(tree.roots).filter((n) => n.division === 'research');
    expect(research).toHaveLength(2);
    expect(new Set(research.map((r) => r.runId)).size).toBe(2);
  });

  test('every node names a division and a role from its descriptor', async () => {
    const booted = boot(tempDir());
    expect((await strategy(booted)).ok).toBe(true);

    const nodes = flatten(buildRunTree(booted.events).roots);
    expect(nodes.length).toBeGreaterThan(4);
    for (const node of nodes) {
      expect(node.division, `${node.agentId} had no division`).toBeDefined();
      expect(node.role, `${node.agentId} had no role`).toBeDefined();
      expect(node.agentId.startsWith(node.division as string)).toBe(true);
    }
  });

  test('the tree contains exactly the runs the chain performed', async () => {
    // Not "at least": a trace with a phantom run is as wrong as one missing a
    // real one, so the count is pinned against the raw event trail.
    const booted = boot(tempDir());
    expect((await strategy(booted)).ok).toBe(true);

    const startedRuns = new Set(
      booted.events.filter((e) => e.type === 'agent.task.started').map((e) => e.runId),
    );
    expect(buildRunTree(booted.events).total).toBe(startedRuns.size);
  });
});

describe('the run budget bounds the real chain', () => {
  test('a ceiling below what the chain needs stops it, and says so rather than going quiet', async () => {
    // Business does not abort when a delegation fails — it reports the input
    // as unestablished, which is right. So the ceiling shows up as a degraded
    // answer, and the whole point of `refusals` is that the answer says which
    // gaps were the system's own doing rather than the evidence's.
    const booted = boot(tempDir());
    const result = await strategy(booted, { maxAgentRuns: 3 });

    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    if (!result.ok) return;
    const set = result.value.output as {
      unsourced: readonly string[];
      refusals: readonly { code: string; division: string }[];
      narrative: string;
    };

    // Three runs started and no more — the refused ones published nothing.
    const tree = buildRunTree(booted.events);
    expect(tree.total).toBe(3);
    expect(tree.roots).toHaveLength(1);

    // The gap is named AND attributed. Without `refusals` this run would be
    // indistinguishable from one where the corpus simply had nothing to say.
    expect(set.refusals.length).toBeGreaterThan(0);
    expect(set.refusals.every((r) => r.code === 'BUDGET_EXCEEDED')).toBe(true);
    expect(set.narrative).toContain('BUDGET_EXCEEDED');
    expect(set.unsourced.length + set.refusals.length).toBeGreaterThan(0);
  });

  test('an unrefused run reports NO refusals — the field is not always populated', async () => {
    const booted = boot(tempDir());
    const result = await strategy(booted, { maxAgentRuns: 50 });
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    if (!result.ok) return;
    const set = result.value.output as { refusals: readonly unknown[]; narrative: string };
    expect(set.refusals).toEqual([]);
    expect(set.narrative).not.toContain('BUDGET_EXCEEDED');
  });

  test('a generous ceiling leaves the chain untouched', async () => {
    const booted = boot(tempDir());
    const result = await strategy(booted, { maxAgentRuns: 50 });
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    expect(buildRunTree(booted.events).roots).toHaveLength(1);
  });
});
