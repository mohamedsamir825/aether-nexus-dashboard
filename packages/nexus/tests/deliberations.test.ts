/**
 * Business framings across a real process restart, through the composition root.
 *
 * The division's own tests use an in-memory fake filesystem, which is the right
 * default and cannot prove anything about a disk. This file boots the *real*
 * assembly -- `assembleNexus`, `NEXUS_POLICIES`, a real temporary directory --
 * so "the framing survives" means it survived on the same wiring a deployment
 * runs, not on a harness built for the test.
 *
 * What is being defended: §5's KPIs are all computed over this archive one day.
 * If the archive can gain a decision nobody made, every one of them is fiction.
 */
import { test, expect, describe, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentId,
  fixedClock,
  loadConfig,
  nullLogger,
  unwrap,
  type Clock,
} from '@nexus/core';
import { createFixtureRetriever } from '@nexus/division-research';
import { createFixtureActualsSource } from '@nexus/division-finance';
import {
  BUSINESS_MEMORY_SCOPE,
  deliberationAsOf,
  deliberationHistory,
  deliberationKey,
  deliberationState,
} from '@nexus/division-business';
import { assembleNexus } from '../src/assemble.ts';
import { createNodeFileSystem } from '../src/filesystem.ts';
import { NEXUS_POLICIES } from '../src/policy.ts';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-delib-'));
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

const MARCH = fixedClock(new Date('2026-03-01T09:00:00Z'));
const JUNE = fixedClock(new Date('2026-06-01T12:00:00Z'));

/** One whole process, over a real directory, on the standard policy. */
function boot(dir: string, clock: Clock) {
  const assembled = assembleNexus({
    config: unwrap(loadConfig({})),
    memoryPath: join(dir, 'memory', 'nexus.log'),
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
  return assembled.value;
}

const QUESTION = 'Should we self-host or move to hosted delivery?';

const ask = (n: ReturnType<typeof boot>, id: string, question = QUESTION) =>
  n.system.supervisor.dispatch({
    target: { agentId: agentId('business.strategy') },
    task: {
      id,
      objective: 'strategy',
      input: {
        question,
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
  });

describe('a framing survives a restart of the assembled system', () => {
  test('June reads what March framed, with no decision attached', async () => {
    const dir = tempDir();

    const march = await ask(boot(dir, MARCH), 'b-march');
    expect(march.ok, march.ok ? '' : march.error.message).toBe(true);

    // A second assembly over the same directory. Nothing is carried across.
    const june = boot(dir, JUNE);
    const recalled = await deliberationAsOf({
      memory: june.businessHistory,
      question: QUESTION,
      at: JUNE.now().toISOString(),
    });
    expect(recalled.ok, recalled.ok ? '' : recalled.error.message).toBe(true);
    if (!recalled.ok || recalled.value === null) throw new Error('the framing did not survive');

    expect(recalled.value.presentedAt).toBe(MARCH.now().toISOString());
    expect(recalled.value.optionSet.options.map((o) => o.id)).toEqual(['self-host', 'hosted']);

    // The guarantee: three months on disk added no decision and no outcome.
    expect(recalled.value.evaluatedAt).toBeNull();
    expect(recalled.value.selectedOptionId).toBeNull();
    expect(recalled.value.outcome).toBeNull();
    expect(deliberationState(recalled.value)).toEqual({
      kind: 'presented',
      at: MARCH.now().toISOString(),
    });
  });

  test('a June re-framing supersedes March without erasing it', async () => {
    const dir = tempDir();
    expect((await ask(boot(dir, MARCH), 'b-march')).ok).toBe(true);

    const june = boot(dir, JUNE);
    expect((await ask(june, 'b-june')).ok).toBe(true);

    const history = await deliberationHistory({ memory: june.businessHistory, question: QUESTION });
    expect(history.ok, history.ok ? '' : history.error.message).toBe(true);
    if (!history.ok) return;
    expect(history.value.map((d) => d.presentedAt)).toEqual([
      MARCH.now().toISOString(),
      JUNE.now().toISOString(),
    ]);

    // "What was on the table in April" still answers with March's framing --
    // which is the only reason keeping both versions is worth the bytes.
    const april = await deliberationAsOf({
      memory: june.businessHistory,
      question: QUESTION,
      at: '2026-04-01T00:00:00.000Z',
    });
    expect(april.ok).toBe(true);
    if (april.ok) expect(april.value?.presentedAt).toBe(MARCH.now().toISOString());
  });

  test('the record really is on disk, in Business’s own scope', async () => {
    const dir = tempDir();
    expect((await ask(boot(dir, MARCH), 'b-march')).ok).toBe(true);

    const log = readFileSync(join(dir, 'memory', 'nexus.log'), 'utf8');
    expect(log).toContain('business:deliberation');
    expect(log).toContain(deliberationKey(QUESTION));
    // Written under `division:business`, beside Finance's and Research's rows
    // in one log -- separation is by scope, not by file.
    expect(log).toContain(`"id":"${BUSINESS_MEMORY_SCOPE.id}"`);
    expect(log).toContain('finance:vintage');
  });
});

describe('the archive never gains a decision it was not given', () => {
  test('two different questions produce two chains, neither with an outcome', async () => {
    const dir = tempDir();
    const nexus = boot(dir, MARCH);
    expect((await ask(nexus, 'b1')).ok).toBe(true);
    expect((await ask(nexus, 'b2', 'Should we open a second region?')).ok).toBe(true);

    for (const question of [QUESTION, 'Should we open a second region?']) {
      const history = await deliberationHistory({ memory: nexus.businessHistory, question });
      expect(history.ok).toBe(true);
      if (!history.ok) continue;
      expect(history.value).toHaveLength(1);
      expect(history.value.every((d) => d.selectedOptionId === null)).toBe(true);
      expect(history.value.every((d) => d.outcome === null)).toBe(true);
    }
  });

  test('replaying the same run twice does not make one framing look chosen', async () => {
    // A KPI counting versions must not read repetition as engagement.
    const dir = tempDir();
    const nexus = boot(dir, MARCH);
    expect((await ask(nexus, 'b1')).ok).toBe(true);
    expect((await ask(nexus, 'b2')).ok).toBe(true);

    const history = await deliberationHistory({
      memory: nexus.businessHistory,
      question: QUESTION,
    });
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.value).toHaveLength(2);
    expect(history.value.map((d) => deliberationState(d).kind)).toEqual(['presented', 'presented']);
  });
});
