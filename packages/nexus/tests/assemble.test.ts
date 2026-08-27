/**
 * The assembled system, on a real filesystem.
 *
 * Every other persistence test in this repository injects an in-memory fake fs.
 * That is the right default -- fast, hermetic, and it exercises the store's
 * logic. What it cannot do is prove the store works against a disk: a fake
 * `appendFileSync` never fails the way a real one does and never disagrees with
 * `existsSync`.
 *
 * So this file writes to a real temporary directory, and "restart" means a
 * second `assembleNexus` over the same path with nothing carried across in a
 * variable. If it survives here, it survived on disk.
 */
import { test, expect, describe, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentId,
  allowListPolicy,
  divisionId,
  fixedClock,
  loadConfig,
  nullLogger,
  unwrap,
  type PermissionPolicy,
} from '@nexus/core';
import { createFixtureRetriever } from '@nexus/division-research';
import { createFixtureActualsSource } from '@nexus/division-finance';
import { createBusinessDivision } from '@nexus/division-business';
import { assembleNexus, installAll } from '../src/assemble.ts';
import { createNodeFileSystem } from '../src/filesystem.ts';
import { NEXUS_POLICIES, systemPolicy } from '../src/policy.ts';

const clock = fixedClock(new Date('2026-06-01T12:00:00Z'));
const directories: string[] = [];

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-test-'));
  directories.push(dir);
  return dir;
}

const CORPUS = [
  {
    source: {
      id: 'jan',
      title: 'January Survey',
      locator: 'fixture:jan',
      publisher: 'Marine Institute',
      publishedAt: '2026-01-01',
    },
    text: 'The harbour seal population is recovering along the northern coast.',
  },
];

const CONTRADICTING = [
  {
    source: {
      id: 'jun',
      title: 'June Review',
      locator: 'fixture:jun',
      publisher: 'Coastal Trust',
      publishedAt: '2026-06-01',
    },
    text: 'The harbour seal population is not recovering, and numbers continue to fall.',
  },
];

const ACTUALS = {
  period: '2026-Q1',
  validatedAt: '2026-04-05T09:00:00.000Z',
  validatedBy: agentId('finance.controller'),
  amounts: [
    { lineItem: 'revenue', period: '2026-Q1', value: 56_000, origin: 'actual' as const },
  ],
};

const BASELINE = {
  id: 'fv_base',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: agentId('finance.fpa'),
  runId: 'run_seed' as never,
  supersedes: null,
  reason: 'opening plan',
  drivers: [{ id: 'units', displayName: 'Units', value: 1_000, basis: 'FY25 run rate' }],
  amounts: [
    { lineItem: 'revenue', period: '2026-Q1', value: 50_000, origin: 'forecast' as const },
    { lineItem: 'revenue', period: '2026-Q2', value: 50_000, origin: 'forecast' as const },
  ],
  confidence: 0.8,
};

/** One whole process, over a real directory. */
function boot(
  dir: string,
  corpus = CORPUS,
  policies: readonly PermissionPolicy[] = NEXUS_POLICIES,
) {
  const assembled = assembleNexus({
    config: unwrap(loadConfig({})),
    memoryPath: join(dir, 'memory', 'nexus.log'),
    fs: createNodeFileSystem(),
    retriever: createFixtureRetriever({ documents: corpus, now: () => clock.now() }),
    actuals: createFixtureActualsSource([ACTUALS]),
    sensitivities: { revenue: { units: 50 } },
    horizon: ['2026-Q1', '2026-Q2'],
    observedDrivers: { '2026-Q1': [{ id: 'units', value: 1_120 }] },
    clock,
    logger: nullLogger,
    policies,
  });
  expect(assembled.ok, assembled.ok ? '' : assembled.error.message).toBe(true);
  if (!assembled.ok) throw new Error(assembled.error.message);
  return assembled.value;
}

const research = (n: ReturnType<typeof boot>, id = 'r1') =>
  n.system.supervisor.dispatch({
    target: { agentId: agentId('research.analyst') },
    task: {
      id,
      objective: 'research',
      input: { question: 'harbour seal population', subjects: ['harbour seal population'] },
    },
  });

const finance = (n: ReturnType<typeof boot>, id = 'f1') =>
  n.system.supervisor.dispatch({
    target: { agentId: agentId('finance.fpa') },
    task: {
      id,
      objective: 'finance',
      input: { question: 'Q1?', actuals: { period: '2026-Q1' }, baseline: BASELINE },
    },
  });

describe('the system assembles at all', () => {
  test('all three divisions install under the standard policy', () => {
    const nexus = boot(tempDir());
    expect(nexus.divisions).toHaveLength(3);
    // Two tools: research.retrieve and finance.actuals. Business has none.
    expect(nexus.system.registries.tools.list()).toHaveLength(2);
    expect(nexus.system.registries.agents.list()).toHaveLength(3);
  });

  test('§23: registering a division needed no Core change', () => {
    // The composition root imports Core and three division packages, and Core
    // imports none of them. If that ever reverses, this file will not compile.
    const nexus = boot(tempDir());
    const ids = nexus.divisions.map((d) => String(d.descriptor.id)).sort();
    expect(ids).toEqual(['business', 'finance', 'research']);
  });
});

describe('a broken division stops assembly', () => {
  test('installation stops at the first failure and reports it', async () => {
    // The guarantee: a half-assembled system is never handed back looking
    // complete. Without this the propagation was one unexercised line.
    const { createNexusSystem, ok: okResult } = await import('@nexus/core');
    const system = createNexusSystem({
      config: unwrap(loadConfig({})),
      policies: NEXUS_POLICIES,
      logger: nullLogger,
      clock,
    });

    const broken = {
      descriptor: {
        id: divisionId('broken'),
        displayName: 'Broken',
        description: 'claims an agent it never registers',
        version: '1.0.0',
        agents: [agentId('broken.ghost')],
        entryPoints: ['ghost'],
        requiredCapabilities: [],
      },
      install: () => okResult(undefined),
    } as unknown as Parameters<typeof installAll>[1][number];

    const result = installAll(system, [broken]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('never registered');
  });

  test('a good division installs through the same path', async () => {
    const { createNexusSystem } = await import('@nexus/core');
    const system = createNexusSystem({
      config: unwrap(loadConfig({})),
      policies: NEXUS_POLICIES,
      logger: nullLogger,
      clock,
    });
    const result = installAll(system, [createBusinessDivision()]);
    expect(result.ok).toBe(true);
    expect(system.registries.agents.list()).toHaveLength(1);
  });
});

describe('durability on a REAL filesystem', () => {
  test('the log is an actual file with actual bytes in it', async () => {
    const dir = tempDir();
    const path = join(dir, 'memory', 'nexus.log');
    expect(existsSync(path)).toBe(false);

    const result = await research(boot(dir));
    expect(result.ok).toBe(true);

    // Not a Map. A file, on a disk, containing the claim.
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('harbour seal population');
  });

  test('Research claims survive a real restart and contradict across runs', async () => {
    const dir = tempDir();
    const first = await research(boot(dir));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect((first.value.output as { persisted: boolean }).persisted).toBe(true);

    // A second assembly over the same directory. Nothing is shared but the disk.
    const second = await research(boot(dir, CONTRADICTING), 'r2');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const output = second.value.output as {
      priorClaimsConsidered: number;
      crossRunConflicts: readonly { reason: string }[];
    };

    expect(output.priorClaimsConsidered).toBeGreaterThan(0);
    expect(output.crossRunConflicts.length).toBeGreaterThan(0);
    expect(output.crossRunConflicts[0]?.reason).toContain('negates');
  });

  test('evidence lineage survives the disk round trip', async () => {
    const dir = tempDir();
    const first = await research(boot(dir));
    if (!first.ok) throw new Error('expected success');
    const one = first.value.output as {
      claims: readonly { status: string; supportedBy: readonly string[] }[];
    };
    const originalId = one.claims.find((c) => c.status === 'fact')?.supportedBy[0];
    expect(originalId).toBeDefined();

    const second = await research(boot(dir, CONTRADICTING), 'r2');
    if (!second.ok) throw new Error('expected success');
    const two = second.value.output as {
      evidence: readonly { id: string; source: { publisher?: string; retrievedAt: string } }[];
    };

    const resolved = two.evidence.find((e) => e.id === originalId);
    expect(resolved).toBeDefined();
    expect(resolved?.source.publisher).toBe('Marine Institute');
    expect(resolved?.source.retrievedAt).toBe('2026-06-01T12:00:00.000Z');
  });

  test('Finance vintages survive a real restart, and asOf answers across them', async () => {
    const dir = tempDir();
    const first = await finance(boot(dir));
    expect(first.ok, first.ok ? '' : first.error.message).toBe(true);
    if (!first.ok) return;
    const one = first.value.output as { revised: { id: string; version: number } | null };
    expect(one.revised).not.toBeNull();

    const restarted = boot(dir);
    const second = await finance(restarted, 'f2');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const two = second.value.output as {
      vintages: readonly { id: string }[];
      revised: { version: number } | null;
      kpis: { accuracy: readonly { horizon: number }[] };
    };

    // The first process's revision came back off the disk.
    expect(two.vintages.some((v) => v.id === one.revised?.id)).toBe(true);
    expect(two.revised?.version).toBeGreaterThan(one.revised?.version as number);

    // §4.2's accuracy-per-horizon KPI is finally measured across processes.
    expect(new Set(two.kpis.accuracy.map((a) => a.horizon)).size).toBeGreaterThan(1);
  });

  test('one shared log keeps the two divisions’ memories apart', async () => {
    // Research and Finance write to the SAME file. Scope isolation is what
    // keeps that from being a leak.
    const dir = tempDir();
    const nexus = boot(dir);
    await research(nexus);
    await finance(nexus, 'f1');

    const path = join(dir, 'memory', 'nexus.log');
    const log = readFileSync(path, 'utf8');
    expect(log).toContain('"id":"research"');
    expect(log).toContain('"id":"finance"');

    // Finance's view cannot read Research's scope even though the bytes are
    // in the same file it just read from.
    const trespass = await nexus.financeHistory.history(
      { kind: 'division', id: 'research' },
      'anything',
    );
    expect(trespass.ok).toBe(false);
    if (!trespass.ok) expect(trespass.error.code).toBe('PERMISSION_DENIED');
  });
});

describe('the standard policy is deny-by-default, per division', () => {
  test('Finance holds NO retrieval capability — market data must be delegated', async () => {
    // §4.3 requires market inputs to arrive by delegation to Research. That is
    // enforced by a missing grant, not by a comment: Finance cannot read a
    // corpus even if it tried.
    const nexus = boot(tempDir());
    const denied = nexus.system.permissions.require({
      subject: { kind: 'agent', id: agentId('finance.fpa') },
      capability: 'research:retrieve',
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('PERMISSION_DENIED');
  });

  test('Business holds dispatch and its OWN memory — it cannot price or retrieve', async () => {
    // §5's boundary as a permission set rather than as a rule to remember.
    const nexus = boot(tempDir());
    const subject = { kind: 'agent' as const, id: agentId('business.strategy') };
    for (const capability of ['tool:execute', 'research:retrieve', 'finance:actuals']) {
      const denied = nexus.system.permissions.require({ subject, capability });
      expect(denied.ok, `business should not hold ${capability}`).toBe(false);
    }
    expect(nexus.system.permissions.require({ subject, capability: 'agent:dispatch' }).ok).toBe(true);
    // It does hold memory:write -- and that is not a widening, because the
    // view it holds is narrowed to one scope. The capability alone says
    // nothing about reach; the next test is the one that pins the reach.
    expect(nexus.system.permissions.require({ subject, capability: 'memory:write' }).ok).toBe(true);
  });

  test('the memory grant does not reach another division: Business cannot read Finance', async () => {
    // The grant is `memory:read`, unqualified -- so what stops Business
    // reading Finance's vintages is the scope its view was built over, not the
    // capability name. Assert the thing that actually holds.
    const nexus = boot(tempDir());
    for (const scope of [
      { kind: 'division' as const, id: 'finance' },
      { kind: 'division' as const, id: 'research' },
    ]) {
      const trespass = await nexus.businessHistory.history(scope, 'anything');
      expect(trespass.ok, `business should not read ${scope.id}`).toBe(false);
      if (!trespass.ok) expect(trespass.error.code).toBe('PERMISSION_DENIED');
    }
    // And the reverse: Finance cannot read Business's framings.
    const back = await nexus.financeHistory.history({ kind: 'division', id: 'business' }, 'anything');
    expect(back.ok).toBe(false);
  });

  test('Research cannot read Finance actuals', async () => {
    const nexus = boot(tempDir());
    const denied = nexus.system.permissions.require({
      subject: { kind: 'agent', id: agentId('research.analyst') },
      capability: 'finance:actuals',
    });
    expect(denied.ok).toBe(false);
  });

  test('with only the system policy, every division run is denied', async () => {
    const nexus = boot(tempDir(), CORPUS, [systemPolicy]);
    const result = await research(nexus);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');
  });

  test('a policy withholding memory:write fails the Finance run rather than forgetting', async () => {
    // Losing history quietly is the failure this whole line of work exists to
    // prevent, so it must not be how the system behaves when under-granted.
    const nexus = boot(tempDir(), CORPUS, [
      systemPolicy,
      // Finance with everything except memory:write.
      allowListPolicy('partial-finance', [
        {
          subject: { kind: 'agent', id: agentId('finance.fpa') },
          capabilities: ['agent:dispatch', 'tool:execute', 'finance:actuals', 'memory:read'],
        },
      ]),
    ]);
    const result = await finance(nexus);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');
  });
});
