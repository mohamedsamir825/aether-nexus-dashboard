/**
 * Claim construction and validation.
 *
 * ## What this deliberately will not do
 *
 * It does not emit `recommendation` claims. A recommendation is a judgement
 * about what someone should do, and no deterministic rule over sentences can
 * produce one honestly. The type is supported and validated -- an agent or a
 * human can create one -- but this builder never invents one, because a
 * fabricated recommendation is worse than a missing one.
 *
 * What it does produce:
 *   fact        a source says this, verbatim, and the evidence cites it
 *   inference   several independent sources agree; that agreement is derived
 *   uncertain   a subject was asked about and nothing was found
 */
import {
  type Claim,
  type ClaimValidator,
  type Result,
  type RunId,
  claimId,
  err,
  nexusError,
  ok,
} from '@nexus/core';
import type { ExtractedEvidence } from './extract.ts';

/**
 * Enforces spec §6.1 structurally. A rule enforced only by convention is one a
 * model under pressure to sound confident will eventually break.
 */
export function createClaimValidator(): ClaimValidator {
  return {
    validate(claim: Claim): Result<void> {
      const problems: string[] = [];

      if (claim.statement.trim() === '') problems.push('statement is empty');
      if (claim.subject.trim() === '') problems.push('subject is empty');
      if (!Number.isFinite(claim.confidence) || claim.confidence < 0 || claim.confidence > 1) {
        problems.push('confidence must be between 0 and 1');
      }

      switch (claim.status) {
        case 'fact':
          // §6.1: "A FACT without evidence is a defect, not a stylistic issue."
          if (claim.supportedBy.length === 0) {
            problems.push('a fact must cite at least one piece of evidence');
          }
          break;
        case 'inference':
          if (claim.derivedFrom.length === 0) {
            problems.push('an inference must name the claims it derives from');
          }
          break;
        case 'recommendation':
          if (claim.derivedFrom.length === 0) {
            problems.push('a recommendation must name the claims it derives from');
          }
          if (claim.assumptions.length === 0) {
            problems.push('a recommendation must state its assumptions');
          }
          break;
        case 'uncertain':
          if (!claim.uncertaintyReason || claim.uncertaintyReason.trim() === '') {
            problems.push('an uncertain claim must say what is missing or conflicting');
          }
          break;
      }

      if (problems.length > 0) {
        return err(
          nexusError('INVALID_INPUT', `invalid ${claim.status} claim: ${problems.join('; ')}`, {
            details: { claimId: claim.id, status: claim.status, problems },
          }),
        );
      }
      return ok(undefined);
    },
  };
}

export interface BuildClaimsOptions {
  readonly extracted: readonly ExtractedEvidence[];
  readonly subjects: readonly string[];
  readonly runId: RunId;
  readonly now: () => Date;
}

/** Distinct source documents backing a set of extractions. */
const sourceCount = (items: readonly ExtractedEvidence[]): number =>
  new Set(items.map((i) => i.evidence.source.uri ?? i.evidence.source.title ?? '')).size;

export function buildClaims(options: BuildClaimsOptions): readonly Claim[] {
  const createdAt = options.now().toISOString();
  const claims: Claim[] = [];

  for (const subject of options.subjects) {
    const forSubject = options.extracted.filter((e) => e.subject === subject);

    if (forSubject.length === 0) {
      // §6.1: absence of evidence is reported as uncertain, never as a
      // confident negative.
      claims.push({
        id: claimId(`cl_${options.runId}_${slug(subject)}_none`),
        statement: `No source in the corpus addresses "${subject}".`,
        status: 'uncertain',
        subject,
        supportedBy: [],
        contradictedBy: [],
        derivedFrom: [],
        assumptions: [],
        uncertaintyReason: 'no retrieved source mentioned this subject',
        confidence: 0,
        runId: options.runId,
        createdAt,
      });
      continue;
    }

    // One fact per extracted sentence, attributed to the source that said it.
    const factIds: string[] = [];
    for (const [index, item] of forSubject.entries()) {
      const id = claimId(`cl_${options.runId}_${slug(subject)}_f${index}`);
      factIds.push(id);
      claims.push({
        id,
        // The source's own words, attributed. The division is not asserting
        // this is true -- it is asserting that this source says it.
        statement: `${item.evidence.source.title ?? 'A source'} states: ${item.sentence}`,
        status: 'fact',
        subject,
        supportedBy: [item.evidence.id],
        contradictedBy: [],
        derivedFrom: [],
        assumptions: [],
        confidence: 1,
        runId: options.runId,
        createdAt,
      });
    }

    // Agreement across independent sources is genuinely derived, so it is an
    // inference and says so -- not a stronger-sounding fact.
    const distinctSources = sourceCount(forSubject);
    if (distinctSources >= 2) {
      claims.push({
        id: claimId(`cl_${options.runId}_${slug(subject)}_agree`),
        statement: `${distinctSources} independent sources in the corpus address "${subject}".`,
        status: 'inference',
        subject,
        supportedBy: forSubject.map((i) => i.evidence.id),
        contradictedBy: [],
        derivedFrom: factIds.map((id) => claimId(id)),
        assumptions: [],
        // Corroboration raises confidence but never to certainty: agreeing
        // sources can share an upstream error.
        confidence: Math.min(0.5 + 0.15 * distinctSources, 0.9),
        runId: options.runId,
        createdAt,
      });
    }
  }

  return claims;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40);
}
