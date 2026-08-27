/**
 * The Finance Division's data model (spec §4).
 *
 * Two rules shape everything here.
 *
 * **A forecast is a position, not a document.** Spec §4.3: "FP&A must not
 * produce static forecasts. A forecast is a living position carrying its
 * assumptions, drivers, vintage and confidence." So a forecast is an immutable
 * vintage in a chain, never a mutable record — see `ledger.ts`.
 *
 * **Materiality is configuration, not judgement.** §4.3 again: variance
 * thresholds are set by the owner, in advance. A model deciding what counts as
 * material would be a model deciding what the owner gets told about.
 */
import type { AgentId, Claim, EvidenceId, RunId } from '@nexus/core';
import type { FinanceKpis } from './kpi.ts';

/**
 * An accounting period, as an ordered label.
 *
 * Deliberately a string like `2026-Q1` or `2026-03` rather than a date range:
 * periods are compared for identity and sorted lexically, and inventing a
 * calendar here would be a second, worse date library.
 */
export type PeriodId = string;

/** What is being measured. `revenue`, `cogs`, `opex` — the owner's chart. */
export type LineItemId = string;

/** Where a number came from. Fabricated numbers are the failure mode. */
export type NumberOrigin =
  | 'actual' // observed and validated
  | 'forecast' // projected
  | 'budget' // committed plan
  | 'derived'; // computed from other numbers in this system

export interface Amount {
  readonly lineItem: LineItemId;
  readonly period: PeriodId;
  readonly value: number;
  readonly origin: NumberOrigin;
  /**
   * Where this number came from outside NEXUS, when it came from outside.
   * A market input delegated to Research arrives with evidence; a number with
   * no evidence and no origin is not admissible as an actual.
   */
  readonly evidence?: readonly EvidenceId[];
}

/** Validated period actuals — the Controller's output (§4.3). */
export interface Actuals {
  readonly period: PeriodId;
  readonly amounts: readonly Amount[];
  /** When the Controller validated them, not when they were generated. */
  readonly validatedAt: string;
  readonly validatedBy: AgentId;
}

/**
 * A causal input to the forecast. Drivers are what a forecast is *about*:
 * "units sold", "average price", "churn". Changing a driver is what makes a new
 * vintage meaningful rather than a re-typed number.
 */
export interface Driver {
  readonly id: string;
  readonly displayName: string;
  readonly value: number;
  /** Free text, but required: an assumption nobody wrote down is not one. */
  readonly basis: string;
  /**
   * Evidence behind the basis, when the driver was sourced rather than assumed.
   *
   * §4.3 requires market inputs to arrive by delegation to Research carrying
   * evidence. A market driver that ends up with none is a defect, and
   * `unsourcedMarketDrivers` on the result names it rather than letting an
   * unsupported number sit indistinguishably beside sourced ones.
   */
  readonly evidence?: readonly EvidenceId[];
}

/**
 * A driver whose context comes from outside Finance (§4.3).
 *
 * Note what this does NOT do: it never lets Research's prose set the number.
 * Extracting a value from a sentence is the fabrication this project keeps
 * refusing -- the owner supplies the figure, and delegation supplies the
 * sourced basis and the evidence that stands behind it.
 */
export interface MarketInput {
  /** The driver this research is about. */
  readonly driver: string;
  readonly question: string;
  readonly subjects: readonly string[];
}

/**
 * An immutable forecast vintage (§4.3).
 *
 * "Superseded, never overwritten, so accuracy can be measured retrospectively."
 * `supersedes` makes the chain walkable in both directions from any point.
 */
export interface ForecastVintage {
  readonly id: string;
  /** Monotonic within a ledger. Vintage 1 has no predecessor. */
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: AgentId;
  readonly runId: RunId;
  /** The vintage this replaces, or null for the first. */
  readonly supersedes: string | null;
  /** Why this vintage exists. A vintage with no reason is a lost audit trail. */
  readonly reason: string;
  readonly drivers: readonly Driver[];
  readonly amounts: readonly Amount[];
  /** 0..1, explicit rather than implied by tone. */
  readonly confidence: number;
}

/** How a variance is judged, set by the owner in advance (§4.3). */
export interface MaterialityPolicy {
  /** Absolute threshold in the ledger's units. */
  readonly absolute: number;
  /** Relative threshold, 0..1. Either one crossing makes it material. */
  readonly relative: number;
}

export interface Variance {
  readonly lineItem: LineItemId;
  readonly period: PeriodId;
  readonly forecast: number;
  readonly actual: number;
  /** actual − forecast. Positive means actual came in above forecast. */
  readonly delta: number;
  /** delta / |forecast|, or null when forecast is zero and the ratio is undefined. */
  readonly relative: number | null;
  readonly material: boolean;
  /** Which rule made it material, for a reader who wants to check. */
  readonly reason: string;
}

/**
 * How much of a variance each driver explains.
 *
 * `unexplained` is the point of this type. A bridge that always sums to the
 * total by construction hides model error; leaving the residual visible is
 * what makes "variance explained versus unexplained" (§4.2) measurable.
 */
export interface DriverAttribution {
  readonly lineItem: LineItemId;
  readonly period: PeriodId;
  readonly total: number;
  readonly contributions: readonly {
    readonly driver: string;
    readonly amount: number;
    readonly basis: string;
  }[];
  readonly unexplained: number;
}

export interface ScenarioPath {
  readonly id: string;
  readonly label: string;
  /** 0..1. The set is normalised and must sum to 1 within tolerance. */
  readonly probability: number;
  readonly drivers: readonly Driver[];
  readonly amounts: readonly Amount[];
}

export interface ScenarioSet {
  readonly basedOnVintage: string;
  readonly paths: readonly ScenarioPath[];
  /** Probability-weighted expectation per line item. */
  readonly expected: readonly Amount[];
  readonly createdAt: string;
}

/**
 * A CFO recommendation.
 *
 * It carries a `Claim` rather than prose because §6.1 already settled how an
 * assertion states its own epistemic footing: a recommendation must name what
 * it derives from and the assumptions it rests on, and `ClaimValidator`
 * enforces that. Reinventing it here would create a second, weaker standard.
 */
export interface Recommendation {
  readonly claim: Claim;
  /** The scenario set this rests on — "recommendations carry their scenario basis". */
  readonly scenarioBasis: string;
  readonly vintage: string;
}

/** What the division is asked to do. */
export interface FinanceRequest {
  readonly question: string;
  /** Actuals that have just landed, which is what drives the loop (§4.3). */
  readonly actuals: Actuals;
  /** The forecast those actuals are measured against. */
  readonly baseline: ForecastVintage;
  readonly materiality?: MaterialityPolicy;
  /** Drivers whose basis should be sourced from Research before analysis. */
  readonly marketInputs?: readonly MarketInput[];
}

export interface FinanceResult {
  readonly request: FinanceRequest;
  readonly variances: readonly Variance[];
  readonly attributions: readonly DriverAttribution[];
  /** The new vintage, when drivers changed. Null when nothing was material. */
  readonly revised: ForecastVintage | null;
  readonly scenarios: ScenarioSet | null;
  readonly recommendations: readonly Recommendation[];
  /** Every vintage in the chain, oldest first. History is never discarded. */
  readonly vintages: readonly ForecastVintage[];
  /** §4.2, measured rather than asserted. See `kpi.ts` for what is absent. */
  readonly kpis: FinanceKpis;
  /**
   * Market drivers that were asked about and came back with no evidence.
   *
   * Named rather than silently tolerated: §4.3 says market inputs carry
   * evidence, so one that does not is a finding the reader needs, not a
   * detail to smooth over.
   */
  readonly unsourcedMarketDrivers: readonly string[];
  /** Whether a new vintage was written to durable memory for the next run. */
  readonly persisted: boolean;
  readonly narrative: string;
}
