import { test, expect, describe } from 'bun:test';
import {
  DEFAULT_MATERIALITY,
  analyseVariance,
  attributeDrivers,
  hasMaterialVariance,
} from '../src/variance.ts';
import { analyseScenarios, updateForecast } from '../src/forecast.ts';
import { createForecastLedger } from '../src/ledger.ts';
import {
  BASELINE,
  FPA,
  HORIZON,
  Q1_ABOVE,
  Q1_DRIVERS,
  Q1_QUIET,
  Q1_UNEXPLAINED,
  RUN,
  SCENARIOS,
  SENSITIVITIES,
  fixedNow,
} from './fixtures.ts';

const sensitivity = (lineItem: string, driver: string): number | undefined =>
  SENSITIVITIES[lineItem]?.[driver];

describe('variance analysis — arithmetic, checked by hand', () => {
  test('computes delta and relative variance correctly', () => {
    const variances = analyseVariance({ actuals: Q1_ABOVE, baseline: BASELINE });
    const revenue = variances.find((v) => v.lineItem === 'revenue');

    // 56,000 actual against 50,000 forecast = +6,000 = +12%.
    expect(revenue?.forecast).toBe(50_000);
    expect(revenue?.actual).toBe(56_000);
    expect(revenue?.delta).toBe(6_000);
    expect(revenue?.relative).toBeCloseTo(0.12, 10);
    expect(revenue?.material).toBe(true);
  });

  test('only the period under analysis is compared', () => {
    // The baseline forecasts Q1 and Q2. Q2 must not appear in a Q1 analysis.
    const variances = analyseVariance({ actuals: Q1_ABOVE, baseline: BASELINE });
    expect(variances.every((v) => v.period === '2026-Q1')).toBe(true);
    expect(variances.map((v) => v.lineItem).sort()).toEqual(['cogs', 'revenue']);
  });

  test('a variance inside both thresholds is not material', () => {
    // +400 on 50,000 is 0.8% — under 5% and under 1,000 absolute.
    const variances = analyseVariance({ actuals: Q1_QUIET, baseline: BASELINE });
    expect(hasMaterialVariance(variances)).toBe(false);
    expect(variances.find((v) => v.lineItem === 'revenue')?.reason).toBe('within both thresholds');
  });

  test('either threshold alone makes it material', () => {
    // 2,000 on 50,000 is 4% — under the relative bar but over the absolute one.
    const variances = analyseVariance({
      actuals: {
        ...Q1_QUIET,
        amounts: [{ lineItem: 'revenue', period: '2026-Q1', value: 52_000, origin: 'actual' }],
      },
      baseline: BASELINE,
      policy: DEFAULT_MATERIALITY,
    });
    const revenue = variances.find((v) => v.lineItem === 'revenue');
    expect(revenue?.material).toBe(true);
    expect(revenue?.reason).toContain('absolute threshold');
  });

  test('materiality is configuration — a stricter policy changes the answer', () => {
    // §4.3: thresholds are the owner's, not the model's. Same numbers, and a
    // tighter policy makes the same variance material.
    const strict = analyseVariance({
      actuals: Q1_QUIET,
      baseline: BASELINE,
      policy: { absolute: 100, relative: 0.001 },
    });
    expect(hasMaterialVariance(strict)).toBe(true);
  });

  test('a line item that was forecast but never arrived is material regardless of size', () => {
    const variances = analyseVariance({
      actuals: { ...Q1_ABOVE, amounts: [Q1_ABOVE.amounts[0] as never] },
      baseline: BASELINE,
    });
    const cogs = variances.find((v) => v.lineItem === 'cogs');
    // Its absence IS the finding. An inner join would have dropped it.
    expect(cogs?.material).toBe(true);
    expect(cogs?.reason).toContain('no actual arrived');
  });

  test('a zero forecast yields a null ratio, never Infinity', () => {
    const variances = analyseVariance({
      actuals: {
        ...Q1_ABOVE,
        amounts: [{ lineItem: 'newline', period: '2026-Q1', value: 500, origin: 'actual' }],
      },
      baseline: BASELINE,
    });
    const fresh = variances.find((v) => v.lineItem === 'newline');
    expect(fresh?.relative).toBeNull();
    expect(fresh?.material).toBe(true);
    expect(fresh?.reason).toContain('not forecast');
  });
});

describe('driver attribution — and the residual it refuses to hide', () => {
  test('attributes a variance the drivers fully explain', () => {
    const variances = analyseVariance({ actuals: Q1_ABOVE, baseline: BASELINE });
    const revenue = variances.find((v) => v.lineItem === 'revenue');
    expect(revenue).toBeDefined();
    if (!revenue) return;

    // (1120 − 1000) units × 50 per unit = exactly the 6,000 variance.
    const attribution = attributeDrivers({
      variance: revenue,
      baseline: BASELINE,
      observed: Q1_DRIVERS,
      sensitivity,
    });
    expect(attribution.contributions).toHaveLength(1);
    expect(attribution.contributions[0]?.driver).toBe('units');
    expect(attribution.contributions[0]?.amount).toBe(6_000);
    expect(attribution.unexplained).toBe(0);
  });

  test('the residual is reported, never distributed to make the bridge tie out', () => {
    // Revenue missed by 30,000 and no driver moved. A bridge that always
    // balances would report perfect explanation of a total mystery.
    const variances = analyseVariance({ actuals: Q1_UNEXPLAINED, baseline: BASELINE });
    const revenue = variances.find((v) => v.lineItem === 'revenue');
    expect(revenue).toBeDefined();
    if (!revenue) return;

    const attribution = attributeDrivers({
      variance: revenue,
      baseline: BASELINE,
      observed: [],
      sensitivity,
    });
    expect(attribution.contributions).toEqual([]);
    expect(attribution.unexplained).toBe(-30_000);
    expect(attribution.total).toBe(-30_000);
  });

  test('a driver with no modelled effect on the line item contributes nothing', () => {
    const variances = analyseVariance({ actuals: Q1_ABOVE, baseline: BASELINE });
    const revenue = variances.find((v) => v.lineItem === 'revenue');
    if (!revenue) return;

    // unitCost moves COGS, not revenue. Attributing it to revenue would be
    // inventing a causal link the owner's model does not assert.
    const attribution = attributeDrivers({
      variance: revenue,
      baseline: BASELINE,
      observed: [{ id: 'unitCost', value: 45 }],
      sensitivity,
    });
    expect(attribution.contributions).toEqual([]);
  });

  test('each contribution carries the basis of the driver it came from', () => {
    const variances = analyseVariance({ actuals: Q1_ABOVE, baseline: BASELINE });
    const revenue = variances.find((v) => v.lineItem === 'revenue');
    if (!revenue) return;
    const attribution = attributeDrivers({
      variance: revenue,
      baseline: BASELINE,
      observed: Q1_DRIVERS,
      sensitivity,
    });
    expect(attribution.contributions[0]?.basis).toContain('FY25 run rate');
    expect(attribution.contributions[0]?.basis).toContain('1000 -> 1120');
  });
});

describe('forecast update', () => {
  test('rolls a driver movement into every open period and supersedes the baseline', () => {
    const ledger = createForecastLedger({ initial: [BASELINE] });
    const revised = updateForecast({
      ledger,
      baseline: BASELINE,
      observed: Q1_DRIVERS,
      attributions: [],
      reason: 'Q1 actuals',
      createdBy: FPA,
      runId: RUN,
      now: fixedNow,
      sensitivity,
      horizon: HORIZON,
    });

    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    // Q2 revenue moves by the same 6,000: the driver applies to the horizon.
    const q2 = revised.value.amounts.find(
      (a) => a.lineItem === 'revenue' && a.period === '2026-Q2',
    );
    expect(q2?.value).toBe(56_000);
    expect(revised.value.supersedes).toBe('fv_base');
    expect(revised.value.version).toBe(2);
    // ...and the baseline is untouched.
    expect(BASELINE.amounts.find((a) => a.period === '2026-Q2')?.value).toBe(50_000);
  });

  test('a period outside the horizon is left alone', () => {
    const ledger = createForecastLedger({ initial: [BASELINE] });
    const revised = updateForecast({
      ledger,
      baseline: BASELINE,
      observed: Q1_DRIVERS,
      attributions: [],
      reason: 'Q1 actuals',
      createdBy: FPA,
      runId: RUN,
      now: fixedNow,
      sensitivity,
      horizon: ['2026-Q2'], // Q1 is closed
    });
    if (!revised.ok) throw new Error('expected success');
    expect(
      revised.value.amounts.find((a) => a.lineItem === 'revenue' && a.period === '2026-Q1')?.value,
    ).toBe(50_000);
  });

  test('no driver movement means no revision, rather than a duplicate vintage', () => {
    const ledger = createForecastLedger({ initial: [BASELINE] });
    const revised = updateForecast({
      ledger,
      baseline: BASELINE,
      observed: [{ id: 'units', value: 1_000 }],
      attributions: [],
      reason: 'nothing moved',
      createdBy: FPA,
      runId: RUN,
      now: fixedNow,
      sensitivity,
      horizon: HORIZON,
    });
    expect(revised.ok).toBe(false);
    expect(ledger.all()).toHaveLength(1);
  });

  test('unexplained variance lowers the confidence of the revision', () => {
    const ledger = createForecastLedger({ initial: [BASELINE] });
    const revised = updateForecast({
      ledger,
      baseline: BASELINE,
      observed: Q1_DRIVERS,
      // Half the movement is unexplained.
      attributions: [
        { lineItem: 'revenue', period: '2026-Q1', total: 6_000, contributions: [], unexplained: 3_000 },
      ],
      reason: 'partly explained',
      createdBy: FPA,
      runId: RUN,
      now: fixedNow,
      sensitivity,
      horizon: HORIZON,
    });
    if (!revised.ok) throw new Error('expected success');
    // A forecast revised for reasons the model does not understand is less
    // trustworthy, and says so rather than inheriting the old confidence.
    expect(revised.value.confidence).toBeLessThan(BASELINE.confidence);
    expect(revised.value.confidence).toBeCloseTo(0.4, 10);
  });
});

describe('scenario analysis', () => {
  test('weights paths and computes a probability-weighted expectation', () => {
    const set = analyseScenarios({
      vintage: BASELINE,
      specs: SCENARIOS,
      sensitivity,
      now: fixedNow,
    });
    expect(set.ok).toBe(true);
    if (!set.ok) return;

    // base 50,000 (0.6) + upside 65,000 (0.2) + downside 45,000 (0.2)
    //   = 30,000 + 13,000 + 9,000 = 52,000
    const q1 = set.value.expected.find(
      (a) => a.lineItem === 'revenue' && a.period === '2026-Q1',
    );
    expect(q1?.value).toBeCloseTo(52_000, 6);
    expect(q1?.origin).toBe('derived');
  });

  test('probabilities that do not sum to 1 are refused, not normalised', () => {
    // Normalising silently would invent the owner's probabilities for them.
    const set = analyseScenarios({
      vintage: BASELINE,
      specs: [{ id: 'a', label: 'a', probability: 0.5, drivers: [] }],
      sensitivity,
      now: fixedNow,
    });
    expect(set.ok).toBe(false);
    if (!set.ok) expect(set.error.message).toContain('sum to 0.5');
  });

  test('an empty scenario set is refused', () => {
    const set = analyseScenarios({ vintage: BASELINE, specs: [], sensitivity, now: fixedNow });
    expect(set.ok).toBe(false);
  });

  test('each path records the drivers that define it', () => {
    const set = analyseScenarios({ vintage: BASELINE, specs: SCENARIOS, sensitivity, now: fixedNow });
    if (!set.ok) throw new Error('expected success');
    const upside = set.value.paths.find((p) => p.label === 'upside');
    expect(upside?.drivers.find((d) => d.id === 'units')?.value).toBe(1_300);
    expect(upside?.drivers.find((d) => d.id === 'units')?.basis).toContain("scenario 'upside'");
  });
});
