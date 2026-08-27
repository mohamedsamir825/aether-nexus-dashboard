import { test, expect, describe } from 'bun:test';
import { accuracyByHorizon, explanationRatio, financeKpis, timeToForecastUpdate } from '../src/kpi.ts';
import { createForecastLedger } from '../src/ledger.ts';
import type { DriverAttribution, ForecastVintage } from '../src/types.ts';
import { BASELINE, Q1_ABOVE } from './fixtures.ts';

const revised = (over: Partial<ForecastVintage> = {}): ForecastVintage => ({
  ...BASELINE,
  id: 'fv_2',
  version: 2,
  supersedes: 'fv_base',
  reason: 'revised',
  createdAt: '2026-04-05T11:30:00.000Z',
  amounts: [
    { lineItem: 'revenue', period: '2026-Q1', value: 55_000, origin: 'forecast' },
    { lineItem: 'cogs', period: '2026-Q1', value: 33_000, origin: 'forecast' },
  ],
  ...over,
});

const attribution = (total: number, unexplained: number): DriverAttribution => ({
  lineItem: 'revenue',
  period: '2026-Q1',
  total,
  contributions: [],
  unexplained,
});

describe('forecast accuracy per horizon — the KPI immutability exists for', () => {
  test('scores every vintage, not just the current one', () => {
    // With a mutable forecast this would report zero error at every horizon,
    // because the only surviving number would be the corrected one.
    const ledger = createForecastLedger({ initial: [BASELINE] });
    expect(ledger.append(revised()).ok).toBe(true);

    const scored = accuracyByHorizon({ ledger, actuals: Q1_ABOVE });
    const revenue = scored.filter((s) => s.lineItem === 'revenue');
    expect(revenue).toHaveLength(2);

    // Horizon 1 is the baseline: forecast 50,000 against 56,000 actual.
    const older = revenue.find((s) => s.horizon === 1);
    expect(older?.forecast).toBe(50_000);
    expect(older?.error).toBe(6_000);

    // Horizon 0 is the latest: 55,000, so it was closer.
    const newer = revenue.find((s) => s.horizon === 0);
    expect(newer?.forecast).toBe(55_000);
    expect(newer?.error).toBe(1_000);
    expect(Math.abs(newer?.error ?? 0)).toBeLessThan(Math.abs(older?.error ?? 0));
  });

  test('a line item a vintage never forecast is skipped, not scored as zero', () => {
    const ledger = createForecastLedger({
      initial: [{ ...BASELINE, amounts: [] }],
    });
    expect(accuracyByHorizon({ ledger, actuals: Q1_ABOVE })).toEqual([]);
  });

  test('percentage error is null against a zero actual rather than Infinity', () => {
    const ledger = createForecastLedger({ initial: [BASELINE] });
    const scored = accuracyByHorizon({
      ledger,
      actuals: {
        ...Q1_ABOVE,
        amounts: [{ lineItem: 'revenue', period: '2026-Q1', value: 0, origin: 'actual' }],
      },
    });
    expect(scored[0]?.absPercent).toBeNull();
    expect(scored[0]?.error).toBe(-50_000);
  });
});

describe('variance explained versus unexplained', () => {
  test('computes the share the drivers actually account for', () => {
    const ratio = explanationRatio([attribution(6_000, 1_500)]);
    expect(ratio.total).toBe(6_000);
    expect(ratio.explained).toBe(4_500);
    expect(ratio.explainedShare).toBe(0.75);
  });

  test('opposing variances do not net out into false perfection', () => {
    // +100 and -100 are two things the model had to explain. Netting them
    // would report a division that explained everything by explaining nothing.
    const ratio = explanationRatio([attribution(100, 100), attribution(-100, -100)]);
    expect(ratio.total).toBe(200);
    expect(ratio.unexplained).toBe(200);
    expect(ratio.explainedShare).toBe(0);
  });

  test('nothing to explain yields null, not a flattering 1.0', () => {
    expect(explanationRatio([]).explainedShare).toBeNull();
  });
});

describe('time from actuals landing to forecast update', () => {
  test('measures from validation, not from generation', () => {
    // Q1_ABOVE validated 09:00, revision at 11:30 = 2.5 hours.
    const ms = timeToForecastUpdate({ actuals: Q1_ABOVE, revised: revised() });
    expect(ms).toBe(2.5 * 60 * 60 * 1000);
  });

  test('no revision is null, not a duration', () => {
    // The absence of a response is not a slow response.
    expect(timeToForecastUpdate({ actuals: Q1_ABOVE, revised: null })).toBeNull();
  });

  test('an unparseable timestamp is null rather than NaN', () => {
    expect(
      timeToForecastUpdate({
        actuals: { ...Q1_ABOVE, validatedAt: 'not a date' },
        revised: revised(),
      }),
    ).toBeNull();
  });
});

describe('the KPI bundle', () => {
  test('gathers all three computable KPIs', () => {
    const ledger = createForecastLedger({ initial: [BASELINE] });
    ledger.append(revised());
    const kpis = financeKpis({
      ledger,
      actuals: Q1_ABOVE,
      attributions: [attribution(6_000, 0)],
      revised: revised(),
    });
    expect(kpis.accuracy.length).toBeGreaterThan(0);
    expect(kpis.explanation.explainedShare).toBe(1);
    expect(kpis.msToForecastUpdate).toBeGreaterThan(0);
  });
});
