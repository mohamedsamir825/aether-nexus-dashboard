import { test, expect, describe } from 'bun:test';
import { claimId, evidenceId, runId, type Claim } from '@nexus/core';
import { buildClaims, createClaimValidator } from '../src/claims.ts';
import { extractEvidence, mentions, sentences } from '../src/extract.ts';
import { createFixtureRetriever } from '../src/retrieval.ts';
import { agreeingCorpus, fixedNow } from './fixtures.ts';
import type { RetrievedContent } from '../src/types.ts';

const validator = createClaimValidator();
const RUN = runId('run_test');

const base: Claim = {
  id: claimId('cl_1'),
  statement: 'Something is asserted.',
  status: 'fact',
  subject: 'seals',
  supportedBy: [evidenceId('ev_1')],
  contradictedBy: [],
  derivedFrom: [],
  assumptions: [],
  confidence: 0.9,
  runId: RUN,
  createdAt: '2026-06-01T12:00:00.000Z',
};

describe('claim validation — spec §6.1', () => {
  test('a valid fact passes', () => {
    expect(validator.validate(base).ok).toBe(true);
  });

  test('a fact with no evidence is rejected', () => {
    // "A FACT without evidence is a defect, not a stylistic issue."
    const result = validator.validate({ ...base, supportedBy: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('at least one piece of evidence');
  });

  test('an inference must name what it derives from', () => {
    expect(validator.validate({ ...base, status: 'inference', derivedFrom: [] }).ok).toBe(false);
    expect(
      validator.validate({ ...base, status: 'inference', derivedFrom: [claimId('cl_0')] }).ok,
    ).toBe(true);
  });

  test('a recommendation needs both derivation and stated assumptions', () => {
    const rec: Claim = { ...base, status: 'recommendation', derivedFrom: [claimId('cl_0')] };
    expect(validator.validate(rec).ok).toBe(false);
    expect(validator.validate({ ...rec, assumptions: ['catch limits stay in force'] }).ok).toBe(true);
  });

  test('an uncertain claim must say what is missing', () => {
    const unc: Claim = { ...base, status: 'uncertain', supportedBy: [], confidence: 0 };
    expect(validator.validate(unc).ok).toBe(false);
    expect(validator.validate({ ...unc, uncertaintyReason: 'no source found' }).ok).toBe(true);
  });

  test('rejects an empty statement, empty subject, or out-of-range confidence', () => {
    expect(validator.validate({ ...base, statement: '  ' }).ok).toBe(false);
    expect(validator.validate({ ...base, subject: '' }).ok).toBe(false);
    expect(validator.validate({ ...base, confidence: 1.5 }).ok).toBe(false);
    expect(validator.validate({ ...base, confidence: -0.1 }).ok).toBe(false);
  });

  test('reports every problem at once, not just the first', () => {
    const result = validator.validate({ ...base, statement: '', supportedBy: [], confidence: 9 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error.details?.['problems'] as string[]).length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('sentence handling', () => {
  test('splits on terminators and collapses whitespace', () => {
    expect(sentences('One thing. Two things!  Three?')).toEqual([
      'One thing.', 'Two things!', 'Three?',
    ]);
  });

  test('a subject matches by substring or by shared terms', () => {
    expect(mentions('The harbour seal is recovering.', 'harbour seal')).toBe(true);
    expect(mentions('Seals in the harbour recovered.', 'harbour seal')).toBe(false);
    expect(mentions('The otter is recovering.', 'harbour seal')).toBe(false);
  });
});

async function extractFrom(corpus: typeof agreeingCorpus, subject: string) {
  const retriever = createFixtureRetriever({ documents: corpus, now: fixedNow });
  const found = await retriever.discover(subject, 5);
  if (!found.ok) throw new Error('discover failed');
  const documents: RetrievedContent[] = [];
  for (const ref of found.value) {
    const got = await retriever.retrieve(ref);
    if (got.ok) documents.push(got.value);
  }
  return extractEvidence({ documents, subjects: [subject], runId: RUN });
}

describe('evidence extraction', () => {
  test('excerpts are verbatim, never paraphrased', async () => {
    const extracted = await extractFrom(agreeingCorpus, 'harbour seal population');
    expect(extracted.length).toBeGreaterThan(0);
    for (const item of extracted) {
      expect(item.evidence.excerpt).toBe(item.sentence);
      expect(item.sentence).toContain('harbour seal population');
    }
  });

  test('every piece of evidence carries source provenance', async () => {
    const extracted = await extractFrom(agreeingCorpus, 'harbour seal population');
    for (const item of extracted) {
      expect(item.evidence.source.uri).toStartWith('fixture:');
      expect(item.evidence.source.retrievedAt).toBe('2026-06-01T12:00:00.000Z');
      expect(item.evidence.source.contentHash).toBeDefined();
      // Retrieval time is distinct from publication time (§19.2).
      expect(item.evidence.source.publishedAt).toBe('2026-03-01');
    }
  });
});

describe('claim building', () => {
  test('a source assertion becomes an attributed fact', async () => {
    const extracted = await extractFrom(agreeingCorpus, 'harbour seal population');
    const claims = buildClaims({ extracted, subjects: ['harbour seal population'], runId: RUN, now: fixedNow });

    const facts = claims.filter((c) => c.status === 'fact');
    expect(facts.length).toBeGreaterThan(0);
    // Attribution, not assertion: the division reports what a source says.
    expect(facts[0]?.statement).toContain('states:');
    expect(facts[0]?.supportedBy.length).toBe(1);
  });

  test('agreement across independent sources is an inference, not a stronger fact', async () => {
    const extracted = await extractFrom(agreeingCorpus, 'harbour seal population');
    const claims = buildClaims({ extracted, subjects: ['harbour seal population'], runId: RUN, now: fixedNow });

    const inference = claims.find((c) => c.status === 'inference');
    expect(inference).toBeDefined();
    expect(inference?.derivedFrom.length).toBeGreaterThan(0);
    // Corroboration raises confidence but never to certainty.
    expect(inference?.confidence).toBeLessThan(1);
  });

  test('a subject with no evidence becomes uncertain, never a confident negative', () => {
    const claims = buildClaims({ extracted: [], subjects: ['sea otters'], runId: RUN, now: fixedNow });
    expect(claims).toHaveLength(1);
    expect(claims[0]?.status).toBe('uncertain');
    expect(claims[0]?.confidence).toBe(0);
    expect(claims[0]?.uncertaintyReason).toBeTruthy();
  });

  test('every built claim passes validation', async () => {
    const extracted = await extractFrom(agreeingCorpus, 'harbour seal population');
    const claims = buildClaims({
      extracted,
      subjects: ['harbour seal population', 'sea otters'],
      runId: RUN,
      now: fixedNow,
    });
    for (const claim of claims) expect(validator.validate(claim).ok).toBe(true);
  });

  test('never invents a recommendation', async () => {
    // A recommendation is a judgement; no deterministic rule over sentences can
    // produce one honestly, so the builder does not try.
    const extracted = await extractFrom(agreeingCorpus, 'harbour seal population');
    const claims = buildClaims({ extracted, subjects: ['harbour seal population'], runId: RUN, now: fixedNow });
    expect(claims.some((c) => c.status === 'recommendation')).toBe(false);
  });
});
