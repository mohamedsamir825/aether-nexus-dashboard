/**
 * Evidence and verification (core principle 5).
 *
 * Any claim that originates outside NEXUS must be able to name where it came
 * from. The Core defines the shape and the seam; it deliberately ships no
 * Verifier implementation -- verification strategy belongs to the Research
 * division, which does not exist yet.
 */
import type { Result } from '../result.ts';
import type { EvidenceId } from '../ids.ts';

export type EvidenceKind =
  | 'web'
  | 'document'
  | 'dataset'
  | 'api'
  | 'computation'
  | 'user'
  | 'memory';

export interface EvidenceSource {
  readonly kind: EvidenceKind;
  readonly uri?: string;
  readonly title?: string;
  readonly publisher?: string;
  /** ISO timestamp of retrieval, not of publication. */
  readonly retrievedAt: string;
  readonly publishedAt?: string;
  /** Hash of the retrieved content, so a later re-fetch can detect drift. */
  readonly contentHash?: string;
}

export interface Evidence {
  readonly id: EvidenceId;
  /** The specific assertion this evidence supports or contradicts. */
  readonly claim: string;
  readonly source: EvidenceSource;
  /** Verbatim supporting extract. Never a paraphrase. */
  readonly excerpt?: string;
  /** 0..1, assigned by the collector. */
  readonly confidence: number;
}

export type VerificationStatus =
  | 'verified'
  | 'contradicted'
  | 'insufficient'
  | 'unverified';

export interface VerificationResult {
  readonly claim: string;
  readonly status: VerificationStatus;
  readonly supporting: readonly EvidenceId[];
  readonly conflicting: readonly EvidenceId[];
  readonly rationale: string;
  /**
   * 0..1 -- how strongly the weighed evidence settles the claim (spec §19.1).
   *
   * Distinct from `Claim.confidence`, which is how confident the assertion
   * itself is. A verifier may only lower that, never raise it: verification
   * cannot be more certain than the thing it verifies.
   */
  readonly confidence: number;
  readonly checkedAt: string;
}

export interface EvidenceStore {
  record(evidence: Evidence): Promise<Result<Evidence>>;
  get(id: EvidenceId): Promise<Result<Evidence | null>>;
  listByRun(runId: string): Promise<Result<readonly Evidence[]>>;
}

/**
 * Implemented later by the Research division. Declared here so that agent and
 * skill signatures can reference verification from day one.
 */
export interface Verifier {
  verify(claim: string, evidence: readonly Evidence[]): Promise<Result<VerificationResult>>;
}
