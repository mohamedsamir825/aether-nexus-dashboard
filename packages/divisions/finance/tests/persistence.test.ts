/**
 * Forecast history across process restarts.
 *
 * "Restart" here means what it means in production: a brand new system, new
 * registries, new store object, over the same log file. Nothing is carried
 * across in a variable -- if it survives, it survived on disk.
 */
import { test, expect, describe } from 'bun:test';
import {
  DISPATCH_CAPABILITY,
  agentId,
  allowListPolicy,
  createDurableMemoryStore,
  createNexusSystem,
  createScopedVersionedMemory,
  fixedClock,
  installDivision,
  loadConfig,
  nullLogger,
  unwrap,
  type MemoryFileSystem,
  type PermissionPolicy,
} from '@nexus/core';
import { createFinanceDivision } from '../src/division.ts';
import { createFixtureActualsSource } from '../src/tool.ts';
import { FINANCE_MEMORY_SCOPE, forecastKey, vintageAsOf } from '../src/persistence.ts';
import type { FinanceResult } from '../src/types.ts';
import { BASELINE, HORIZON, Q1_ABOVE, Q1_DRIVERS, SENSITIVITIES } from './fixtures.ts';

const clock = fixedClock(new Date('2026-06-01T12:00:00Z'));

function fakeFs(): MemoryFileSystem & { content: () => string; fail: boolean } {
  let data = '';
  const fs = {
    fail: false,
    existsSync: () => data !== '',
    readFileSync: () => data,
    appendFileSync: (_p: string, chunk: string) => {
      if (fs.fail) throw new Error('disk full');
      data += chunk;
    },
    content: () => data,
  };
  return fs;
}

const grant = allowListPolicy('finance-memory', [
  { subject: { kind: 'system' }, capabilities: [DISPATCH_CAPABILITY] },
  {
    subject: { kind: 'agent' },
    capabilities: [
      DISPATCH_CAPABILITY,
      'tool:execute',
      'finance:actuals',
      'memory:read',
      'memory:write',
    ],
  },
]);

/** One whole process: a fresh system over an existing log. */
function boot(fs: MemoryFileSystem, policies: readonly PermissionPolicy[] = [grant]) {
  const memoryStore = createDurableMemoryStore({ path: '/finance.log', fs, clock });
  const system = createNexusSystem({
    config: unwrap(loadConfig({})),
    policies,
    logger: nullLogger,
    clock,
    memory: memoryStore,
  });

  const versionedMemory = createScopedVersionedMemory({
    store: memoryStore,
    subject: { kind: 'agent', id: 'finance.fpa' },
    scopes: [FINANCE_MEMORY_SCOPE],
    permissions: system.permissions,
  });

  const installed = installDivision({
    division: createFinanceDivision({
      actuals: createFixtureActualsSource([Q1_ABOVE]),
      versionedMemory,
      sensitivities: SENSITIVITIES,
      horizon: HORIZON,
      observedDrivers: { '2026-Q1': Q1_DRIVERS },
    }),
    registerAgent: (a) => system.registries.agents.register(a),
    registerTool: (t) => system.registries.tools.register(t),
  });
  expect(installed.ok, installed.ok ? '' : installed.error.message).toBe(true);

  return { system, versionedMemory, memoryStore };
}

const ask = (booted: ReturnType<typeof boot>) =>
  booted.system.supervisor.dispatch({
    target: { agentId: agentId('finance.fpa') },
    task: {
      id: 'f1',
      objective: 'finance',
      input: { question: 'Q1?', actuals: { period: '2026-Q1' }, baseline: BASELINE },
    },
  });

describe('forecast vintages survive a restart', () => {
  test('a second process sees the first process’s revision', async () => {
    const fs = fakeFs();

    const first = await ask(boot(fs));
    expect(first.ok, first.ok ? '' : first.error.message).toBe(true);
    if (!first.ok) return;
    const one = first.value.output as FinanceResult;
    expect(one.revised).not.toBeNull();
    expect(one.persisted).toBe(true);

    // Everything above is discarded. This is a new process.
    const second = await ask(boot(fs));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const two = second.value.output as FinanceResult;

    // The ledger came back with the first run's work in it, so this run's
    // revision is version 3, not version 2 all over again.
    expect(two.vintages.length).toBeGreaterThan(one.vintages.length);
    expect(two.revised?.version).toBeGreaterThan(one.revised?.version as number);
    expect(two.vintages.some((v) => v.id === one.revised?.id)).toBe(true);
  });

  test('the earlier vintage is still readable, not just counted', async () => {
    const fs = fakeFs();
    const first = await ask(boot(fs));
    if (!first.ok) throw new Error('expected success');
    const one = first.value.output as FinanceResult;

    const restarted = boot(fs);
    const found = restarted.versionedMemory.history(FINANCE_MEMORY_SCOPE, forecastKey('default'));
    const history = await found;
    expect(history.ok).toBe(true);
    if (!history.ok) return;

    const stored = history.value.map((w) => w.record.metadata?.['vintage'] as { id: string });
    expect(stored.some((v) => v?.id === one.revised?.id)).toBe(true);
  });

  test('asOf answers across processes — the question that was unanswerable', async () => {
    const fs = fakeFs();
    await ask(boot(fs));

    const restarted = boot(fs);
    const then = await vintageAsOf({
      memory: restarted.versionedMemory,
      ledgerName: 'default',
      at: '2026-06-01T12:00:00.000Z',
    });
    expect(then.ok).toBe(true);
    if (!then.ok) return;
    expect(then.value).not.toBeNull();
    expect(then.value?.amounts.length).toBeGreaterThan(0);

    // Before anything was forecast, nothing was believed.
    const before = await vintageAsOf({
      memory: restarted.versionedMemory,
      ledgerName: 'default',
      at: '2020-01-01T00:00:00.000Z',
    });
    expect(before.ok && before.value).toBeNull();
  });

  test('accuracy per horizon becomes measurable across runs', async () => {
    // §4.2's first KPI. Within one process "per horizon" meant nothing.
    const fs = fakeFs();
    await ask(boot(fs));
    const second = await ask(boot(fs));
    if (!second.ok) throw new Error('expected success');
    const two = second.value.output as FinanceResult;

    const horizons = new Set(two.kpis.accuracy.map((a) => a.horizon));
    expect(horizons.size).toBeGreaterThan(1);
  });

  test('separate forecast lines do not share a chain', async () => {
    const fs = fakeFs();
    const memoryStore = createDurableMemoryStore({ path: '/f.log', fs, clock });
    const system = createNexusSystem({
      config: unwrap(loadConfig({})),
      policies: [grant],
      logger: nullLogger,
      clock,
      memory: memoryStore,
    });
    const memory = createScopedVersionedMemory({
      store: memoryStore,
      subject: { kind: 'agent', id: 'finance.fpa' },
      scopes: [FINANCE_MEMORY_SCOPE],
      permissions: system.permissions,
    });

    await memory.remember({
      scope: FINANCE_MEMORY_SCOPE,
      kind: 'artifact',
      content: 'line A',
      key: forecastKey('entity-a'),
      reason: 'a',
      metadata: { vintage: { ...BASELINE, id: 'a1' } },
    });

    const other = await memory.history(FINANCE_MEMORY_SCOPE, forecastKey('entity-b'));
    expect(other.ok && other.value).toEqual([]);
  });
});

describe('persistence stays inside the security boundary', () => {
  test('without memory:write the run fails rather than silently forgetting', async () => {
    // Losing history quietly is the failure mode this whole phase exists to
    // prevent, so it must not be the failure mode of the phase itself.
    const noWrite = allowListPolicy('no-write', [
      { subject: { kind: 'system' }, capabilities: [DISPATCH_CAPABILITY] },
      {
        subject: { kind: 'agent' },
        capabilities: [DISPATCH_CAPABILITY, 'tool:execute', 'finance:actuals', 'memory:read'],
      },
    ]);
    const result = await ask(boot(fakeFs(), [noWrite]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');
  });

  test('a scoped view cannot read another division’s memory', async () => {
    const fs = fakeFs();
    const booted = boot(fs);
    const trespass = await booted.versionedMemory.history(
      { kind: 'division', id: 'research' },
      'anything',
    );
    expect(trespass.ok).toBe(false);
    if (!trespass.ok) expect(trespass.error.code).toBe('PERMISSION_DENIED');
  });

  test('a disk failure fails the run rather than reporting a saved forecast', async () => {
    const fs = fakeFs();
    const booted = boot(fs);
    fs.fail = true;
    const result = await ask(booted);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INTERNAL');
  });

  test('an unreadable stored vintage refuses rather than starting fresh', async () => {
    // Skipping it would renumber every vintage after the missing one, and
    // every horizon measured against it would be wrong invisibly.
    //
    // The line stays VALID JSON with only the payload replaced. Mangling the
    // whole line instead would be caught by the log loader as a corrupt line
    // and never reach the vintage check -- which is how the first version of
    // this test passed without exercising anything.
    const fs = fakeFs();
    await ask(boot(fs));

    const rewritten = fs
      .content()
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const entry = JSON.parse(line) as { record?: { metadata?: Record<string, unknown> } };
        if (entry.record?.metadata?.['vintage'] !== undefined) {
          entry.record.metadata['vintage'] = 'not an object';
        }
        return JSON.stringify(entry);
      })
      .join('\n');

    const corrupted = fakeFs();
    corrupted.appendFileSync('/finance.log', `${rewritten}\n`, 'utf8');

    const result = await ask(boot(corrupted));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL');
      expect(result.error.message).toContain('unreadable');
    }
  });
});
