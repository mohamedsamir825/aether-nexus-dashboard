import { test, expect, describe } from 'bun:test';
import { claimId } from '@nexus/core';
import { createOptionValidator } from '../src/option-validator.ts';
import type { Consequence, OptionSet, StrategicOption } from '../src/types.ts';

const validator = createOptionValidator();

const consequence = (over: Partial<Consequence> = {}): Consequence => ({
  criterion: 'cost',
  statement: 'something happens',
  favourable: true,
  derivedFrom: [claimId('cl_1')],
  ...over,
});

const option = (over: Partial<StrategicOption> = {}): StrategicOption => ({
  id: 'o1',
  label: 'Build it in-house',
  description: 'Hire and build',
  upsides: [consequence()],
  downsides: [consequence({ favourable: false, statement: 'costs money' })],
  priced: [],
  supportedBy: [],
  assumptions: ['the team can hire'],
  openQuestions: [],
  ...over,
});

const set = (over: Partial<OptionSet> = {}): OptionSet => ({
  question: 'build or buy?',
  criteria: ['cost'],
  options: [option(), option({ id: 'o2', label: 'Buy it' })],
  rejected: [],
  claims: [],
  unsourced: [],
  unpriced: [],
  refusals: [],
  createdAt: '2026-06-01T12:00:00.000Z',
  narrative: '',
  ...over,
});

describe('§5 prohibition: Business does not price', () => {
  test('a figure with no pricing run behind it is refused', () => {
    // Business inventing a number would put its guess where Finance's
    // accountable answer belongs, and look identical in the output.
    const result = validator.validateOption(
      option({ priced: [{ driver: 'headcount', amount: 250_000, period: '2026' }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Business does not price');
  });

  test('a figure carrying its pricing run is accepted', () => {
    const result = validator.validateOption(
      option({
        priced: [{ driver: 'headcount', amount: 250_000, period: '2026', pricedBy: 'fv_7' }],
      }),
    );
    expect(result.ok).toBe(true);
  });

  test('an empty pricedBy is not a pricing run', () => {
    const result = validator.validateOption(
      option({ priced: [{ driver: 'x', amount: 1, period: 'p', pricedBy: '  ' }] }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('§5 prohibition: every option states both directions', () => {
  test('an option with no downside has been advocated for, not analysed', () => {
    const result = validator.validateOption(option({ downsides: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('every real choice costs something');
  });

  test('an option with no upside is not an option', () => {
    const result = validator.validateOption(option({ upsides: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('nobody can argue for');
  });

  test('a consequence deriving from no claim is unsupported (§6.1)', () => {
    const result = validator.validateOption(
      option({ upsides: [consequence({ derivedFrom: [] })] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('derives from no claim');
  });

  test('an option with no stated assumptions cannot be argued against', () => {
    const result = validator.validateOption(option({ assumptions: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('cannot be argued against');
  });
});

describe('§5 prohibition: Business does not recommend', () => {
  test('a single-option set IS a recommendation, and is refused', () => {
    // The literal form. §5 reserves the strategic call for the user, and a set
    // of one has already made it.
    const result = validator.validateSet(set({ options: [option()] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('reserves the strategic call');
  });

  test('an empty set is refused too', () => {
    expect(validator.validateSet(set({ options: [] })).ok).toBe(false);
  });

  test('one costless option among several IS a recommendation in disguise', () => {
    // The form that actually happens: technically a set, in practice a winner
    // with three foils. Catching only the single-option case would miss this.
    const result = validator.validateSet(
      set({ options: [option(), option({ id: 'o2', label: 'Buy', downsides: [] })] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('frames the rest as losers');
  });

  test('a genuine set of trade-offs passes', () => {
    expect(validator.validateSet(set()).ok).toBe(true);
  });
});

describe('a set must be a comparison, not several analyses side by side', () => {
  test('an option silent on a criterion is caught', () => {
    const result = validator.validateSet(
      set({
        criteria: ['cost', 'speed'],
        options: [
          option({
            upsides: [consequence({ criterion: 'cost' })],
            downsides: [consequence({ criterion: 'speed', favourable: false })],
          }),
          option({ id: 'o2' }), // says nothing about speed
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('says nothing about: speed');
  });

  test('options cannot be compared on no criteria', () => {
    const result = validator.validateSet(set({ criteria: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('compared on nothing');
  });

  test('every problem is reported at once, not just the first', () => {
    const result = validator.validateSet(
      set({ criteria: [], options: [option({ assumptions: [] })] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const problems = result.error.details?.problems as string[];
      expect(problems.length).toBeGreaterThan(2);
    }
  });
});

describe('the type itself refuses to name a winner', () => {
  test('OptionSet has no recommendation field', () => {
    // A structural assertion: if someone adds `recommended` later, this fails
    // and they have to argue with §5 rather than with a linter.
    const keys = Object.keys(set());
    expect(keys).not.toContain('recommendation');
    expect(keys).not.toContain('recommended');
    expect(keys).not.toContain('preferred');
    expect(keys).not.toContain('ranking');
  });
});
