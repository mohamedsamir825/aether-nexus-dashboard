/**
 * Contradiction detection.
 *
 * ## Scope, stated plainly
 *
 * General natural-language contradiction detection is unsolved, and pretending
 * otherwise would be worse than doing less. This does two narrow, checkable
 * things to claims that share a subject:
 *
 *   1. POLARITY  one asserts, another negates ("is", "is not")
 *   2. QUANTITY  both state a number for the same subject, and they differ
 *
 * That is all. It will miss paraphrased disagreement, disagreement expressed
 * without a negation marker, and anything requiring world knowledge. Those
 * misses are a known limitation, not a bug to be papered over with a model call
 * that would make the result non-deterministic.
 *
 * What it must never do -- and does not -- is merge conflicting claims or
 * average their confidence. A detected conflict stays in the result as a
 * conflict (§19.2).
 */
import { type Claim, type ClaimId, type Contradiction, contradictionId } from '@nexus/core';

/** Negation markers, English and Arabic. */
const NEGATIONS = [
  'not', "n't", 'never', 'no longer', 'cannot', 'failed to', 'did not', 'does not',
  'ليس', 'لا ', 'لم ', 'لن ', 'غير ',
];

export function hasNegation(statement: string): boolean {
  const lowered = statement.toLowerCase();
  return NEGATIONS.some((marker) => lowered.includes(marker));
}

/** Numbers in a statement, ignoring years, which are usually context not value. */
export function numbersIn(statement: string): number[] {
  const found = statement.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
  return found
    .map((raw) => Number(raw.replace(',', '.')))
    .filter((n) => Number.isFinite(n) && !(n >= 1900 && n <= 2100 && Number.isInteger(n)));
}

export interface DetectOptions {
  readonly claims: readonly Claim[];
  readonly now: () => Date;
}

export function detectContradictions(options: DetectOptions): readonly Contradiction[] {
  const detectedAt = options.now().toISOString();
  const found: Contradiction[] = [];

  // Only claims that assert something are compared. An `uncertain` claim says
  // nothing to disagree with.
  const comparable = options.claims.filter(
    (c) => c.status === 'fact' || c.status === 'inference',
  );

  const bySubject = new Map<string, Claim[]>();
  for (const claim of comparable) {
    const group = bySubject.get(claim.subject) ?? [];
    group.push(claim);
    bySubject.set(claim.subject, group);
  }

  for (const [subject, group] of bySubject) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (!a || !b) continue;

        const reason = conflictReason(a.statement, b.statement);
        if (!reason) continue;

        found.push({
          id: contradictionId(`ct_${a.id}_${b.id}`),
          subject,
          claims: [a.id, b.id] as readonly ClaimId[],
          reason,
          detectedAt,
        });
      }
    }
  }

  return found;
}

function conflictReason(left: string, right: string): string | undefined {
  if (hasNegation(left) !== hasNegation(right)) {
    return 'one claim asserts what the other negates';
  }

  const leftNumbers = numbersIn(left);
  const rightNumbers = numbersIn(right);
  if (leftNumbers.length > 0 && rightNumbers.length > 0) {
    const [a] = leftNumbers;
    const [b] = rightNumbers;
    if (a !== undefined && b !== undefined && a !== b) {
      return `the claims state different values for the same subject (${a} vs ${b})`;
    }
  }

  return undefined;
}

/**
 * Marks every claim caught in a contradiction, so a conflict is visible on the
 * claim itself and not only in a separate list a caller might not read.
 */
export function markContradicted(
  claims: readonly Claim[],
  contradictions: readonly Contradiction[],
): readonly Claim[] {
  if (contradictions.length === 0) return claims;
  const conflicted = new Set(contradictions.flatMap((c) => c.claims));

  return claims.map((claim) => {
    if (!conflicted.has(claim.id)) return claim;
    // Confidence is reduced, never zeroed: the claim is still what the source
    // said. What changed is our confidence that it settles the matter.
    return { ...claim, confidence: Math.min(claim.confidence, 0.4) };
  });
}
