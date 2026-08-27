/**
 * Claims -- typed knowledge (spec §6.1, §19.1).
 *
 * A Claim is what Research produces instead of prose. Prose is derived from
 * claims; claims are never derived from prose. That inversion is the whole
 * point: it makes "which part of this is actually a fact" a structural question
 * rather than a question about wording.
 *
 * ## Two axes, deliberately not one
 *
 * `ClaimStatus` answers *what kind of assertion is this* -- fact, inference,
 * recommendation, uncertain. `VerificationStatus` (contracts/evidence.ts)
 * answers a different question: *what does the available evidence say about it*
 * -- verified, contradicted, insufficient, unverified.
 *
 * These are independent. Evidence can directly and strongly support a claim
 * that is nonetheless an inference; "inferred" is a property of how the claim
 * was arrived at, not of how well it is evidenced. Collapsing the two into one
 * enum would make "this is a well-supported inference" inexpressible.
 *
 * ## Evidence is referenced, never duplicated
 *
 * `Evidence.claim` stays exactly what it has always been -- the collector's own
 * note about what an excerpt speaks to, recorded at collection time. A Claim is
 * the division's structured assertion, citing that evidence by id. Nothing in
 * contracts/evidence.ts changes.
 */
import type { Result } from '../result.ts';
import type { ClaimId, ContradictionId, EvidenceId, RunId } from '../ids.ts';

/** Spec §6.1. Mandatory on every Research output. */
export type ClaimStatus = 'fact' | 'inference' | 'recommendation' | 'uncertain';

export interface Claim {
  readonly id: ClaimId;
  /** One self-contained assertion. Not a paragraph. */
  readonly statement: string;
  readonly status: ClaimStatus;
  /**
   * Stable key for what this claim is ABOUT. Two claims sharing a subject are
   * the candidates for contradiction detection; without it, conflict detection
   * would have to infer aboutness from free text.
   *
   * Known limitation: two claims about the same thing under differently-worded
   * subjects will not be compared. Subject normalisation is deliberately out of
   * scope here rather than approximated.
   */
  readonly subject: string;
  /**
   * Evidence supporting this claim. A `fact` with none of these is a defect,
   * not a stylistic issue (§6.1).
   */
  readonly supportedBy: readonly EvidenceId[];
  /** Conflicting evidence. Never dropped and never averaged away (§6.1). */
  readonly contradictedBy: readonly EvidenceId[];
  /** Required for `inference` and `recommendation`: what this derives from. */
  readonly derivedFrom: readonly ClaimId[];
  /** Required for `recommendation`: the assumptions it rests on (§6.1). */
  readonly assumptions: readonly string[];
  /** Required for `uncertain`: what is missing or conflicting (§6.1). */
  readonly uncertaintyReason?: string;
  /** 0..1. Explicit, never implied by tone. */
  readonly confidence: number;
  /** Traces the claim back to the run that produced it. */
  readonly runId: RunId;
  readonly createdAt: string;
}

/**
 * A recorded conflict between claims about one subject.
 *
 * Recorded, never resolved by merging (§6.1, §19.2). A contradiction that
 * disappears into an averaged confidence score is the failure this type exists
 * to prevent.
 */
export interface Contradiction {
  readonly id: ContradictionId;
  readonly subject: string;
  /** At least two claims that cannot all hold. */
  readonly claims: readonly ClaimId[];
  /** Why they conflict, in terms a reader can check. */
  readonly reason: string;
  readonly detectedAt: string;
}

/**
 * Enforces §6.1 structurally.
 *
 * "A FACT without evidence is a defect" is only true if something checks, and a
 * rule enforced by convention is a rule that will eventually be broken by a
 * model under pressure to produce a confident answer.
 */
export interface ClaimValidator {
  validate(claim: Claim): Result<void>;
}
