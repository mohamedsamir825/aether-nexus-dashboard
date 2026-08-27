import { test, expect, describe } from 'bun:test';
import { claimId, evidenceId, runId, type Claim } from '@nexus/core';
import { createClaimVerifier } from '../src/verify.ts';
import { detectContradictions, hasNegation, markContradicted, numbersIn } from '../src/contradictions.ts';
import { fixedNow } from './fixtures.ts';

const RUN = runId('run_test');
const verifier = createClaimVerifier({ now: fixedNow });

const claim = (over: Partial<Claim> = {}): Claim => ({
  id: claimId('cl_1'),
  statement: 'The population is recovering.',
  status: 'fact',
  subject: 'seals',
  supportedBy: [evidenceId('ev_1')],
  contradictedBy: [],
  derivedFrom: [],
  assumptions: [],
  confidence: 0.9,
  runId: RUN,
  createdAt: '2026-06-01T12:00:00.000Z',
  ...over,
});

describe('verification — the four states', () => {
  test('evidence supporting a claim verifies it', () => {
    expect(verifier.verifyClaim(claim()).status).toBe('verified');
  });

  test('an inference can be verified — the two axes are independent', () => {
    // This is the case a single merged enum would have made inexpressible.
    const result = verifier.verifyClaim(
      claim({ status: 'inference', derivedFrom: [claimId('cl_0')] }),
    );
    expect(result.status).toBe('verified');
  });

  test('conflicting evidence contradicts, and outranks support', () => {
    // Never quietly netted out to "mostly verified" (§19.2).
    const result = verifier.verifyClaim(
      claim({ supportedBy: [evidenceId('ev_1')], contradictedBy: [evidenceId('ev_2')] }),
    );
    expect(result.status).toBe('contradicted');
    expect(result.supporting).toHaveLength(1);
    expect(result.conflicting).toHaveLength(1);
  });

  test('an uncertain claim is insufficient — weighed and found wanting', () => {
    const result = verifier.verifyClaim(
      claim({ status: 'uncertain', supportedBy: [], uncertaintyReason: 'nothing found', confidence: 0 }),
    );
    expect(result.status).toBe('insufficient');
    expect(result.rationale).toBe('nothing found');
  });

  test('a claim with no evidence yet is unverified, not insufficient', () => {
    const result = verifier.verifyClaim(claim({ supportedBy: [] }));
    expect(result.status).toBe('unverified');
  });

  test('every verification explains itself', () => {
    for (const c of [claim(), claim({ supportedBy: [] })]) {
      expect(verifier.verifyClaim(c).rationale.length).toBeGreaterThan(0);
    }
  });

  test('the Core Verifier shape works over loose evidence', async () => {
    const result = await verifier.verify('a statement', [
      { id: evidenceId('ev_1'), claim: 'x', source: { kind: 'document', retrievedAt: 'now' }, confidence: 1 },
    ]);
    expect(result.ok && result.value.status).toBe('verified');
  });
});

describe('contradiction primitives', () => {
  test('detects negation in English and Arabic', () => {
    expect(hasNegation('is not recovering')).toBe(true);
    expect(hasNegation('never recovered')).toBe(true);
    expect(hasNegation('لم يتعافَ')).toBe(true);
    expect(hasNegation('is recovering')).toBe(false);
  });

  test('reads numbers but ignores years, which are context not value', () => {
    expect(numbersIn('recorded 412 seals')).toEqual([412]);
    expect(numbersIn('in 2026 the survey ran')).toEqual([]);
    expect(numbersIn('in 2026 it recorded 412')).toEqual([412]);
  });
});

describe('contradiction detection', () => {
  test('claims that agree produce no conflict', () => {
    const found = detectContradictions({
      claims: [
        claim({ id: claimId('a'), statement: 'A states: the population is recovering.' }),
        claim({ id: claimId('b'), statement: 'B states: the population is recovering.' }),
      ],
      now: fixedNow,
    });
    expect(found).toEqual([]);
  });

  test('assertion versus negation is a conflict', () => {
    const found = detectContradictions({
      claims: [
        claim({ id: claimId('a'), statement: 'A states: the population is recovering.' }),
        claim({ id: claimId('b'), statement: 'B states: the population is not recovering.' }),
      ],
      now: fixedNow,
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toContain('negates');
    expect(found[0]?.claims).toHaveLength(2);
  });

  test('different values for one subject is a conflict', () => {
    const found = detectContradictions({
      claims: [
        claim({ id: claimId('a'), statement: 'A states: 412 seals were counted.' }),
        claim({ id: claimId('b'), statement: 'B states: 195 seals were counted.' }),
      ],
      now: fixedNow,
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toContain('different values');
  });

  test('claims about different subjects are never compared', () => {
    const found = detectContradictions({
      claims: [
        claim({ id: claimId('a'), subject: 'seals', statement: 'is recovering' }),
        claim({ id: claimId('b'), subject: 'otters', statement: 'is not recovering' }),
      ],
      now: fixedNow,
    });
    expect(found).toEqual([]);
  });

  test('uncertain claims assert nothing, so they cannot conflict', () => {
    const found = detectContradictions({
      claims: [
        claim({ id: claimId('a'), status: 'uncertain', uncertaintyReason: 'x', statement: 'not established' }),
        claim({ id: claimId('b'), statement: 'is recovering' }),
      ],
      now: fixedNow,
    });
    expect(found).toEqual([]);
  });

  test('a conflict lowers confidence but never merges or deletes a claim', () => {
    const claims = [
      claim({ id: claimId('a'), statement: 'is recovering', confidence: 0.9 }),
      claim({ id: claimId('b'), statement: 'is not recovering', confidence: 0.9 }),
    ];
    const found = detectContradictions({ claims, now: fixedNow });
    const marked = markContradicted(claims, found);

    // Both survive, both are visible, neither is averaged away.
    expect(marked).toHaveLength(2);
    expect(marked.every((c) => c.confidence <= 0.4)).toBe(true);
    expect(marked.map((c) => c.statement)).toEqual(['is recovering', 'is not recovering']);
  });
});
