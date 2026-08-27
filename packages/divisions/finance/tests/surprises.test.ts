import { test, expect, describe } from 'bun:test';
import { assessSurprises, tallySurprises } from '../src/kpi.ts';
import { analyseVariance } from '../src/variance.ts';
import type { ScenarioSet, Variance } from '../src/types.ts';
import { BASELINE, Q1_ABOVE } from './fixtures.ts';

/** Paths spanning 45,000–65,000 for Q1 revenue. */
const scenarios = (over: Partial<ScenarioSet> = {}): ScenarioSet => ({
  basedOnVintage: 'fv_base',
  createdAt: '2026-02-01T00:00:00.000Z',
  expected: [],
  paths: [
    {
      id: 's_down',
      label: 'downside',
      probability: 0.3,
      drivers: [],
      amounts: [{ lineItem: 'revenue', period: '2026-Q1', value: 45_000, origin: 'forecast' }],
    },
    {
      id: 's_up',
      label: 'upside',
      probability: 0.7,
      drivers: [],
      amounts: [{ lineItem: 'revenue', period: '2026-Q1', value: 65_000, origin: 'forecast' }],
    },
  ],
  ...over,
});

/** Actual 56,000 against a 50,000 forecast: material. */
const materialVariance = (): readonly Variance[] =>
  analyseVariance({ actuals: Q1_ABOVE, baseline: BASELINE });

describe('a variance the scenarios anticipated is FLAGGED', () => {
  test('an actual inside the spanned range was foreseen', () => {
    // 56,000 sits between the downside 45,000 and the upside 65,000.
    const assessed = assessSurprises({ variances: materialVariance(), scenarios: scenarios() });
    const revenue = assessed.find((a) => a.lineItem === 'revenue');

    expect(revenue?.status).toBe('flagged');
    expect(revenue?.coveredBy).toBeDefined();
    expect(revenue?.range).toEqual({ low: 45_000, high: 65_000 });
    // The assessment names WHICH set it consulted and when that set was dated,
    // so a reader can check the lookup was not done with hindsight.
    expect(revenue?.scenarioSet).toBe('fv_base');
    expect(revenue?.scenariosDatedFrom).toBe('2026-02-01T00:00:00.000Z');
  });

  test('an actual exactly on a path boundary counts as flagged', () => {
    // A path that named this precise number did anticipate it.
    const assessed = assessSurprises({
      variances: materialVariance(),
      scenarios: scenarios({
        paths: [
          {
            id: 'exact',
            label: 'exact',
            probability: 1,
            drivers: [],
            amounts: [{ lineItem: 'revenue', period: '2026-Q1', value: 56_000, origin: 'forecast' }],
          },
        ],
      }),
    });
    expect(assessed.find((a) => a.lineItem === 'revenue')?.status).toBe('flagged');
  });
});

describe('a variance outside every path is a real UNFLAGGED surprise', () => {
  test('an actual beyond the spanned range was not foreseen', () => {
    const assessed = assessSurprises({
      variances: materialVariance(),
      scenarios: scenarios({
        paths: [
          {
            id: 'narrow',
            label: 'narrow',
            probability: 1,
            drivers: [],
            amounts: [{ lineItem: 'revenue', period: '2026-Q1', value: 50_500, origin: 'forecast' }],
          },
        ],
      }),
    });
    const revenue = assessed.find((a) => a.lineItem === 'revenue');
    expect(revenue?.status).toBe('unflagged');
    // The range is still reported, so a near miss reads as a near miss.
    expect(revenue?.range).toEqual({ low: 50_500, high: 50_500 });
    expect(revenue?.coveredBy).toBeUndefined();
  });
});

describe('absence of a record is UNMEASURED, never a fabricated "not flagged"', () => {
  test('no scenario set at all is unmeasured', () => {
    // The distinction the whole KPI turns on: an empty archive is not a
    // failure by the division, and reporting it as one manufactures a miss.
    const assessed = assessSurprises({ variances: materialVariance(), scenarios: null });
    const revenue = assessed.find((a) => a.lineItem === 'revenue');

    expect(revenue?.status).toBe('unmeasured');
    expect(revenue?.status).not.toBe('unflagged');
    // Nothing invented: no range, no set, no date.
    expect(revenue?.range).toBeUndefined();
    expect(revenue?.scenarioSet).toBeUndefined();
  });

  test('a set that says nothing about this line item is unmeasured', () => {
    const assessed = assessSurprises({
      variances: materialVariance(),
      scenarios: scenarios({
        paths: [
          {
            id: 'other',
            label: 'other',
            probability: 1,
            drivers: [],
            amounts: [{ lineItem: 'headcount', period: '2026-Q1', value: 12, origin: 'forecast' }],
          },
        ],
      }),
    });
    const revenue = assessed.find((a) => a.lineItem === 'revenue');
    expect(revenue?.status).toBe('unmeasured');
    // It DID consult a set, and says which — different from having none.
    expect(revenue?.scenarioSet).toBe('fv_base');
  });

  test('a set about a different PERIOD is unmeasured, not flagged', () => {
    // Q2 paths say nothing about a Q1 surprise.
    const assessed = assessSurprises({
      variances: materialVariance(),
      scenarios: scenarios({
        paths: [
          {
            id: 'q2',
            label: 'q2',
            probability: 1,
            drivers: [],
            amounts: [{ lineItem: 'revenue', period: '2026-Q2', value: 56_000, origin: 'forecast' }],
          },
        ],
      }),
    });
    expect(assessed.find((a) => a.lineItem === 'revenue')?.status).toBe('unmeasured');
  });
});

describe('only material variances are assessed', () => {
  test('an immaterial variance is not a surprise and is not counted', () => {
    const assessed = assessSurprises({
      variances: [
        {
          lineItem: 'revenue',
          period: '2026-Q1',
          forecast: 50_000,
          actual: 50_100,
          delta: 100,
          relative: 0.002,
          material: false,
          reason: 'within both thresholds',
        },
      ],
      scenarios: null,
    });
    expect(assessed).toEqual([]);
  });
});

describe('the tally keeps the three outcomes apart', () => {
  test('counts each status separately', () => {
    const tally = tallySurprises([
      { lineItem: 'a', period: 'p', actual: 1, status: 'flagged' },
      { lineItem: 'b', period: 'p', actual: 1, status: 'unflagged' },
      { lineItem: 'c', period: 'p', actual: 1, status: 'unmeasured' },
      { lineItem: 'd', period: 'p', actual: 1, status: 'unmeasured' },
    ]);
    expect(tally).toEqual({ flagged: 1, unflagged: 1, unmeasured: 2 });
  });

  test('an all-unmeasured tally reports ZERO unflagged, not zero surprises', () => {
    // "We failed to flag nothing" and "we measured nothing" must not produce
    // the same reading. Both are zero unflagged; only one is a good record.
    const tally = tallySurprises([
      { lineItem: 'a', period: 'p', actual: 1, status: 'unmeasured' },
      { lineItem: 'b', period: 'p', actual: 1, status: 'unmeasured' },
    ]);
    expect(tally.unflagged).toBe(0);
    expect(tally.unmeasured).toBe(2);
    // A caller reading only `unflagged` would see a perfect record; the
    // unmeasured count is what stops that being the whole story.
    expect(tally.unmeasured).toBeGreaterThan(0);
  });
});
