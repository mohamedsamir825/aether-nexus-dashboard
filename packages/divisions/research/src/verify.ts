/**
 * Verification: what does the available evidence say about a claim?
 *
 * This answers a different question from `ClaimStatus` (ADR 0013). A claim can
 * be an inference AND be verified; it can be a fact AND be contradicted. The
 * two axes are independent and this module only moves the second one.
 *
 * Mapping to the four states the phase brief asked for:
 *   directly supported -> 'verified'
 *   inferred           -> not a verification outcome; it is Claim.status
 *   contradicted       -> 'contradicted'
 *   uncertain          -> 'insufficient' (weighed, not enough)
 *                         'unverified'   (nothing to weigh yet)
 *
 * ## Why the verifier is handed the evidence
 *
 * §19.1 puts a confidence on the verification itself, and a confidence that is
 * not derived from the evidence is a number with no meaning. So the evidence is
 * a required input rather than an optional convenience: a verifier that cannot
 * see what it is weighing has no business scoring how well it is settled.
 */
import {
  type Claim,
  type Evidence,
  type EvidenceId,
  type Result,
  type VerificationResult,
  type Verifier,
  ok,
} from '@nexus/core';

export interface CreateVerifierOptions {
  readonly now: () => Date;
  /** Every piece of evidence the claims under verification may cite. */
  readonly evidence: readonly Evidence[];
  /** Supporting evidence needed before a claim counts as verified. */
  readonly minSupporting?: number;
}

/** Mean confidence of the evidence actually found, plus what went missing. */
interface Weighed {
  readonly strength: number;
  readonly unresolved: number;
}

function weigh(ids: readonly EvidenceId[], index: ReadonlyMap<EvidenceId, Evidence>): Weighed {
  let total = 0;
  let found = 0;
  for (const id of ids) {
    const evidence = index.get(id);
    if (evidence === undefined) continue;
    total += evidence.confidence;
    found += 1;
  }
  return { strength: found === 0 ? 0 : total / found, unresolved: ids.length - found };
}

/**
 * Deterministic verifier over evidence already attached to a claim.
 *
 * It does not re-read source text and it consults no model, so it cannot
 * invent support that is not there. Its limitation is the mirror of that
 * strength: it judges only what extraction already found.
 */
export function createClaimVerifier(options: CreateVerifierOptions) {
  const minSupporting = options.minSupporting ?? 1;
  const index = new Map<EvidenceId, Evidence>(options.evidence.map((e) => [e.id, e]));

  const verifyClaim = (claim: Claim): VerificationResult => {
    const checkedAt = options.now().toISOString();
    const supporting = [...claim.supportedBy];
    const conflicting = [...claim.contradictedBy];

    const support = weigh(supporting, index);
    const conflict = weigh(conflicting, index);

    // Verification is capped by the claim it verifies -- weighing evidence can
    // lower confidence in an assertion, never raise it above what the assertion
    // itself claimed.
    const settled = Math.min(claim.confidence, support.strength);

    // Conflict reduces what is settled rather than being netted against it: the
    // supporting evidence is still reported, it just no longer settles anything
    // on its own (§19.2).
    const confidence = settled * (1 - conflict.strength);

    // An unresolvable id means the caller weighed an incomplete evidence set.
    // Say so rather than letting a silently deflated score look like a finding.
    const missing = support.unresolved + conflict.unresolved;
    const note = missing > 0 ? ` (${missing} cited piece(s) of evidence were not available to weigh)` : '';

    if (conflicting.length > 0) {
      return {
        claim: claim.statement,
        status: 'contradicted',
        supporting,
        conflicting,
        rationale:
          `${conflicting.length} piece(s) of evidence conflict with this claim` +
          (supporting.length > 0 ? `, against ${supporting.length} supporting` : '') +
          note,
        confidence,
        checkedAt,
      };
    }

    if (supporting.length >= minSupporting) {
      return {
        claim: claim.statement,
        status: 'verified',
        supporting,
        conflicting,
        rationale: `${supporting.length} piece(s) of evidence support this claim` + note,
        confidence,
        checkedAt,
      };
    }

    // An `uncertain` claim was already weighed and found wanting; anything else
    // with no evidence simply has not been checked. Both are zero, for the same
    // reason: nothing was weighed that could settle anything.
    if (claim.status === 'uncertain') {
      return {
        claim: claim.statement,
        status: 'insufficient',
        supporting,
        conflicting,
        rationale: claim.uncertaintyReason ?? 'insufficient evidence to establish confidence',
        confidence: 0,
        checkedAt,
      };
    }

    return {
      claim: claim.statement,
      status: 'unverified',
      supporting,
      conflicting,
      rationale: 'no evidence has been weighed against this claim yet',
      confidence: 0,
      checkedAt,
    };
  };

  const verifier: Verifier & { verifyClaim: (claim: Claim) => VerificationResult } = {
    verifyClaim,
    /**
     * The Core contract's shape: verify a statement against loose evidence.
     * Here the evidence arrives directly, so it is weighed directly -- there is
     * no claim to cap the result against.
     */
    async verify(claim: string, evidence: readonly Evidence[]): Promise<Result<VerificationResult>> {
      const checkedAt = options.now().toISOString();
      const supporting = evidence.map((e) => e.id);
      const strength =
        evidence.length === 0
          ? 0
          : evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length;
      return ok(
        supporting.length >= minSupporting
          ? {
              claim,
              status: 'verified',
              supporting,
              conflicting: [],
              rationale: `${supporting.length} piece(s) of evidence support this claim`,
              confidence: strength,
              checkedAt,
            }
          : {
              claim,
              status: 'unverified',
              supporting,
              conflicting: [],
              rationale: 'no evidence has been weighed against this claim yet',
              confidence: 0,
              checkedAt,
            },
      );
    },
  };

  return verifier;
}
