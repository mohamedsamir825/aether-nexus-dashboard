/**
 * What Business remembers, and — more importantly — what it refuses to claim.
 *
 * The load-bearing guarantee here is not "a record round-trips". It is that a
 * stored framing never grows a decision or an outcome it was not given. Every
 * §5 KPI is eventually computed over this archive, and a division that quietly
 * filled in the blanks would produce numbers about itself that nobody could
 * check.
 *
 * "Restart" means a brand new system over the same log. Nothing is carried
 * across in a variable: if it survives, it survived on disk.
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
  type AnyAgent,
  type AnyTool,
  type MemoryFileSystem,
  type PermissionPolicy,
} from '@nexus/core';
import { createResearchDivision, createFixtureRetriever } from '@nexus/division-research';
import { createFinanceDivision, createFixtureActualsSource } from '@nexus/division-finance';
import { createBusinessDivision } from '../src/division.ts';
import {
  BUSINESS_MEMORY_SCOPE,
  deliberationAsOf,
  deliberationHistory,
  deliberationKey,
  deliberationState,
  rememberDeliberation,
  type Deliberation,
} from '../src/deliberation.ts';
import { BLOCKED_KPIS, tallyDeliberations } from '../src/kpi.ts';
import type { OptionSet } from '../src/types.ts';

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

const corpus = [
  {
    source: {
      id: 'm1',
      title: 'Sector Outlook',
      locator: 'fixture:m1',
      publisher: 'Trade Body',
      publishedAt: '2026-02-01',
    },
    text:
      'Enterprise buyers increasingly prefer hosted delivery. ' +
      'Self-hosted deployments continue to decline across the sector.',
  },
];

const ACTUALS = {
  period: 'current',
  validatedAt: '2026-05-01T09:00:00.000Z',
  validatedBy: agentId('finance.controller'),
  amounts: [
    { lineItem: 'engineering', period: 'current', value: 400_000, origin: 'actual' as const },
  ],
};

const BASELINE = {
  id: 'bl_build',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: agentId('finance.fpa'),
  runId: 'run_seed' as never,
  supersedes: null,
  reason: 'opening plan',
  drivers: [{ id: 'headcount', displayName: 'Headcount', value: 4, basis: 'plan' }],
  amounts: [
    { lineItem: 'engineering', period: 'current', value: 320_000, origin: 'forecast' as const },
  ],
  confidence: 0.8,
};

const grant = allowListPolicy('all', [
  { subject: { kind: 'system' }, capabilities: [DISPATCH_CAPABILITY] },
  { subject: { kind: 'supervisor' }, capabilities: [DISPATCH_CAPABILITY] },
  {
    subject: { kind: 'agent' },
    capabilities: [
      DISPATCH_CAPABILITY,
      'tool:execute',
      'research:retrieve',
      'finance:actuals',
      'memory:read',
      'memory:write',
    ],
  },
]);

/** One whole process: a fresh system over an existing log. */
function boot(fs: MemoryFileSystem, policies: readonly PermissionPolicy[] = [grant]) {
  const memoryStore = createDurableMemoryStore({ path: '/nexus.log', fs, clock });
  const system = createNexusSystem({
    config: unwrap(loadConfig({})),
    policies,
    logger: nullLogger,
    clock,
    memory: memoryStore,
  });

  const businessHistory = createScopedVersionedMemory({
    store: memoryStore,
    subject: { kind: 'agent', id: 'business.strategy' },
    scopes: [BUSINESS_MEMORY_SCOPE],
    permissions: system.permissions,
  });

  for (const division of [
    createResearchDivision({
      retriever: createFixtureRetriever({ documents: corpus, now: () => clock.now() }),
    }),
    createFinanceDivision({
      actuals: createFixtureActualsSource([ACTUALS]),
      sensitivities: { engineering: { headcount: 80_000 } },
      horizon: ['current'],
      observedDrivers: { current: [{ id: 'headcount', value: 5 }] },
    }),
    createBusinessDivision({ versionedMemory: businessHistory }),
  ]) {
    const installed = installDivision({
      division,
      registerAgent: (a: AnyAgent) => system.registries.agents.register(a),
      registerTool: (t: AnyTool) => system.registries.tools.register(t),
    });
    expect(installed.ok, installed.ok ? '' : installed.error.message).toBe(true);
  }

  return { system, businessHistory, memoryStore };
}

const QUESTION = 'Should we host it ourselves or buy hosted delivery?';

const ask = (booted: ReturnType<typeof boot>, id = 'b1', question = QUESTION) =>
  booted.system.supervisor.dispatch({
    target: { agentId: agentId('business.strategy') },
    task: {
      id,
      objective: 'strategy',
      input: {
        question,
        criteria: ['hosted', 'engineering'],
        options: [
          {
            id: 'build',
            label: 'Self-host',
            description: 'Run it on our own infrastructure',
            costDrivers: ['engineering'],
            marketQuestions: ['hosted delivery'],
            pricingBaseline: BASELINE,
          },
          {
            id: 'buy',
            label: 'Buy hosted',
            description: 'Pay a vendor',
            costDrivers: ['engineering'],
            marketQuestions: ['hosted delivery'],
            pricingBaseline: BASELINE,
          },
        ],
      },
    },
  });

/** A framing with nothing else recorded — the only state a run can produce. */
const framing = (over: Partial<Deliberation> = {}): Deliberation => ({
  optionSet: { question: 'q', createdAt: '2026-03-01T00:00:00.000Z' } as OptionSet,
  presentedAt: '2026-03-01T00:00:00.000Z',
  runId: 'run_1',
  evaluatedAt: null,
  selectedOptionId: null,
  outcome: null,
  ...over,
});

describe('the five states stay apart', () => {
  test('a framing alone is PRESENTED — never "nobody chose"', () => {
    const state = deliberationState(framing());
    expect(state.kind).toBe('presented');
    // The distinction the module exists for: three nulls mean NOT RECORDED.
    expect(state.kind).not.toBe('selected');
    expect(state.kind).not.toBe('outcome-known');
  });

  test('an evaluation without a choice is EVALUATED', () => {
    const state = deliberationState(framing({ evaluatedAt: '2026-03-05T00:00:00.000Z' }));
    expect(state).toEqual({ kind: 'evaluated', at: '2026-03-05T00:00:00.000Z' });
  });

  test('a choice without an outcome is SELECTED, not outcome-known', () => {
    const state = deliberationState(
      framing({ selectedOptionId: 'buy', evaluatedAt: '2026-03-05T00:00:00.000Z' }),
    );
    expect(state).toEqual({ kind: 'selected', optionId: 'buy', at: '2026-03-05T00:00:00.000Z' });
  });

  test('a choice AND a result is OUTCOME-KNOWN', () => {
    const state = deliberationState(framing({ selectedOptionId: 'buy', outcome: 'margin fell' }));
    expect(state).toEqual({ kind: 'outcome-known', optionId: 'buy', outcome: 'margin fell' });
  });

  test('a result with no recorded choice is UNATTRIBUTED — no option is invented', () => {
    // Naming an option here would fabricate the decision; reporting
    // `presented` would drop an outcome that IS on record. Neither is done.
    const state = deliberationState(framing({ outcome: 'margin fell' }));
    expect(state).toEqual({ kind: 'outcome-unattributed', outcome: 'margin fell' });
    expect(state).not.toHaveProperty('optionId');
  });
});

describe('keys identify a question, not a run', () => {
  test('the same question yields the same key', () => {
    expect(deliberationKey(QUESTION)).toBe(deliberationKey(QUESTION));
  });

  test('different questions do not share a chain', () => {
    expect(deliberationKey('Should we hire?')).not.toBe(deliberationKey('Should we sell?'));
  });

  test('punctuation and case do not fork the chain', () => {
    expect(deliberationKey('Should we HIRE?')).toBe(deliberationKey('should we hire'));
  });

  test('a question of pure punctuation still yields a usable key', () => {
    // Not a crash and not a bare prefix collision with the empty question:
    // both degrade to the same key, which is a stated limit, not a silent one.
    expect(deliberationKey('???')).toBe('deliberation:');
  });
});

describe('a real run records the framing and NOTHING else', () => {
  test('the option set survives a restart, with no decision attached', async () => {
    const fs = fakeFs();
    const first = await ask(boot(fs));
    expect(first.ok, first.ok ? '' : first.error.message).toBe(true);
    if (!first.ok) return;
    const produced = first.value.output as OptionSet;
    expect(produced.options.length).toBe(2);

    // A brand new process over the same bytes.
    const second = boot(fs);
    const recalled = await deliberationAsOf({
      memory: second.businessHistory,
      question: QUESTION,
      at: clock.now().toISOString(),
    });
    expect(recalled.ok, recalled.ok ? '' : recalled.error.message).toBe(true);
    if (!recalled.ok || recalled.value === null) throw new Error('nothing survived the restart');

    expect(recalled.value.optionSet.options.map((o) => o.id)).toEqual(['build', 'buy']);
    expect(recalled.value.runId).not.toBe('');

    // The point of the whole slice: persisting a framing manufactured no
    // decision and no outcome.
    expect(recalled.value.evaluatedAt).toBeNull();
    expect(recalled.value.selectedOptionId).toBeNull();
    expect(recalled.value.outcome).toBeNull();
    expect(deliberationState(recalled.value).kind).toBe('presented');
  });

  test('the stored set carries its evidence lineage, so the archive is auditable', async () => {
    const fs = fakeFs();
    expect((await ask(boot(fs))).ok).toBe(true);
    const recalled = await deliberationAsOf({
      memory: boot(fs).businessHistory,
      question: QUESTION,
      at: clock.now().toISOString(),
    });
    if (!recalled.ok || recalled.value === null) throw new Error('nothing survived');

    // Claims came from Research and each names the evidence behind it. A
    // framing stored without them would be unreviewable later.
    expect(recalled.value.optionSet.claims.length).toBeGreaterThan(0);
    expect(recalled.value.optionSet.claims.every((c) => c.supportedBy.length > 0)).toBe(true);
  });

  test('nothing is recorded when the division runs without memory', async () => {
    // Absent memory means the division does not remember. It must not mean a
    // silent partial write, and it must not fail the run either.
    const fs = fakeFs();
    const memoryStore = createDurableMemoryStore({ path: '/nexus.log', fs, clock });
    const system = createNexusSystem({
      config: unwrap(loadConfig({})),
      policies: [grant],
      logger: nullLogger,
      clock,
      memory: memoryStore,
    });
    for (const division of [
      createResearchDivision({
        retriever: createFixtureRetriever({ documents: corpus, now: () => clock.now() }),
      }),
      createFinanceDivision({
        actuals: createFixtureActualsSource([ACTUALS]),
        sensitivities: { engineering: { headcount: 80_000 } },
        horizon: ['current'],
        observedDrivers: { current: [{ id: 'headcount', value: 5 }] },
      }),
      createBusinessDivision(),
    ]) {
      expect(
        installDivision({
          division,
          registerAgent: (a: AnyAgent) => system.registries.agents.register(a),
          registerTool: (t: AnyTool) => system.registries.tools.register(t),
        }).ok,
      ).toBe(true);
    }
    const result = await ask({ system, businessHistory: null as never, memoryStore }, 'b-nomem');
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    expect(fs.content()).not.toContain('business:deliberation');
  });
});

describe('re-framing supersedes rather than overwrites', () => {
  test('asking again keeps the earlier framing readable at its own moment', async () => {
    const fs = fakeFs();
    expect((await ask(boot(fs), 'b1')).ok).toBe(true);
    const firstAt = clock.now().toISOString();

    // A second process, later, asks the same question again.
    const laterClock = fixedClock(new Date('2026-09-01T12:00:00Z'));
    const memoryStore = createDurableMemoryStore({ path: '/nexus.log', fs, clock: laterClock });
    const system = createNexusSystem({
      config: unwrap(loadConfig({})),
      policies: [grant],
      logger: nullLogger,
      clock: laterClock,
      memory: memoryStore,
    });
    const businessHistory = createScopedVersionedMemory({
      store: memoryStore,
      subject: { kind: 'agent', id: 'business.strategy' },
      scopes: [BUSINESS_MEMORY_SCOPE],
      permissions: system.permissions,
    });
    for (const division of [
      createResearchDivision({
        retriever: createFixtureRetriever({ documents: corpus, now: () => laterClock.now() }),
      }),
      createFinanceDivision({
        actuals: createFixtureActualsSource([ACTUALS]),
        sensitivities: { engineering: { headcount: 80_000 } },
        horizon: ['current'],
        observedDrivers: { current: [{ id: 'headcount', value: 5 }] },
      }),
      createBusinessDivision({ versionedMemory: businessHistory }),
    ]) {
      expect(
        installDivision({
          division,
          registerAgent: (a: AnyAgent) => system.registries.agents.register(a),
          registerTool: (t: AnyTool) => system.registries.tools.register(t),
        }).ok,
      ).toBe(true);
    }
    expect((await ask({ system, businessHistory, memoryStore }, 'b2')).ok).toBe(true);

    const history = await deliberationHistory({ memory: businessHistory, question: QUESTION });
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.value.length).toBe(2);
    expect(history.value[0]?.presentedAt).toBe(firstAt);
    expect(history.value[1]?.presentedAt).toBe(laterClock.now().toISOString());

    // The June framing is still what a reader asking about June gets back.
    const asOfJune = await deliberationAsOf({
      memory: businessHistory,
      question: QUESTION,
      at: firstAt,
    });
    expect(asOfJune.ok).toBe(true);
    if (asOfJune.ok) expect(asOfJune.value?.presentedAt).toBe(firstAt);
  });

  test('a different question gets its own chain, not a new version of this one', async () => {
    const fs = fakeFs();
    const booted = boot(fs);
    expect((await ask(booted, 'b1')).ok).toBe(true);
    expect((await ask(booted, 'b2', 'Should we open a second region?')).ok).toBe(true);

    const first = await deliberationHistory({ memory: booted.businessHistory, question: QUESTION });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.length).toBe(1);
  });
});

describe('an absent record is never read as a decision', () => {
  test('a question nobody framed returns null while a framed one is found', async () => {
    // Both halves in one system, because "returns null" on an empty store is
    // true of a lookup that never works at all. The positive control is what
    // makes the negative one mean something.
    const fs = fakeFs();
    const booted = boot(fs);
    expect((await ask(booted)).ok).toBe(true);

    const missing = await deliberationAsOf({
      memory: booted.businessHistory,
      question: 'a question never asked',
      at: clock.now().toISOString(),
    });
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.value).toBeNull();

    const present = await deliberationAsOf({
      memory: booted.businessHistory,
      question: QUESTION,
      at: clock.now().toISOString(),
    });
    expect(present.ok).toBe(true);
    if (present.ok) expect(present.value).not.toBeNull();
  });

  test('a framing is invisible BEFORE it was presented and visible after', async () => {
    // Pins `validFrom`, which is the whole bitemporal claim. Asserting only
    // the "before" half would pass against a lookup that never finds anything,
    // so both sides of the boundary are checked against one written record.
    const booted = boot(fakeFs());
    const set = {
      question: 'when did we ask this',
      criteria: ['c'],
      options: [],
      rejected: [],
      claims: [],
      unsourced: [],
      unpriced: [],
      createdAt: '2026-03-01T00:00:00.000Z',
      narrative: 'n',
    } as OptionSet;
    expect(
      (await rememberDeliberation({
        memory: booted.businessHistory,
        optionSet: set,
        runId: 'run_when',
      })).ok,
    ).toBe(true);

    const before = await deliberationAsOf({
      memory: booted.businessHistory,
      question: set.question,
      at: '2026-02-28T23:59:59.000Z',
    });
    expect(before.ok).toBe(true);
    if (before.ok) expect(before.value).toBeNull();

    const after = await deliberationAsOf({
      memory: booted.businessHistory,
      question: set.question,
      at: '2026-03-01T00:00:01.000Z',
    });
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value?.presentedAt).toBe('2026-03-01T00:00:00.000Z');
  });
});

describe('a broken archive fails loudly', () => {
  test('an unreadable framing is refused, never skipped', async () => {
    const fs = fakeFs();
    expect((await ask(boot(fs))).ok).toBe(true);

    // Corrupt ONLY the stored payload, leaving the log line valid JSON — so
    // the loader parses the record and `parse()` is the thing under test.
    // Breaking the whole line would make the store's own guard fire instead
    // and the assertion below would prove nothing about this module.
    const corrupted = fs
      .content()
      .replace(/"presentedAt":"[^"]*"/, '"presentedAt":123');
    expect(corrupted).not.toBe(fs.content());
    const broken: MemoryFileSystem = {
      existsSync: () => true,
      readFileSync: () => corrupted,
      appendFileSync: () => undefined,
    };

    const memoryStore = createDurableMemoryStore({ path: '/nexus.log', fs: broken, clock });
    const system = createNexusSystem({
      config: unwrap(loadConfig({})),
      policies: [grant],
      logger: nullLogger,
      clock,
      memory: memoryStore,
    });
    const businessHistory = createScopedVersionedMemory({
      store: memoryStore,
      subject: { kind: 'agent', id: 'business.strategy' },
      scopes: [BUSINESS_MEMORY_SCOPE],
      permissions: system.permissions,
    });

    const recalled = await deliberationAsOf({
      memory: businessHistory,
      question: QUESTION,
      at: clock.now().toISOString(),
    });
    // Not `ok(null)`: "unreadable" must never arrive at a KPI as "never framed".
    expect(recalled.ok).toBe(false);
    if (!recalled.ok) expect(recalled.error.code).toBe('INTERNAL');
  });

  test('a failed write fails the RUN rather than returning an unrecorded framing', async () => {
    const fs = fakeFs();
    const booted = boot(fs);
    fs.fail = true;
    const result = await ask(booted);
    expect(result.ok).toBe(false);
    expect(fs.content()).not.toContain('business:deliberation');
  });
});

describe('the memory boundary holds under an adversarial scope', () => {
  test('Business cannot read another division through its own view', async () => {
    const booted = boot(fakeFs());
    for (const scope of [
      { kind: 'division' as const, id: 'finance' },
      { kind: 'division' as const, id: 'research' },
      { kind: 'user' as const, id: 'owner' },
    ]) {
      const trespass = await booted.businessHistory.history(scope, deliberationKey(QUESTION));
      expect(trespass.ok, `business reached ${scope.kind}:${scope.id}`).toBe(false);
      if (!trespass.ok) expect(trespass.error.code).toBe('PERMISSION_DENIED');
    }
  });

  test('a scope id crafted to look like Business is still refused', async () => {
    // Not a proof that the key escaping is unbreakable -- `MemoryScope.kind`
    // is a closed union, so the two-part key cannot be made ambiguous from a
    // caller anyway. What this pins is that near-miss ids get no leniency:
    // matching is exact, and nothing prefix-matches its way in.
    const booted = boot(fakeFs());
    for (const id of ['business:extra', 'business\\', '\\:business']) {
      const trespass = await booted.businessHistory.history(
        { kind: 'division', id },
        deliberationKey(QUESTION),
      );
      expect(trespass.ok, `id '${id}' was accepted`).toBe(false);
    }
  });

  test('without memory:write the run fails rather than forgetting silently', async () => {
    const readOnly = allowListPolicy('read-only-business', [
      { subject: { kind: 'system' }, capabilities: [DISPATCH_CAPABILITY] },
      { subject: { kind: 'supervisor' }, capabilities: [DISPATCH_CAPABILITY] },
      {
        subject: { kind: 'agent' },
        capabilities: [
          DISPATCH_CAPABILITY,
          'tool:execute',
          'research:retrieve',
          'finance:actuals',
          'memory:read',
        ],
      },
    ]);
    const result = await ask(boot(fakeFs(), [readOnly]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');
  });
});

describe('rememberDeliberation records only what it was given', () => {
  test('it cannot be handed a decision: the write sets all three to null', async () => {
    const booted = boot(fakeFs());
    const set = {
      question: 'a direct write',
      criteria: ['c'],
      options: [],
      rejected: [],
      claims: [],
      unsourced: [],
      unpriced: [],
      createdAt: '2026-03-01T00:00:00.000Z',
      narrative: 'n',
    } as OptionSet;

    const written = await rememberDeliberation({
      memory: booted.businessHistory,
      optionSet: set,
      runId: 'run_direct',
    });
    expect(written.ok, written.ok ? '' : written.error.message).toBe(true);
    if (!written.ok) return;

    // There is no parameter for a decision, and the record proves it.
    expect(written.value.evaluatedAt).toBeNull();
    expect(written.value.selectedOptionId).toBeNull();
    expect(written.value.outcome).toBeNull();

    // `validFrom` is the set's OWN createdAt, not the write time — otherwise a
    // later "what was on the table in March" answers with June's paperwork.
    const inMarch = await deliberationAsOf({
      memory: booted.businessHistory,
      question: 'a direct write',
      at: '2026-03-02T00:00:00.000Z',
    });
    expect(inMarch.ok).toBe(true);
    if (inMarch.ok) expect(inMarch.value?.presentedAt).toBe('2026-03-01T00:00:00.000Z');
  });
});

describe('the §5 KPIs are BLOCKED, and the census says so', () => {
  test('a real archive tallies as entirely PRESENTED — zero selected, zero outcomes', async () => {
    const fs = fakeFs();
    const booted = boot(fs);
    expect((await ask(booted, 'b1')).ok).toBe(true);
    expect((await ask(booted, 'b2', 'Should we open a second region?')).ok).toBe(true);

    const all: Deliberation[] = [];
    for (const question of [QUESTION, 'Should we open a second region?']) {
      const history = await deliberationHistory({ memory: booted.businessHistory, question });
      expect(history.ok).toBe(true);
      if (history.ok) all.push(...history.value);
    }

    expect(tallyDeliberations(all)).toEqual({
      presented: 2,
      evaluated: 0,
      selected: 0,
      outcomeKnown: 0,
      outcomeUnattributed: 0,
    });
  });

  test('`selected: 0` is a count of records, not a claim that nobody chose', () => {
    // The census over an EMPTY archive is all zeros — which must not be read
    // as "no option was ever taken up". Persisting framings did not make any
    // §5 KPI computable, and the blocked list is what says so out loud.
    expect(tallyDeliberations([])).toEqual({
      presented: 0,
      evaluated: 0,
      selected: 0,
      outcomeKnown: 0,
      outcomeUnattributed: 0,
    });
    expect(BLOCKED_KPIS).toHaveLength(4);
    for (const blocked of BLOCKED_KPIS) expect(blocked).toContain('needs');
  });

  test('the census does distinguish the states when they are present', () => {
    // Not a tally that always answers "presented": given records in each
    // state it separates them, so the all-presented result above is evidence
    // about the archive rather than about the function.
    expect(
      tallyDeliberations([
        framing(),
        framing({ evaluatedAt: '2026-03-05T00:00:00.000Z' }),
        framing({ selectedOptionId: 'buy' }),
        framing({ selectedOptionId: 'buy', outcome: 'margin fell' }),
        framing({ outcome: 'margin fell' }),
      ]),
    ).toEqual({
      presented: 1,
      evaluated: 1,
      selected: 1,
      outcomeKnown: 1,
      outcomeUnattributed: 1,
    });
  });
});
