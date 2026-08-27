import { test, expect, describe } from 'bun:test';
import { rankByRelevance, terms } from '../src/runtime/retrieval-rank.ts';

const rank = (query: string, docs: Record<string, string>) =>
  rankByRelevance({
    query,
    documents: Object.entries(docs).map(([id, text]) => ({ id, text })),
  });

describe('ranking beats substring matching', () => {
  test('a document mentioning query terms in different sentences still matches', () => {
    // `content.includes(needle)` misses this entirely: the phrase never occurs.
    const ranked = rank('quarterly revenue', {
      split: 'Revenue was strong. The quarterly review noted it.',
      absent: 'Nothing relevant here at all.',
    });
    expect(ranked.map((r) => r.id)).toEqual(['split']);
  });

  test('a rarer term counts for more than a common one', () => {
    // "the" is in everything and carries almost no signal; "kelp" is
    // distinctive. A count-based ranker would rate these equally.
    const ranked = rank('the kelp', {
      common: 'the the the the the the the the',
      rare: 'the kelp forest',
    });
    expect(ranked[0]?.id).toBe('rare');
  });

  test('repetition is damped, so keyword stuffing does not win outright', () => {
    const ranked = rank('billing invoices', {
      stuffed: 'billing billing billing billing billing billing billing billing',
      balanced: 'billing and invoices, handled together',
    });
    // The document covering BOTH terms beats one repeating a single term.
    expect(ranked[0]?.id).toBe('balanced');
  });

  test('a long document is not favoured merely for being long', () => {
    const ranked = rank('seal', {
      short: 'seal',
      padded: `seal ${'filler '.repeat(200)}`,
    });
    expect(ranked[0]?.id).toBe('short');
  });
});

describe('what it refuses to do', () => {
  test('documents matching nothing are absent, not scored zero', () => {
    // "no result" and "a very bad result" are different answers, and a caller
    // taking the top N should not be handed padding.
    const ranked = rank('submarine', { a: 'gardening notes', b: 'billing notes' });
    expect(ranked).toEqual([]);
  });

  test('an empty query ranks nothing rather than everything', () => {
    expect(rank('', { a: 'anything' })).toEqual([]);
    expect(rank('!!! ???', { a: 'anything' })).toEqual([]);
  });

  test('it is lexical, not semantic — and this is the documented limit', () => {
    // A synonym is invisible to BM25. Recording it as a test so the limitation
    // is a stated fact rather than a surprise at the point of use.
    const ranked = rank('automobile', { a: 'the car is red' });
    expect(ranked).toEqual([]);
  });
});

describe('determinism', () => {
  test('ties break on id, so ranking is reproducible', () => {
    const docs = { zebra: 'seal', alpha: 'seal', mango: 'seal' };
    expect(rank('seal', docs).map((r) => r.id)).toEqual(['alpha', 'mango', 'zebra']);
    // Same input, same output, every time.
    expect(rank('seal', docs)).toEqual(rank('seal', docs));
  });

  test('tokenisation is Unicode-aware and drops single characters', () => {
    expect(terms('السعر ارتفع 12%')).toEqual(['السعر', 'ارتفع', '12']);
    expect(terms('a bb ccc')).toEqual(['bb', 'ccc']);
  });
});
