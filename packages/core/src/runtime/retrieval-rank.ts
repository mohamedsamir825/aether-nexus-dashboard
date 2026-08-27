/**
 * Ranked lexical retrieval (gap `A5`).
 *
 * ## It is called lexical because that is what it is
 *
 * `A5` is written as "semantic retrieval", and this is not that. It is BM25 --
 * a strong, well-understood ranking function over terms -- and it cannot match
 * "car" to "automobile" because it has no notion of meaning. Naming it
 * semantic would be the same fabrication as a confidence score with nothing
 * behind it: the label would promise a capability the code does not have, and
 * the first person to rely on it would be misled by us rather than by the
 * data.
 *
 * What it genuinely improves on is real. The previous implementation was
 * `content.includes(needle)`, which cannot rank, cannot handle word order, and
 * misses a document that says every query term in a different sentence. BM25
 * ranks by how *distinctive* a matched term is (a term in every record carries
 * almost no signal) and damps repetition, so one document repeating a word
 * fifty times does not bury a better one.
 *
 * ## The seam for real semantics
 *
 * `EmbeddingProvider` below is the interface a semantic backend would satisfy.
 * It is declared and deliberately not implemented here.
 *
 * The reference implementations worth learning from (anything-llm ships twelve)
 * either call a paid API or download a ~90MB ONNX model and pull in a native
 * runtime. Both break something this project holds to: free-tier-only providers
 * (ADR 0011), zero dependencies, and a default path that works offline with no
 * credential. So the seam exists, the lexical ranker is the default, and
 * filling the seam is a deliberate decision someone makes later with the
 * trade-off in front of them.
 */

/** Lowercased terms of 2+ characters, Unicode-aware. */
export function terms(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}

export interface RankableDocument {
  readonly id: string;
  readonly text: string;
}

export interface RankedDocument {
  readonly id: string;
  readonly score: number;
}

/** BM25 constants at their standard values; nothing here is tuned to a corpus. */
const K1 = 1.2;
const B = 0.75;

/**
 * Ranks documents against a query, best first.
 *
 * Documents matching no query term are dropped rather than returned with a
 * zero score: "no result" and "a very bad result" are different answers, and
 * a caller taking the top N should not be handed noise to pad the list.
 */
export function rankByRelevance(params: {
  readonly query: string;
  readonly documents: readonly RankableDocument[];
}): readonly RankedDocument[] {
  const queryTerms = [...new Set(terms(params.query))];
  if (queryTerms.length === 0 || params.documents.length === 0) return [];

  const tokenised = params.documents.map((doc) => ({ doc, tokens: terms(doc.text) }));
  const totalLength = tokenised.reduce((sum, d) => sum + d.tokens.length, 0);
  const averageLength = totalLength / tokenised.length || 1;

  // How many documents contain each term, for the inverse document frequency.
  const containing = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const { tokens } of tokenised) if (tokens.includes(term)) count += 1;
    containing.set(term, count);
  }

  const scored: RankedDocument[] = [];
  for (const { doc, tokens } of tokenised) {
    const frequency = new Map<string, number>();
    for (const token of tokens) frequency.set(token, (frequency.get(token) ?? 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const occurrences = frequency.get(term) ?? 0;
      if (occurrences === 0) continue;

      const n = containing.get(term) ?? 0;
      // Standard BM25 IDF with the +1 that keeps it positive even for a term
      // present in every document -- without it a common term scores negative
      // and actively pushes down documents that match it.
      const idf = Math.log(1 + (tokenised.length - n + 0.5) / (n + 0.5));
      const norm = 1 - B + (B * tokens.length) / averageLength;
      score += idf * ((occurrences * (K1 + 1)) / (occurrences + K1 * norm));
    }

    if (score > 0) scored.push({ id: doc.id, score: Number(score.toFixed(6)) });
  }

  // Ties break on id so the order is stable across runs -- an unstable ranking
  // makes a retrieval regression impossible to reproduce.
  return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * The seam a real semantic backend would fill. Declared, not implemented.
 *
 * Any implementation costs either a credential or a model download, so the
 * choice belongs to a deployment rather than to this file.
 */
export interface EmbeddingProvider {
  readonly id: string;
  /** Vectors for a batch of texts, in the order given. */
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}
