/**
 * Finance KPIs (spec §4.2).
 *
 * §4.2 names five: forecast accuracy against subsequent actuals tracked per
 * horizon; variance explained versus unexplained; time from actuals landing to
 * forecast update; proportion of recommendations acted on; and material
 * surprises the division failed to flag.
 *
 * Three of them are computable from what this division already holds, and are
 * implemented. Two are not, and are absent rather than approximated — see the
 * bottom of this file. A KPI that quietly reports a plausible number nobody can
 * check is worse than a missing one, because it will be believed.
 *
 * ## Why these live here and not on `DivisionDescriptor`
 *
 * Gap `A2` schedules KPIs as a Core contract concern and they are still
 * deferred there. Putting a `kpis` field on the descriptor now would be a
 * contract edit made for one division's convenience (ADR 0004). Finance can
 * measure itself without the Core knowing how, and when the contract arrives
 * these become its implementation rather than something to unpick.
 */
import { accuracyOf, type ForecastLedger } from './ledger.ts';
import type { Actuals, DriverAttribution, ForecastVintage } from './types.ts';

export interface AccuracyByHorizon {
  /** How many vintages before the period this forecast was made. */
  readonly horizon: number;
  readonly lineItem: string;
  readonly period: string;
  readonly forecast: number;
  readonly actual: number;
  readonly error: number;
  readonly absPercent: number | null;
}

/**
 * Forecast accuracy per horizon (§4.2, first KPI).
 *
 * Horizon is measured in vintages, not in time: vintage N-1 predicted this
 * period one revision ago, vintage N-3 three revisions ago, and the whole point
 * of keeping superseded vintages is that all of them can still be scored.
 *
 * This is the KPI that only exists because the ledger never overwrites. With
 * mutable forecasts every horizon would report zero error.
 */
export function accuracyByHorizon(params: {
  readonly ledger: ForecastLedger;
  readonly actuals: Actuals;
}): readonly AccuracyByHorizon[] {
  const chain = params.ledger.all();
  const out: AccuracyByHorizon[] = [];

  for (const [index, vintage] of chain.entries()) {
    // Distance from the newest vintage: the last one is horizon 0.
    const horizon = chain.length - 1 - index;
    for (const amount of params.actuals.amounts) {
      const measured = accuracyOf(vintage, amount.lineItem, amount.period, amount.value);
      if (measured === null) continue;
      out.push({
        horizon,
        lineItem: amount.lineItem,
        period: amount.period,
        forecast: measured.forecast,
        actual: amount.value,
        error: measured.error,
        absPercent: measured.absPercent,
      });
    }
  }
  return out;
}

export interface ExplanationRatio {
  readonly total: number;
  readonly explained: number;
  readonly unexplained: number;
  /** 0..1, or null when nothing moved and the ratio would be 0/0. */
  readonly explainedShare: number | null;
}

/**
 * Variance explained versus unexplained (§4.2, second KPI).
 *
 * Absolute values throughout: a +100 and a -100 variance are two things the
 * model had to explain, and netting them to zero would report a division that
 * explained everything by explaining nothing.
 */
export function explanationRatio(
  attributions: readonly DriverAttribution[],
): ExplanationRatio {
  const total = attributions.reduce((sum, a) => sum + Math.abs(a.total), 0);
  const unexplained = attributions.reduce((sum, a) => sum + Math.abs(a.unexplained), 0);
  const explained = total - unexplained;
  return {
    total,
    explained,
    unexplained,
    explainedShare: total === 0 ? null : Number((explained / total).toFixed(4)),
  };
}

/**
 * Time from actuals landing to forecast update (§4.2, third KPI).
 *
 * Measured from the Controller's validation timestamp to the vintage's
 * creation, because §4.3 starts the clock when actuals are *validated*, not
 * when they were generated.
 *
 * Returns null when no revision happened — which is not a slow response, it is
 * the absence of one, and reporting it as a duration would be a fabrication.
 */
export function timeToForecastUpdate(params: {
  readonly actuals: Actuals;
  readonly revised: ForecastVintage | null;
}): number | null {
  if (params.revised === null) return null;
  const landed = Date.parse(params.actuals.validatedAt);
  const revised = Date.parse(params.revised.createdAt);
  if (!Number.isFinite(landed) || !Number.isFinite(revised)) return null;
  return revised - landed;
}

export interface FinanceKpis {
  readonly accuracy: readonly AccuracyByHorizon[];
  readonly explanation: ExplanationRatio;
  readonly msToForecastUpdate: number | null;
}

export function financeKpis(params: {
  readonly ledger: ForecastLedger;
  readonly actuals: Actuals;
  readonly attributions: readonly DriverAttribution[];
  readonly revised: ForecastVintage | null;
}): FinanceKpis {
  return {
    accuracy: accuracyByHorizon({ ledger: params.ledger, actuals: params.actuals }),
    explanation: explanationRatio(params.attributions),
    msToForecastUpdate: timeToForecastUpdate({
      actuals: params.actuals,
      revised: params.revised,
    }),
  };
}

/**
 * Deliberately not implemented.
 *
 * **Proportion of recommendations acted on** needs a record of what the user
 * decided, and §4.3's "user decision" stage does not exist yet. Counting
 * recommendations issued and calling it adoption would measure this division's
 * output rather than its usefulness.
 *
 * **Material surprises not flagged in advance** needs cross-run history: it
 * asks whether an earlier vintage should have seen this coming, which cannot be
 * answered inside a single process. It becomes computable once memory is
 * durable (gap `A3`, Phase 10).
 */
export const UNIMPLEMENTED_KPIS = [
  'proportion of recommendations acted on — needs the user-decision stage',
  'material surprises not flagged — needs durable cross-run history (A3, Phase 10)',
] as const;
