/**
 * The Research Division's inputs and outputs.
 *
 * The structured result is the source of truth. `synthesis` is *derived from*
 * claims and never the other way round -- if prose and claims ever disagree,
 * the claims are right and the prose is a bug (spec §10 of the phase brief,
 * §6.1 of the master spec).
 */
import type { Claim, Contradiction, Evidence, RunId, VerificationResult } from '@nexus/core';

/** A source the division knows how to reach. */
export interface SourceRef {
  /** Stable identity within a corpus. */
  readonly id: string;
  readonly title: string;
  /** Where it lives. A path for a local corpus; a URL for a future web one. */
  readonly locator: string;
  readonly publisher?: string;
  readonly publishedAt?: string;
}

/** What came back, plus the provenance of the act of retrieval. */
export interface RetrievedContent {
  readonly source: SourceRef;
  /**
   * The document text. UNTRUSTED: it can contain anything, including text
   * shaped like instructions. It is only ever read as data (see extract.ts).
   */
  readonly text: string;
  readonly retrievedAt: string;
  /** Of the bytes actually received. Detects later drift, per spec §19.2. */
  readonly contentHash: string;
  /**
   * The reader service the text passed through, when one was used.
   *
   * Present means `text` is that service's RENDERING of the source, not the
   * source itself, and `contentHash` attests to the rendering. Saying so is the
   * point: a "verbatim excerpt" of a transformation is verbatim with respect to
   * the transformation, and quietly calling that the source would make the
   * evidence guarantee attest to the wrong artefact. Absent means the bytes
   * came from the origin directly.
   */
  readonly via?: string;
  /**
   * Where the content actually came from, when a redirect moved it.
   *
   * Present means `source.locator` is where the fetch STARTED and this is
   * where it ended. Recording it matters because a redirect silently changes
   * what the evidence is about: without it, a claim would cite a URL that
   * served no bytes, and a later re-fetch checking `contentHash` for drift
   * would be comparing against the wrong document.
   */
  readonly finalLocator?: string;
}

export interface ResearchRequest {
  /** The question in the user's words. */
  readonly question: string;
  /**
   * What the answer is ABOUT, supplied by the caller rather than guessed.
   * Contradiction detection groups on these, so guessing them from free text
   * would make conflict detection quietly unreliable.
   */
  readonly subjects: readonly string[];
  /** Ceiling on sources consulted. */
  readonly maxSources?: number;
}

export interface ResearchResult {
  readonly request: ResearchRequest;
  readonly claims: readonly Claim[];
  readonly evidence: readonly Evidence[];
  readonly sources: readonly SourceRef[];
  readonly contradictions: readonly Contradiction[];
  /**
   * One verification per claim: what the evidence says about it, as opposed to
   * what kind of claim it is. Carried here so a caller can audit any single
   * claim without re-running the pipeline (ADR 0013).
   */
  readonly verifications: readonly VerificationResult[];
  /**
   * Aggregate confidence, 0..1. Deliberately conservative: an unresolved
   * contradiction lowers it and is never averaged away (spec §19.2).
   */
  readonly confidence: number;
  /** Prose derived from the claims above. Never the source of truth. */
  readonly synthesis: string;
  /** True when synthesis came from a model rather than the deterministic writer. */
  readonly synthesisFromModel: boolean;
  readonly runId: RunId;
  readonly completedAt: string;
}
