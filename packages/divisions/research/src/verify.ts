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
 */
import {
  type Claim,
  type Evidence,
  type Result,
  type VerificationResult,
  type Verifier,
  ok,
} from '@nexus/core';

export interface CreateVerifierOptions {
  readonly now: () => Date;
  /** Supporting evidence needed before a claim counts as verified. */
  readonly minSupporting?: number;
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

  const verifyClaim = (claim: Claim): VerificationResult => {
    const checkedAt = options.now().toISOString();
    const supporting = [...claim.supportedBy];
    const conflicting = [...claim.contradictedBy];

    // Conflict outranks support: a claim with evidence on both sides is
    // contradicted, never quietly netted out to "mostly verified" (§19.2).
    if (conflicting.length > 0) {
      return {
        claim: claim.statement,
        status: 'contradicted',
        supporting,
        conflicting,
        rationale:
          `${conflicting.length} piece(s) of evidence conflict with this claim` +
          (supporting.length > 0 ? `, against ${supporting.length} supporting` : ''),
        checkedAt,
      };
    }

    if (supporting.length >= minSupporting) {
      return {
        claim: claim.statement,
        status: 'verified',
        supporting,
        conflicting,
        rationale: `${supporting.length} piece(s) of evidence support this claim`,
        checkedAt,
      };
    }

    // An `uncertain` claim was already weighed and found wanting; anything else
    // with no evidence simply has not been checked.
    if (claim.status === 'uncertain') {
      return {
        claim: claim.statement,
        status: 'insufficient',
        supporting,
        conflicting,
        rationale: claim.uncertaintyReason ?? 'insufficient evidence to establish confidence',
        checkedAt,
      };
    }

    return {
      claim: claim.statement,
      status: 'unverified',
      supporting,
      conflicting,
      rationale: 'no evidence has been weighed against this claim yet',
      checkedAt,
    };
  };

  const verifier: Verifier & { verifyClaim: (claim: Claim) => VerificationResult } = {
    verifyClaim,
    /** The Core contract's shape: verify a statement against loose evidence. */
    async verify(claim: string, evidence: readonly Evidence[]): Promise<Result<VerificationResult>> {
      const checkedAt = options.now().toISOString();
      const supporting = evidence.map((e) => e.id);
      return ok(
        supporting.length >= minSupporting
          ? {
              claim,
              status: 'verified',
              supporting,
              conflicting: [],
              rationale: `${supporting.length} piece(s) of evidence support this claim`,
              checkedAt,
            }
          : {
              claim,
              status: 'unverified',
              supporting,
              conflicting: [],
              rationale: 'no evidence has been weighed against this claim yet',
              checkedAt,
            },
      );
    },
  };

  return verifier;
}
