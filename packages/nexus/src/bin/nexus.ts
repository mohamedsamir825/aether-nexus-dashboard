/**
 * NEXUS, running as one system.
 *
 * `bun run nexus` assembles Core, durable memory and all three divisions, then
 * asks a strategic question that reaches every one of them:
 *
 *   User -> Supervisor -> Business -> Research  (facts, with evidence)
 *                                  -> Finance   (prices, with a vintage behind them)
 *
 * Run it twice against the same data directory and the second run knows what
 * the first one established. That is the difference between three tested
 * packages and a system.
 *
 * Deterministic and free: fixtures, no network, no credential, no model.
 */
import { join } from 'node:path';
import { agentId, loadConfig, unwrap } from '@nexus/core';
import { createFixtureRetriever } from '@nexus/division-research';
import { createFixtureActualsSource } from '@nexus/division-finance';
import { assembleNexus } from '../assemble.ts';
import { createNodeFileSystem } from '../filesystem.ts';

const DATA_DIR = process.env['NEXUS_DATA_DIR'] ?? join(process.cwd(), '.nexus');

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
  runId: 'run_seed',
  supersedes: null,
  reason: 'opening plan for FY26',
  drivers: [{ id: 'units', displayName: 'Units sold', value: 1_000, basis: 'FY25 run rate' }],
  amounts: [
    { lineItem: 'revenue', period: '2026-Q1', value: 50_000, origin: 'forecast' as const },
    { lineItem: 'revenue', period: '2026-Q2', value: 50_000, origin: 'forecast' as const },
  ],
  confidence: 0.8,
};

async function main(): Promise<number> {
  const assembled = assembleNexus({
    config: unwrap(loadConfig({})),
    memoryPath: join(DATA_DIR, 'memory.log'),
    fs: createNodeFileSystem(),
    retriever: createFixtureRetriever({ documents: CORPUS }),
    actuals: createFixtureActualsSource([ACTUALS]),
    sensitivities: { revenue: { units: 50 } },
    horizon: ['2026-Q1', '2026-Q2'],
    observedDrivers: { '2026-Q1': [{ id: 'units', value: 1_120 }] },
  });

  if (!assembled.ok) {
    console.error(`NEXUS could not be assembled: ${assembled.error.message}`);
    return 1;
  }
  const nexus = assembled.value;

  console.log(`NEXUS assembled — ${nexus.divisions.length} divisions, memory at ${DATA_DIR}`);
  console.log(`  agents: ${nexus.system.registries.agents.list().length}`);
  console.log(`  tools:  ${nexus.system.registries.tools.list().length}`);
  console.log('');

  const result = await nexus.system.supervisor.dispatch({
    target: { agentId: agentId('business.strategy') },
    task: {
      id: 'strategy-1',
      objective: 'strategy',
      input: {
        question: 'Should we self-host or move to hosted delivery?',
        criteria: ['hosted delivery', 'revenue'],
        // Must match the period the Controller validated. Assembling the
        // system is what surfaced this: each division's own tests supplied
        // matching periods, so the mismatch had nowhere to show up.
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

  if (!result.ok) {
    console.error(`the run failed: ${result.error.code} — ${result.error.message}`);
    return 1;
  }

  const set = result.value.output as { narrative: string };
  console.log(set.narrative);
  console.log('');
  console.log(`usage: ${result.value.usage.toolCalls} tool call(s) across the chain`);
  console.log(
    result.value.usage.costMinorUnits === undefined
      ? 'cost: unmeasured (no priced provider was involved)'
      : `cost: ${result.value.usage.costMinorUnits} minor units`,
  );
  console.log('');
  console.log('Run again against the same NEXUS_DATA_DIR: Research will contradict');
  console.log('what it established this time, and Finance will supersede this vintage.');
  return 0;
}

process.exit(await main());
