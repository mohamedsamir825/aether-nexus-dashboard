/**
 * Research memory: what was established in earlier runs.
 *
 * Until now a run began knowing nothing. Contradiction detection compared
 * claims within one run and could not notice that today's source contradicts
 * what a source said last week -- which is the disagreement that actually
 * matters, since a single run's corpus is usually gathered on one topic at one
 * moment.
 *
 * ## Evidence is persisted too, or the lineage dangles
 *
 * A `Claim` cites evidence by id. Persisting claims alone would produce, on the
 * next run, a claim pointing at evidence that no longer exists anywhere -- a
 * citation to nothing, which is worse than no citation because it looks like
 * provenance. So evidence is stored alongside, and a recalled claim can be
 * resolved back to the source, the excerpt, and the retrieval timestamp.
 *
 * ## Everything goes through ScopedMemory
 *
 * Never the raw store. The agent holds a view narrowed to its own scopes with a
 * capability checked on every access, so persistence cannot become a way to
 * read another division's memory.
 */
import {
  type Claim,
  type ClaimId,
  type Contradiction,
  type Evidence,
  type EvidenceId,
  type MemoryScope,
  type Result,
  type ScopedMemory,
  ok,
} from '@nexus/core';

/** Research's own division scope (§12.1, "Owning division"). */
export const RESEARCH_MEMORY_SCOPE: MemoryScope = { kind: 'division', id: 'research' };

const CLAIM_TAG = 'research:claim';
const EVIDENCE_TAG = 'research:evidence';
const CONTRADICTION_TAG = 'research:contradiction';

/** Tags carry the subject so recall can narrow without scanning every record. */
const subjectTag = (subject: string) => `subject:${subject}`;

export interface RememberedResearch {
  readonly claims: number;
  readonly evidence: number;
  readonly contradictions: number;
}

/**
 * Persists what a run established.
 *
 * Failures are returned, not swallowed. A run whose findings could not be
 * stored has not really finished, and reporting success would mean the next run
 * silently starts from an older world than the caller believes.
 */
export async function rememberFindings(params: {
  readonly memory: ScopedMemory;
  readonly claims: readonly Claim[];
  readonly evidence: readonly Evidence[];
  readonly contradictions: readonly Contradiction[];
  readonly runId: string;
}): Promise<Result<RememberedResearch>> {
  for (const item of params.evidence) {
    const written = await params.memory.remember({
      scope: RESEARCH_MEMORY_SCOPE,
      kind: 'artifact',
      // The collector's note, kept verbatim -- this is provenance about the act
      // of collection and must not be paraphrased on the way in.
      content: item.claim,
      tags: [EVIDENCE_TAG, `evidence:${item.id}`],
      sourceRunId: params.runId,
      confidence: item.confidence,
      metadata: { evidenceId: item.id, source: item.source, excerpt: item.excerpt },
    });
    if (!written.ok) return written;
  }

  for (const claim of params.claims) {
    const written = await params.memory.remember({
      scope: RESEARCH_MEMORY_SCOPE,
      kind: claim.status === 'fact' ? 'fact' : 'episode',
      content: claim.statement,
      tags: [CLAIM_TAG, subjectTag(claim.subject), `status:${claim.status}`],
      sourceRunId: params.runId,
      confidence: claim.confidence,
      // The whole claim, so a recalled one is a Claim again rather than a
      // sentence that used to be one.
      metadata: { claim },
    });
    if (!written.ok) return written;
  }

  for (const contradiction of params.contradictions) {
    const written = await params.memory.remember({
      scope: RESEARCH_MEMORY_SCOPE,
      kind: 'episode',
      content: contradiction.reason,
      tags: [CONTRADICTION_TAG, subjectTag(contradiction.subject)],
      sourceRunId: params.runId,
      metadata: { contradiction },
    });
    if (!written.ok) return written;
  }

  return ok({
    claims: params.claims.length,
    evidence: params.evidence.length,
    contradictions: params.contradictions.length,
  });
}

export interface PriorKnowledge {
  readonly claims: readonly Claim[];
  readonly evidence: readonly Evidence[];
}

/**
 * Recalls what earlier runs established about these subjects.
 *
 * Only the named subjects, and only this division's scope. Recalling
 * everything would make every run slower as the store grows and would drag in
 * claims that cannot contradict the current ones anyway, since contradiction
 * detection groups on subject.
 */
export async function recallPrior(params: {
  readonly memory: ScopedMemory;
  readonly subjects: readonly string[];
  readonly limit?: number;
}): Promise<Result<PriorKnowledge>> {
  const claims: Claim[] = [];
  const wanted = new Set<EvidenceId>();

  for (const subject of params.subjects) {
    const found = await params.memory.recall({
      scope: RESEARCH_MEMORY_SCOPE,
      tags: [CLAIM_TAG, subjectTag(subject)],
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
    });
    if (!found.ok) return found;

    for (const record of found.value) {
      const stored = record.metadata?.['claim'];
      // A record whose payload is unreadable is skipped rather than guessed
      // at. Reconstructing a partial claim would fabricate the missing parts.
      if (!isClaim(stored)) continue;
      claims.push(stored);
      for (const id of stored.supportedBy) wanted.add(id);
      for (const id of stored.contradictedBy) wanted.add(id);
    }
  }

  const evidence: Evidence[] = [];
  for (const id of wanted) {
    const found = await params.memory.recall({
      scope: RESEARCH_MEMORY_SCOPE,
      tags: [EVIDENCE_TAG, `evidence:${id}`],
      limit: 1,
    });
    if (!found.ok) return found;
    const record = found.value[0];
    if (record === undefined) continue;
    const source = record.metadata?.['source'];
    if (!isSource(source)) continue;
    evidence.push({
      id,
      claim: record.content,
      source,
      confidence: record.confidence ?? 1,
      ...(typeof record.metadata?.['excerpt'] === 'string'
        ? { excerpt: record.metadata['excerpt'] }
        : {}),
    });
  }

  return ok({ claims, evidence });
}

function isClaim(value: unknown): value is Claim {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<Claim>;
  return (
    typeof c.id === 'string' &&
    typeof c.statement === 'string' &&
    typeof c.subject === 'string' &&
    typeof c.status === 'string' &&
    Array.isArray(c.supportedBy) &&
    Array.isArray(c.contradictedBy)
  );
}

function isSource(value: unknown): value is Evidence['source'] {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<Evidence['source']>;
  return typeof s.kind === 'string' && typeof s.retrievedAt === 'string';
}

/** Ids of claims recalled from memory, so a caller can tell old from new. */
export function priorClaimIds(prior: PriorKnowledge): ReadonlySet<ClaimId> {
  return new Set(prior.claims.map((c) => c.id));
}
