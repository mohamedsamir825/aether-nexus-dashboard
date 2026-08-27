import { test, expect, describe } from 'bun:test';
import { emptyUsage } from '../src/contracts/execution.ts';
import { mergeUsage, sumUsage } from '../src/runtime/usage.ts';
import type { UsageMetrics } from '../src/contracts/execution.ts';

const usage = (over: Partial<UsageMetrics> = {}): UsageMetrics => ({
  ...emptyUsage,
  ...over,
});

describe('merging usage across a delegation chain', () => {
  test('adds the countable fields', () => {
    const merged = mergeUsage(
      usage({ modelCalls: 1, toolCalls: 2, inputTokens: 10, outputTokens: 5, durationMs: 100 }),
      usage({ modelCalls: 3, toolCalls: 1, inputTokens: 20, outputTokens: 7, durationMs: 250 }),
    );
    expect(merged).toEqual({
      modelCalls: 4,
      toolCalls: 3,
      inputTokens: 30,
      outputTokens: 12,
      durationMs: 350,
    });
  });

  test('two known costs make a known total', () => {
    const merged = mergeUsage(usage({ costMinorUnits: 40 }), usage({ costMinorUnits: 2 }));
    expect(merged.costMinorUnits).toBe(42);
  });

  test('one unknown cost makes the TOTAL unknown, not a partial sum', () => {
    // §21: cost is "omitted -- never zero -- when cost is unknown, so 'free'
    // and 'unmeasured' stay distinguishable". A partial sum labelled as the
    // total is the same confusion wearing a number.
    expect(mergeUsage(usage({ costMinorUnits: 40 }), usage()).costMinorUnits).toBeUndefined();
    expect(mergeUsage(usage(), usage({ costMinorUnits: 40 })).costMinorUnits).toBeUndefined();
  });

  test('unknown is not zero — the distinction the field exists for', () => {
    const free = mergeUsage(usage({ costMinorUnits: 0 }), usage({ costMinorUnits: 0 }));
    const unmeasured = mergeUsage(usage(), usage());

    // A chain that genuinely cost nothing reports 0.
    expect(free.costMinorUnits).toBe(0);
    // A chain nobody measured reports nothing at all.
    expect(unmeasured.costMinorUnits).toBeUndefined();
    expect('costMinorUnits' in unmeasured).toBe(false);
  });

  test('merging with an empty usage changes nothing but stays unmeasured', () => {
    const one = usage({ toolCalls: 3, costMinorUnits: 12 });
    const merged = mergeUsage(one, emptyUsage);
    expect(merged.toolCalls).toBe(3);
    // emptyUsage has no cost, so the total is honestly unknown.
    expect(merged.costMinorUnits).toBeUndefined();
  });
});

describe('folding many usages', () => {
  test('sums a whole chain', () => {
    const total = sumUsage([
      usage({ toolCalls: 1, durationMs: 10 }),
      usage({ toolCalls: 2, durationMs: 20 }),
      usage({ toolCalls: 4, durationMs: 30 }),
    ]);
    expect(total.toolCalls).toBe(7);
    expect(total.durationMs).toBe(60);
  });

  test('an all-known chain keeps a known cost', () => {
    const total = sumUsage([usage({ costMinorUnits: 5 }), usage({ costMinorUnits: 7 })]);
    expect(total.costMinorUnits).toBe(12);
  });

  test('one unmeasured leg makes the whole fold unmeasured', () => {
    const total = sumUsage([
      usage({ costMinorUnits: 5 }),
      usage(), // nobody measured this one
      usage({ costMinorUnits: 7 }),
    ]);
    expect(total.costMinorUnits).toBeUndefined();
  });

  test('an empty list is zero, and zero cost is a real answer', () => {
    expect(sumUsage([])).toEqual({ ...emptyUsage, costMinorUnits: 0 });
  });
});
