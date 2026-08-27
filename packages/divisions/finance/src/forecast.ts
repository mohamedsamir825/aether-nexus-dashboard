/**
 * Forecast update and scenario analysis (§4.3, stages 4 and 5).
 *
 * A forecast update produces a new vintage; it never edits the old one. That is
 * enforced by the ledger rather than by convention here — this module builds
 * the candidate and hands it over to be accepted or refused.
 */
import { type AgentId, type Result, type RunId, err, nexusError, ok } from '@nexus/core';
import { type ForecastLedger, nextVintage } from './ledger.ts';
import type {
  Amount,
  Driver,
  DriverAttribution,
  ForecastVintage,
  ScenarioPath,
  ScenarioSet,
} from './types.ts';

export interface UpdateForecastParams {
  readonly ledger: ForecastLedger;
  readonly baseline: ForecastVintage;
  /** Driver values as now observed. Only movements produce a change. */
  readonly observed: readonly { readonly id: string; readonly value: number }[];
  readonly attributions: readonly DriverAttribution[];
  readonly reason: string;
  readonly createdBy: AgentId;
  readonly runId: RunId;
  readonly now: () => Date;
  readonly sensitivity: (lineItem: string, driver: string) => number | undefined;
  /** Periods still open to revision. A closed period's actuals are not forecast. */
  readonly horizon: readonly string[];
}

/**
 * Rolls driver movements forward into every open period.
 *
 * Confidence falls when a revision was forced by variance the drivers could not
 * explain. A forecast revised for reasons the model does not understand is
 * genuinely less trustworthy than one revised for reasons it does, and saying
 * so is cheaper than discovering it later.
 */
export function updateForecast(params: UpdateForecastParams): Result<ForecastVintage> {
  const movements: { id: string; from: number; to: number }[] = [];
  const drivers: Driver[] = params.baseline.drivers.map((driver) => {
    const observed = params.observed.find((o) => o.id === driver.id);
    if (observed === undefined || observed.value === driver.value) return driver;
    movements.push({ id: driver.id, from: driver.value, to: observed.value });
    return { ...driver, value: observed.value, basis: `${driver.basis}; revised from actuals` };
  });

  if (movements.length === 0) {
    return err(
      nexusError('INVALID_INPUT', 'no driver moved, so there is nothing to revise', {
        details: { baseline: params.baseline.id },
      }),
    );
  }

  const openPeriods = new Set(params.horizon);
  const amounts: Amount[] = params.baseline.amounts.map((amount) => {
    if (!openPeriods.has(amount.period)) return amount;

    let value = amount.value;
    for (const movement of movements) {
      const sensitivity = params.sensitivity(amount.lineItem, movement.id);
      if (sensitivity === undefined) continue;
      value += (movement.to - movement.from) * sensitivity;
    }
    return value === amount.value ? amount : { ...amount, value, origin: 'forecast' as const };
  });

  const totalVariance = params.attributions.reduce((sum, a) => sum + Math.abs(a.total), 0);
  const totalUnexplained = params.attributions.reduce((sum, a) => sum + Math.abs(a.unexplained), 0);
  const unexplainedShare = totalVariance === 0 ? 0 : totalUnexplained / totalVariance;
  const confidence = Number(
    Math.max(0, Math.min(1, params.baseline.confidence * (1 - unexplainedShare))).toFixed(3),
  );

  const candidate = nextVintage(params.ledger, {
    id: `fv_${params.runId}_${(params.ledger.head()?.version ?? 0) + 1}`,
    createdAt: params.now().toISOString(),
    createdBy: params.createdBy,
    runId: params.runId,
    reason: params.reason,
    drivers,
    amounts,
    confidence,
  });

  // The ledger is the authority on whether this may be appended. Bypassing it
  // to "just store the vintage" is how an audit chain quietly stops being one.
  return params.ledger.append(candidate);
}

export interface ScenarioSpec {
  readonly id: string;
  readonly label: string;
  readonly probability: number;
  /** Driver overrides that define this path. */
  readonly drivers: readonly { readonly id: string; readonly value: number }[];
}

/**
 * Builds weighted paths from a vintage (§4.3, stage 5).
 *
 * Probabilities must be supplied and must sum to 1. They are not inferred:
 * a probability this system invented would be a number with no owner, and
 * every downstream weighting would inherit its authority without its evidence.
 */
export function analyseScenarios(params: {
  readonly vintage: ForecastVintage;
  readonly specs: readonly ScenarioSpec[];
  readonly sensitivity: (lineItem: string, driver: string) => number | undefined;
  readonly now: () => Date;
}): Result<ScenarioSet> {
  if (params.specs.length === 0) {
    return err(nexusError('INVALID_INPUT', 'a scenario set needs at least one path'));
  }

  const total = params.specs.reduce((sum, s) => sum + s.probability, 0);
  if (Math.abs(total - 1) > 1e-6) {
    return err(
      nexusError('INVALID_INPUT', `scenario probabilities sum to ${total}, not 1`, {
        details: { total },
      }),
    );
  }
  if (params.specs.some((s) => s.probability < 0 || s.probability > 1)) {
    return err(nexusError('INVALID_INPUT', 'each scenario probability must be between 0 and 1'));
  }

  const baseDrivers = new Map(params.vintage.drivers.map((d) => [d.id, d]));

  const paths: ScenarioPath[] = params.specs.map((spec) => {
    const drivers: Driver[] = params.vintage.drivers.map((driver) => {
      const override = spec.drivers.find((d) => d.id === driver.id);
      return override === undefined
        ? driver
        : { ...driver, value: override.value, basis: `${driver.basis}; scenario '${spec.label}'` };
    });

    const amounts: Amount[] = params.vintage.amounts.map((amount) => {
      let value = amount.value;
      for (const override of spec.drivers) {
        const base = baseDrivers.get(override.id);
        if (base === undefined) continue;
        const sensitivity = params.sensitivity(amount.lineItem, override.id);
        if (sensitivity === undefined) continue;
        value += (override.value - base.value) * sensitivity;
      }
      return { ...amount, value, origin: 'forecast' as const };
    });

    return { id: spec.id, label: spec.label, probability: spec.probability, drivers, amounts };
  });

  // Probability-weighted expectation, per line item and period.
  const weighted = new Map<string, Amount>();
  for (const path of paths) {
    for (const amount of path.amounts) {
      const key = `${amount.lineItem}|${amount.period}`;
      const existing = weighted.get(key);
      const contribution = amount.value * path.probability;
      weighted.set(
        key,
        existing === undefined
          ? { ...amount, value: contribution, origin: 'derived' }
          : { ...existing, value: existing.value + contribution },
      );
    }
  }

  const expected = [...weighted.values()]
    .map((amount) => ({ ...amount, value: Number(amount.value.toFixed(6)) }))
    .sort((a, b) => a.lineItem.localeCompare(b.lineItem) || a.period.localeCompare(b.period));

  return ok({
    basedOnVintage: params.vintage.id,
    paths,
    expected,
    createdAt: params.now().toISOString(),
  });
}
