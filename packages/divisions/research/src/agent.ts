/**
 * The Research agent: runs the pipeline, owns no infrastructure.
 *
 * Retrieval goes through `context.tools`, so it passes ToolBelt's gates and
 * lands in the event trail. Everything after retrieval is a pure function over
 * data, which is what makes the whole workflow reproducible without a network
 * or a credential.
 *
 * The agent never touches a provider, a registry or the permission engine
 * directly. It receives a context and uses what it was given.
 */
import {
  type AgentContext,
  type AgentResult,
  type AnyAgent,
  type Claim,
  type Evidence,
  type Result,
  type RunId,
  agentId,
  divisionId,
  emptyUsage,
  err,
  nexusError,
  ok,
} from '@nexus/core';
import type { ResearchRequest, ResearchResult, RetrievedContent, SourceRef } from './types.ts';
import { RESEARCH_RETRIEVE_TOOL_ID, type RetrieveOutput } from './tool.ts';
import { extractEvidence } from './extract.ts';
import { buildClaims, createClaimValidator } from './claims.ts';
import { createClaimVerifier } from './verify.ts';
import { detectContradictions, markContradicted } from './contradictions.ts';
import { synthesize } from './synthesize.ts';
import {
  RESEARCH_MEMORY_SCOPE,
  recallPrior,
  rememberFindings,
  type PriorKnowledge,
} from './persistence.ts';

export const RESEARCH_DIVISION_ID = divisionId('research');
export const RESEARCH_ANALYST_ID = agentId('research.analyst');
export const RESEARCH_ANALYST_ROLE = 'analyst';

const DEFAULT_MAX_SOURCES = 5;

function isResearchRequest(input: unknown): input is ResearchRequest {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<ResearchRequest>;
  return (
    typeof candidate.question === 'string' &&
    candidate.question.trim() !== '' &&
    Array.isArray(candidate.subjects) &&
    candidate.subjects.length > 0 &&
    candidate.subjects.every((s) => typeof s === 'string' && s.trim() !== '')
  );
}

/**
 * Conservative aggregate confidence. An unresolved conflict pulls it down and
 * is never averaged away.
 */
export function aggregateConfidence(claims: readonly Claim[], conflicts: number): number {
  const asserted = claims.filter((c) => c.status === 'fact' || c.status === 'inference');
  if (asserted.length === 0) return 0;
  const mean = asserted.reduce((sum, c) => sum + c.confidence, 0) / asserted.length;
  const penalty = conflicts === 0 ? 1 : Math.max(0.3, 1 - 0.25 * conflicts);
  return Number((mean * penalty).toFixed(3));
}

export function createResearchAnalyst(): AnyAgent {
  const validator = createClaimValidator();

  return {
    descriptor: {
      id: RESEARCH_ANALYST_ID,
      division: RESEARCH_DIVISION_ID,
      role: RESEARCH_ANALYST_ROLE,
      displayName: 'Research Analyst',
      description:
        'Retrieves sources, extracts evidence, builds typed claims, verifies them, ' +
        'surfaces contradictions, and synthesises a result.',
      version: '1.0.0',
      skills: [],
      tools: [RESEARCH_RETRIEVE_TOOL_ID],
      capabilities: ['tool:execute', 'research:retrieve', 'memory:read', 'memory:write'],
      memoryScopes: [RESEARCH_MEMORY_SCOPE],
      // A capability, not a provider. Routing decides who serves it.
      modelPolicy: { requiredCapabilities: ['text'], allowFallback: true },
    },

    async handle(task, context: AgentContext): Promise<Result<AgentResult>> {
      if (!isResearchRequest(task.input)) {
        return err(
          nexusError('INVALID_INPUT', 'a research task needs a question and at least one subject', {
            details: { taskId: task.id },
          }),
        );
      }
      const request: ResearchRequest = task.input;
      const runId: RunId = context.runId;
      const now = () => context.clock.now();

      // --- retrieval: the only step that leaves the process -----------------
      let documents: readonly RetrievedContent[] = [];
      let sources: readonly SourceRef[] = [];
      let retrievalEvidence: readonly Evidence[] = [];

      const retrieved = await context.tools.invoke(
        {
          toolId: RESEARCH_RETRIEVE_TOOL_ID,
          input: { query: request.question, limit: request.maxSources ?? DEFAULT_MAX_SOURCES },
        },
        context,
      );

      if (retrieved.ok) {
        const output = retrieved.value.output as RetrieveOutput;
        documents = output.documents;
        sources = output.sources;
        retrievalEvidence = retrieved.value.evidence ?? [];
      } else if (retrieved.error.code !== 'NOT_FOUND') {
        // A permission denial or a budget refusal is a real failure and must
        // surface. Finding nothing is not -- it becomes an uncertain claim.
        return retrieved;
      }

      // --- everything below is deterministic and provider-free --------------
      const extracted = extractEvidence({ documents, subjects: request.subjects, runId });
      const built = buildClaims({ extracted, subjects: request.subjects, runId, now });

      // What earlier runs established about these subjects. A store with
      // nothing in it, or one this agent may not read, yields an empty prior
      // rather than a failure: research without history is still research.
      const recalled = await recallPrior({ memory: context.memory, subjects: request.subjects });
      const prior: PriorKnowledge = recalled.ok ? recalled.value : { claims: [], evidence: [] };

      // Contradiction detection runs over BOTH, which is the point of keeping
      // history: a source disagreeing with what a different source said last
      // week is the disagreement that usually matters, and a single run's
      // corpus is gathered on one topic at one moment.
      const contradictions = detectContradictions({ claims: [...prior.claims, ...built], now });
      const claims = markContradicted(built, contradictions);

      // Every claim is validated against §6.1. A malformed claim is a defect in
      // this division, so it fails loudly rather than reaching the caller.
      for (const claim of claims) {
        const valid = validator.validate(claim);
        if (!valid.ok) return valid;
      }

      // Assembled before verification, not after: the verifier is scored
      // against the evidence, so it has to be handed the evidence.
      const evidence: readonly Evidence[] = [
        ...retrievalEvidence,
        ...extracted.map((e) => e.evidence),
        // Prior evidence travels with prior claims. Without it a recalled
        // claim cites evidence nothing can resolve -- a citation to nothing,
        // which is worse than none because it looks like provenance.
        ...prior.evidence,
      ];

      const verifier = createClaimVerifier({ now, evidence });
      const verifications = claims.map((claim) => verifier.verifyClaim(claim));

      const synthesis = await synthesize({
        question: request.question,
        claims,
        contradictions,
        models: context.models,
      });

      // A conflict is cross-run when it involves a claim that came from
      // memory rather than from this run's corpus.
      const priorIds = new Set(prior.claims.map((c) => String(c.id)));
      const crossRunConflicts = contradictions.filter((c) =>
        c.claims.some((id) => priorIds.has(String(id))),
      );

      // Persisted after everything succeeded, so a run that failed validation
      // does not leave its claims behind for the next one to build on.
      const remembered = await rememberFindings({
        memory: context.memory,
        claims,
        evidence: [...retrievalEvidence, ...extracted.map((e) => e.evidence)],
        contradictions,
        runId,
      });

      const result: ResearchResult = {
        request,
        claims,
        evidence,
        sources,
        contradictions,
        verifications,
        confidence: aggregateConfidence(claims, contradictions.length),
        synthesis: synthesis.text,
        synthesisFromModel: synthesis.fromModel,
        runId,
        completedAt: now().toISOString(),
        crossRunConflicts,
        priorClaimsConsidered: prior.claims.length,
        persisted: remembered.ok,
      };

      return ok({
        output: result,
        summary:
          `${claims.length} claim(s) from ${sources.length} source(s)` +
          (contradictions.length > 0 ? `, ${contradictions.length} unresolved conflict(s)` : '') +
          (crossRunConflicts.length > 0 ? ` (${crossRunConflicts.length} against earlier runs)` : ''),
        evidence,
        usage: { ...emptyUsage, toolCalls: retrieved.ok ? 1 : 0 },
      });
    },
  };
}
