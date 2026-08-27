/**
 * The Business & Strategy Division's data model (spec §5).
 *
 * One sentence in §5 shapes every type in this file:
 *
 *   "Business frames and analyses options; it does not price them -- that is
 *    Finance -- and it does not assert market facts without Research evidence.
 *    Its distinctive output is option sets with explicit trade-offs, not a
 *    single recommendation, because the user makes the strategic call."
 *
 * Three prohibitions, and the third is the unusual one. Every other division in
 * NEXUS converges: Research produces a synthesis, Finance produces a
 * recommendation. This one is forbidden to. An option set that collapses into
 * "do X" has taken the strategic decision away from the person whose decision
 * it is, and made it on strictly less context than they have.
 *
 * So the types make convergence hard rather than discouraged. A trade-off is a
 * required field. An option with no cost against it is not representable as a
 * complete option. There is no `recommended: boolean`.
 */
import type { Claim, ClaimId, EvidenceId } from '@nexus/core';

/** What the strategic question is about. */
export interface StrategicQuestion {
  readonly question: string;
  /**
   * The dimensions the owner cares about, in their words.
   *
   * Supplied rather than inferred: criteria are a statement of what matters to
   * whoever has to live with the decision, and a system that guesses them is
   * quietly choosing the frame the answer will be judged in.
   */
  readonly criteria: readonly string[];
  /** Named courses of action to evaluate. Business does not invent options. */
  readonly options: readonly OptionSketch[];
  /** The period Finance should price. Defaults to 'current'. */
  readonly pricingPeriod?: string;
}

/** An option as the owner stated it, before analysis. */
export interface OptionSketch {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Line items whose cost Finance should price. */
  readonly costDrivers?: readonly string[];
  /**
   * The financial starting point Finance prices against, supplied by the owner
   * and passed through **uninterpreted**.
   *
   * Typed as `unknown` on purpose. Business cannot construct a baseline
   * without inventing the numbers in it, and it cannot validate one without
   * understanding Finance's model -- either would be this division pricing,
   * which §5 forbids. So it carries the value and never reads it, and Finance
   * validates it as it validates any other request.
   */
  readonly pricingBaseline?: unknown;
  /** Market questions Research should source. */
  readonly marketQuestions?: readonly string[];
}

/**
 * A consequence of choosing an option, in one direction.
 *
 * `favourable` is deliberately not a score. Ranking consequences on a single
 * axis is how a trade-off becomes a total, and a total is a recommendation
 * wearing a table.
 */
export interface Consequence {
  readonly criterion: string;
  readonly statement: string;
  readonly favourable: boolean;
  /** Claims this rests on. A consequence with none is unsupported (§6.1). */
  readonly derivedFrom: readonly ClaimId[];
}

/**
 * A priced consequence.
 *
 * The figure never originates here. It arrives by delegation to Finance, and
 * `pricedBy` records which run produced it, so a number in a strategy document
 * can always be traced to the division that is accountable for it.
 */
export interface PricedConsequence {
  readonly driver: string;
  readonly amount: number;
  readonly period: string;
  /** The Finance run that produced this figure. Absent means unpriced. */
  readonly pricedBy?: string;
}

/**
 * One analysed option.
 *
 * Both directions are required and both are checked. An option with only
 * favourable consequences has not been analysed -- it has been advocated for,
 * and the difference is the entire value of this division.
 */
export interface StrategicOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly upsides: readonly Consequence[];
  readonly downsides: readonly Consequence[];
  readonly priced: readonly PricedConsequence[];
  /** Market facts behind this option, sourced by Research. */
  readonly supportedBy: readonly EvidenceId[];
  /**
   * What would have to be true for this to be the right choice.
   *
   * Required. An option whose preconditions are unstated cannot be argued
   * against, which makes the set undiscussable rather than decidable.
   */
  readonly assumptions: readonly string[];
  /** Named gaps: what this analysis could not establish. */
  readonly openQuestions: readonly string[];
}

/** Why an option could not be analysed. Reported, never dropped. */
export interface RejectedOption {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
}

/**
 * The division's output.
 *
 * Note what is absent: no `recommendation`, no `preferred`, no ranking. §5 is
 * explicit that the user makes the strategic call, and a field naming a winner
 * would make every other option decoration.
 */
/**
 * A delegation that was refused, rather than one that found nothing.
 *
 * "Research established no fact about this" and "the run was denied, or the
 * tree ran out of its agent-run budget" are different findings, and both
 * currently land in `unsourced`/`unpriced` -- where the first reads as a thin
 * corpus and the second is invisible. Naming the refusal keeps them apart
 * without pretending the input was established either way.
 */
export interface RefusedInput {
  /** The market question or cost driver that went unanswered. */
  readonly input: string;
  /** Which division was asked. */
  readonly division: string;
  readonly code: string;
  readonly message: string;
}

export interface OptionSet {
  readonly question: string;
  readonly criteria: readonly string[];
  readonly options: readonly StrategicOption[];
  /** Options that could not be analysed, and why. */
  readonly rejected: readonly RejectedOption[];
  /** Every claim the analysis rests on, so the set is auditable. */
  readonly claims: readonly Claim[];
  /** Market drivers Research could not source. Named, never assumed. */
  readonly unsourced: readonly string[];
  /** Cost drivers Finance could not price. Named, never estimated here. */
  readonly unpriced: readonly string[];
  /**
   * Delegations that were refused, with the reason.
   *
   * A subset of what `unsourced` and `unpriced` already name -- those stay
   * complete, because the input really was not established. This says which of
   * those gaps are the system's own doing rather than the evidence's.
   */
  readonly refusals: readonly RefusedInput[];
  readonly createdAt: string;
  /** Derived from the structure. Prose never carries a finding of its own. */
  readonly narrative: string;
}
