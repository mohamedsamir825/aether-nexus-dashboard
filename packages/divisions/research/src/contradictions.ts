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

/**
 * Negation markers, matched as WHOLE WORDS.
 *
 * Substring matching was the original implementation and it was badly wrong:
 * "another", "nothing", "notable", "note" and "notice" all contain "not", and
 * "nevertheless" contains "never". Since agreement between sources is commonly
 * phrased "another source states...", the detector invented conflicts between
 * claims that agreed — the worst possible failure for a research system, which
 * exists to be trusted about disagreement.
 */
const NEGATION_WORDS = new Set([
  // English particles
  'not', 'never', 'cannot', 'no', 'none', 'neither', 'nor',
  // Arabic particles
  'ليس', 'ليست', 'لا', 'لم', 'لن', 'غير',
]);

/** Multi-word markers, matched against the tokenised statement. */
const NEGATION_PHRASES = ['no longer', 'failed to', 'ruled out'];

/** Unicode-aware word tokens. Diacritics are dropped with the marks class. */
function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

export function hasNegation(statement: string): boolean {
  const tokens = words(statement);
  for (const token of tokens) {
    if (NEGATION_WORDS.has(token)) return true;
    // Contractions: isn't, don't, wasn't ...
    if (token.endsWith("n't")) return true;
  }
  const joined = ` ${tokens.join(' ')} `;
  return NEGATION_PHRASES.some((phrase) => joined.includes(` ${phrase} `));
}

/**
 * Numbers in a statement, normalised.
 *
 * A comma is a thousands separator when exactly three digits follow it
 * ("1,234" is one thousand two hundred and thirty-four) and a decimal point
 * otherwise ("2,5" is two and a half). Reading every comma as a decimal point
 * was the original behaviour and it turned "1,234 seals" into 1.234 — so a
 * source writing "1,234" and one writing "1234" were reported as CONFLICTING
 * when they agreed exactly.
 *
 * Years are skipped: a date is context, not a quantity being asserted.
 */
export function numbersIn(statement: string): number[] {
  const found = statement.match(/-?\d[\d.,]*/g) ?? [];
  return found
    .map(normaliseNumber)
    .filter((n): n is number => n !== undefined)
    .filter((n) => !(n >= 1900 && n <= 2100 && Number.isInteger(n)));
}

function normaliseNumber(raw: string): number | undefined {
  let text = raw.replace(/[.,]$/, '');

  // Grouped thousands: 1,234 or 1,234,567 (and the European 1.234.567).
  if (/^-?\d{1,3}(,\d{3})+$/.test(text)) text = text.replace(/,/g, '');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  // Otherwise a lone comma is a decimal point.
  else text = text.replace(',', '.');

  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
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
