/**
 * Variance analysis and driver attribution (§4.3, stages 2 and 3).
 *
 * Both are deterministic arithmetic over numbers that already exist. No model
 * is consulted, which is not a limitation but the requirement: §4.3 says
 * materiality thresholds are *configuration*, and a model deciding what counts
 * as material would be a model deciding what the owner gets told about.
 */
import type {
  Actuals,
  DriverAttribution,
  ForecastVintage,
  MaterialityPolicy,
  Variance,
} from './types.ts';

/** Conservative until the owner says otherwise: 5% or 1000, whichever trips first. */
export const DEFAULT_MATERIALITY: MaterialityPolicy = { absolute: 1_000, relative: 0.05 };

/**
 * Compares actuals against the vintage that forecast them.
 *
 * Line items present in one side and not the other are reported, not skipped:
 * a line that was forecast and never materialised is exactly the kind of
 * variance a silent inner join would hide.
 */
export function analyseVariance(params: {
  readonly actuals: Actuals;
  readonly baseline: ForecastVintage;
  readonly policy?: MaterialityPolicy;
}): readonly Variance[] {
  const policy = params.policy ?? DEFAULT_MATERIALITY;
  const period = params.actuals.period;

  const forecastFor = new Map<string, number>();
  for (const amount of params.baseline.amounts) {
    if (amount.period === period) forecastFor.set(amount.lineItem, amount.value);
  }

  const actualFor = new Map<string, number>();
  for (const amount of params.actuals.amounts) {
    if (amount.period === period) actualFor.set(amount.lineItem, amount.value);
  }

  const lineItems = [...new Set([...forecastFor.keys(), ...actualFor.keys()])].sort();

  return lineItems.map((lineItem) => {
    const forecast = forecastFor.get(lineItem) ?? 0;
    const actual = actualFor.get(lineItem) ?? 0;
    const delta = actual - forecast;
    // A zero forecast makes the ratio undefined rather than infinite. Reporting
    // Infinity here would make every new line item look catastrophic.
    const relative = forecast === 0 ? null : delta / Math.abs(forecast);

    const byAbsolute = Math.abs(delta) >= policy.absolute;
    const byRelative = relative !== null && Math.abs(relative) >= policy.relative;
    const missingForecast = !forecastFor.has(lineItem);
    const missingActual = !actualFor.has(lineItem);

    let reason: string;
    if (missingForecast) reason = 'line item was not forecast for this period';
    else if (missingActual) reason = 'line item was forecast but no actual arrived';
    else if (byAbsolute && byRelative) reason = `|${delta}| >= ${policy.absolute} and ${(Math.abs(relative as number) * 100).toFixed(1)}% >= ${(policy.relative * 100).toFixed(1)}%`;
    else if (byAbsolute) reason = `|${delta}| >= absolute threshold ${policy.absolute}`;
    else if (byRelative) reason = `${(Math.abs(relative as number) * 100).toFixed(1)}% >= relative threshold ${(policy.relative * 100).toFixed(1)}%`;
    else reason = 'within both thresholds';

    return {
      lineItem,
      period,
      forecast,
      actual,
      delta,
      relative,
      // A line item that appeared or vanished is material regardless of size:
      // its absence is the finding.
      material: byAbsolute || byRelative || missingForecast || missingActual,
      reason,
    };
  });
}

/**
 * Attributes a variance to the drivers whose values moved (§4.3, stage 3).
 *
 * The method is the standard bridge: hold every driver but one at its baseline
 * value, and the amount the forecast moves is that driver's contribution. What
 * is left over after all drivers are accounted for is `unexplained`.
 *
 * **The residual is deliberately not distributed.** A bridge that always sums
 * to the total by construction reports perfect explanation regardless of
 * whether the drivers explain anything, and §4.2 asks specifically for
 * "variance explained versus unexplained". Hiding the residual would delete the
 * metric.
 */
export function attributeDrivers(params: {
  readonly variance: Variance;
  readonly baseline: ForecastVintage;
  readonly observed: readonly { readonly id: string; readonly value: number }[];
  /**
   * How the forecast amount responds to a driver. Supplied by the caller
   * because it is a property of the owner's model, not of this function.
   * Absent means the driver is not known to affect this line item.
   */
  readonly sensitivity: (lineItem: string, driver: string) => number | undefined;
}): DriverAttribution {
  const baselineValue = new Map(params.baseline.drivers.map((d) => [d.id, d.value]));
  const basisOf = new Map(params.baseline.drivers.map((d) => [d.id, d.basis]));

  const contributions: { driver: string; amount: number; basis: string }[] = [];
  let explained = 0;

  for (const observed of params.observed) {
    const before = baselineValue.get(observed.id);
    if (before === undefined) continue; // a driver the baseline never had
    const sensitivity = params.sensitivity(params.variance.lineItem, observed.id);
    if (sensitivity === undefined) continue;

    const movement = observed.value - before;
    if (movement === 0) continue;

    const amount = movement * sensitivity;
    explained += amount;
    contributions.push({
      driver: observed.id,
      amount,
      basis: `${basisOf.get(observed.id) ?? 'no stated basis'}; moved ${before} -> ${observed.value}`,
    });
  }

  return {
    lineItem: params.variance.lineItem,
    period: params.variance.period,
    total: params.variance.delta,
    contributions,
    unexplained: params.variance.delta - explained,
  };
}

/** Whether anything material happened — the §4.3 trigger for a forecast update. */
export function hasMaterialVariance(variances: readonly Variance[]): boolean {
  return variances.some((v) => v.material);
}
