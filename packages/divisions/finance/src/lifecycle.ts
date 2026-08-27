/**
 * The FP&A continuous forecast lifecycle (§4.3).
 *
 *   ACTUALS -> VARIANCE -> DRIVER -> FORECAST UPDATE -> SCENARIO -> RECOMMENDATION
 *
 * Two properties are load-bearing.
 *
 * **The loop is driven by actuals landing, not by a user request.** The stage
 * that runs next is decided by what the previous stage found — a variance below
 * threshold stops the loop, and stopping is a real outcome, not a failure.
 *
 * **Each stage is a pure function over the previous stage's output.** No model,
 * no network, no clock beyond the injected one. That is what makes a forecast
 * update reproducible, which is the precondition for measuring whether it was
 * any good.
 *
 * What is NOT here: scheduling. §4.3 says the loop is driven by "events and
 * schedules"; `Scheduler` is gap A10, deferred to Phase 12. This module
 * implements the event half — a run begins when actuals arrive — and does not
 * pretend to the other.
 */
import {
  type AgentId,
  type Claim,
  type ClaimId,
  type EvidenceId,
  type Result,
  type RunId,
  createClaimValidator,
  ok,
} from '@nexus/core';
import type { ForecastLedger } from './ledger.ts';
import { analyseScenarios, updateForecast, type ScenarioSpec } from './forecast.ts';
import { attributionClaim, recommend, varianceClaim } from './recommend.ts';
import { analyseVariance, attributeDrivers, hasMaterialVariance } from './variance.ts';
import type {
  Actuals,
  DriverAttribution,
  ForecastVintage,
  MaterialityPolicy,
  Recommendation,
  ScenarioSet,
  Variance,
} from './types.ts';

export interface LifecycleParams {
  readonly actuals: Actuals;
  /** Evidence that the actuals were validated, from the retrieval tool. */
  readonly actualsEvidence: readonly EvidenceId[];
  readonly baseline: ForecastVintage;
  readonly ledger: ForecastLedger;
  readonly materiality?: MaterialityPolicy;
  /** Driver values as observed alongside the actuals. */
  readonly observed: readonly { readonly id: string; readonly value: number }[];
  readonly sensitivity: (lineItem: string, driver: string) => number | undefined;
  readonly scenarios: readonly ScenarioSpec[];
  readonly horizon: readonly string[];
  readonly runId: RunId;
  readonly actor: AgentId;
  readonly now: () => Date;
}

export interface LifecycleOutcome {
  readonly variances: readonly Variance[];
  readonly attributions: readonly DriverAttribution[];
  readonly revised: ForecastVintage | null;
  readonly scenarios: ScenarioSet | null;
  readonly recommendations: readonly Recommendation[];
  readonly claims: readonly Claim[];
  /** Which stages ran, in order. The loop's own audit trail. */
  readonly stages: readonly string[];
}

export function runLifecycle(params: LifecycleParams): Result<LifecycleOutcome> {
  const stages: string[] = [];
  const createdAt = params.now().toISOString();

  // The Core's §6.1 validator, not a Finance copy of it. Every claim this
  // division emits is checked against the same rule Research is checked
  // against -- a malformed claim is a defect here, so it fails loudly rather
  // than reaching the caller looking well-formed.
  const validator = createClaimValidator();
  const claims: Claim[] = [];

  /**
   * Validates everything this division is about to assert, then returns it.
   *
   * Every exit from the lifecycle goes through here, so there is no path that
   * emits an unvalidated claim. A malformed claim is a defect in this division
   * rather than a condition the caller can handle, so it surfaces as an error
   * instead of reaching them looking well-formed.
   */
  const finish = (outcome: Omit<LifecycleOutcome, 'claims' | 'stages'>): Result<LifecycleOutcome> => {
    for (const claim of claims) {
      const valid = validator.validate(claim);
      if (!valid.ok) return valid;
    }
    return ok({ ...outcome, claims, stages });
  };

  // --- stage 2: variance analysis (actuals validated) ----------------------
  stages.push('variance');
  const variances = analyseVariance({
    actuals: params.actuals,
    baseline: params.baseline,
    ...(params.materiality !== undefined ? { policy: params.materiality } : {}),
  });

  const material = variances.filter((v) => v.material);
  for (const variance of material) {
    claims.push(
      varianceClaim({
        variance,
        supportedBy: params.actualsEvidence,
        runId: params.runId,
        createdAt,
      }),
    );
  }

  if (!hasMaterialVariance(variances)) {
    // Nothing material happened. The forecast stands, and saying so is the
    // correct answer -- revising on noise is how a forecast loses its meaning.
    return finish({
      variances,
      attributions: [],
      revised: null,
      scenarios: null,
      recommendations: [],
    });
  }

  // --- stage 3: driver analysis (variance material) ------------------------
  stages.push('drivers');
  const attributions = material.map((variance) =>
    attributeDrivers({
      variance,
      baseline: params.baseline,
      observed: params.observed,
      sensitivity: params.sensitivity,
    }),
  );

  const attributionIds: ClaimId[] = [];
  for (const attribution of attributions) {
    const from = claims
      .filter(
        (c) => c.status === 'fact' && c.subject === `${attribution.lineItem}:${attribution.period}`,
      )
      .map((c) => c.id);
    const claim = attributionClaim({ attribution, from, runId: params.runId, createdAt });
    claims.push(claim);
    attributionIds.push(claim.id);
  }

  // --- stage 4: forecast update (driver change) ----------------------------
  stages.push('forecast');
  const revised = updateForecast({
    ledger: params.ledger,
    baseline: params.baseline,
    observed: params.observed,
    attributions,
    reason: `actuals for ${params.actuals.period}: ${material.length} material variance(s)`,
    createdBy: params.actor,
    runId: params.runId,
    now: params.now,
    sensitivity: params.sensitivity,
    horizon: params.horizon,
  });

  if (!revised.ok) {
    // A material variance no driver movement explains. The forecast is NOT
    // revised -- there is nothing to revise it with -- and the unexplained
    // variance stands in the record as its own finding.
    return finish({
      variances,
      attributions,
      revised: null,
      scenarios: null,
      recommendations: [],
    });
  }

  // --- stage 5: scenario analysis (forecast updated) -----------------------
  if (params.scenarios.length === 0) {
    return finish({
      variances,
      attributions,
      revised: revised.value,
      scenarios: null,
      recommendations: [],
    });
  }

  stages.push('scenarios');
  const scenarios = analyseScenarios({
    vintage: revised.value,
    specs: params.scenarios,
    sensitivity: params.sensitivity,
    now: params.now,
  });
  if (!scenarios.ok) return scenarios;

  // --- stage 6: recommendation (material change) ---------------------------
  stages.push('recommendation');
  const recommendations: Recommendation[] = [];
  const lineItems = [...new Set(material.map((v) => v.lineItem))].sort();

  for (const lineItem of lineItems) {
    const built = recommend({
      scenarios: scenarios.value,
      vintage: revised.value,
      derivedFrom: attributionIds,
      runId: params.runId,
      createdBy: params.actor,
      createdAt,
      lineItem,
    });
    // A line item the scenario set says nothing about yields no recommendation
    // rather than a generic one. Silence is better than filler.
    if (built.ok) {
      recommendations.push(built.value);
      claims.push(built.value.claim);
    }
  }

  return finish({
    variances,
    attributions,
    revised: revised.value,
    scenarios: scenarios.value,
    recommendations,
  });
}
