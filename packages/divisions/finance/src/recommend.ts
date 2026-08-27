/**
 * The CFO recommendation (§4.3, stage 6).
 *
 * A recommendation is a `Claim` with `status: 'recommendation'`, which is not a
 * convenience: §6.1 already requires that such a claim name what it derives
 * from AND the assumptions it rests on, and `ClaimValidator` enforces both.
 * Phase 6's test requirement — "recommendations carry their scenario basis" —
 * is therefore satisfied structurally rather than by a field somebody might
 * forget to populate.
 *
 * The consequence worth stating: this division cannot emit a recommendation
 * without also emitting the variance and driver claims it derives from. There
 * is no path here that produces advice with nothing behind it.
 */
import {
  type AgentId,
  type Claim,
  type ClaimId,
  type Result,
  type RunId,
  claimId,
  err,
  nexusError,
  ok,
} from '@nexus/core';
import type {
  DriverAttribution,
  ForecastVintage,
  Recommendation,
  ScenarioSet,
  Variance,
} from './types.ts';

/** Turns a material variance into a stated fact about the numbers. */
export function varianceClaim(params: {
  readonly variance: Variance;
  readonly runId: RunId;
  readonly createdAt: string;
}): Claim {
  const { variance } = params;
  const direction = variance.delta >= 0 ? 'above' : 'below';
  return {
    id: claimId(`cl_${params.runId}_var_${variance.lineItem}_${variance.period}`),
    statement:
      `${variance.lineItem} for ${variance.period} came in ${Math.abs(variance.delta)} ` +
      `${direction} forecast (${variance.actual} actual vs ${variance.forecast} forecast).`,
    // A variance is arithmetic over two numbers this system holds. It is a
    // fact about the ledger, which is a narrower claim than a fact about the
    // world -- and it is the only one the arithmetic supports.
    status: 'fact',
    subject: `${variance.lineItem}:${variance.period}`,
    supportedBy: [],
    contradictedBy: [],
    derivedFrom: [],
    assumptions: [],
    confidence: 1,
    runId: params.runId,
    createdAt: params.createdAt,
  };
}

/**
 * Turns a driver attribution into an inference.
 *
 * An inference, never a fact: attribution rests on the owner's sensitivity
 * model, and a model's output is derived knowledge no matter how confidently
 * it is expressed. `unexplained` is stated rather than smoothed away.
 */
export function attributionClaim(params: {
  readonly attribution: DriverAttribution;
  readonly from: readonly ClaimId[];
  readonly runId: RunId;
  readonly createdAt: string;
}): Claim {
  const { attribution } = params;
  const explained = attribution.total - attribution.unexplained;
  const share = attribution.total === 0 ? 0 : Math.abs(explained / attribution.total);
  const top = [...attribution.contributions].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  const statement =
    top.length === 0
      ? `No modelled driver explains the ${attribution.lineItem} variance for ${attribution.period}; ` +
        `${attribution.unexplained} is unexplained.`
      : `${top.map((c) => `${c.driver} (${c.amount})`).join(', ')} explain ${explained} of the ` +
        `${attribution.total} ${attribution.lineItem} variance for ${attribution.period}; ` +
        `${attribution.unexplained} is unexplained.`;

  return {
    id: claimId(`cl_${params.runId}_attr_${attribution.lineItem}_${attribution.period}`),
    statement,
    status: 'inference',
    subject: `${attribution.lineItem}:${attribution.period}`,
    supportedBy: [],
    contradictedBy: [],
    derivedFrom: params.from,
    assumptions: [],
    // Confidence tracks how much the drivers actually explain. A bridge that
    // explains a tenth of the movement should not sound as sure as one that
    // explains all of it.
    confidence: Number(Math.max(0, Math.min(1, share)).toFixed(3)),
    runId: params.runId,
    createdAt: params.createdAt,
  };
}

export interface RecommendParams {
  readonly scenarios: ScenarioSet;
  readonly vintage: ForecastVintage;
  readonly derivedFrom: readonly ClaimId[];
  readonly runId: RunId;
  readonly createdBy: AgentId;
  readonly createdAt: string;
  /** Line item the recommendation is about. */
  readonly lineItem: string;
}

/**
 * Builds a recommendation whose basis is inseparable from it.
 *
 * Refuses when there is nothing to derive from. An unsupported recommendation
 * would fail `ClaimValidator` downstream anyway; failing here says why.
 */
export function recommend(params: RecommendParams): Result<Recommendation> {
  if (params.derivedFrom.length === 0) {
    return err(
      nexusError('INVALID_INPUT', 'a recommendation must derive from at least one claim', {
        details: { lineItem: params.lineItem },
      }),
    );
  }
  if (params.scenarios.paths.length === 0) {
    return err(nexusError('INVALID_INPUT', 'a recommendation needs a scenario basis'));
  }

  const relevant = params.scenarios.expected.filter((a) => a.lineItem === params.lineItem);
  if (relevant.length === 0) {
    return err(
      nexusError('NOT_FOUND', `the scenario set says nothing about '${params.lineItem}'`, {
        details: { lineItem: params.lineItem },
      }),
    );
  }

  const worst = [...params.scenarios.paths].sort((a, b) => {
    const sum = (path: (typeof params.scenarios.paths)[number]) =>
      path.amounts.filter((x) => x.lineItem === params.lineItem).reduce((t, x) => t + x.value, 0);
    return sum(a) - sum(b);
  })[0];

  const expectedTotal = relevant.reduce((sum, a) => sum + a.value, 0);
  const spread = params.scenarios.paths.length;

  // Every assumption the recommendation rests on, named. This list is what
  // §6.1 requires and what makes the advice checkable rather than merely
  // confident.
  const assumptions = [
    `scenario set '${params.scenarios.basedOnVintage}' with ${spread} weighted path(s)`,
    ...params.scenarios.paths.map((p) => `${p.label} at probability ${p.probability}`),
    ...params.vintage.drivers.map((d) => `${d.displayName} = ${d.value} (${d.basis})`),
  ];

  const claim: Claim = {
    id: claimId(`cl_${params.runId}_rec_${params.lineItem}`),
    statement:
      `Plan ${params.lineItem} against a probability-weighted ${expectedTotal.toFixed(2)}, ` +
      `and hold capacity for the '${worst?.label ?? 'downside'}' path.`,
    status: 'recommendation',
    subject: params.lineItem,
    supportedBy: [],
    contradictedBy: [],
    derivedFrom: params.derivedFrom,
    assumptions,
    confidence: params.vintage.confidence,
    runId: params.runId,
    createdAt: params.createdAt,
  };

  return ok({ claim, scenarioBasis: params.scenarios.basedOnVintage, vintage: params.vintage.id });
}
