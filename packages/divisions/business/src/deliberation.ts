/**
 * What Business remembers: the framing it presented, and nothing it did not.
 *
 * §5's KPIs — "decision quality reviewed after outcomes are known",
 * "opportunities identified that were acted on" — all need a decision or an
 * outcome. Neither exists in NEXUS, and §4.3's "user decision" stage is not
 * built. This module therefore records the *artifact* those KPIs will one day
 * be computed from, and records the absence of everything else explicitly.
 *
 * ## Five states, and only one of them is ever true here
 *
 *   1. an option set existed        <- recording one makes this true
 *   2. it was evaluated by someone  <- no source exists
 *   3. an option was selected       <- no source exists
 *   4. an outcome occurred          <- no source exists
 *   5. the outcome is unknown       <- the honest default for 2-4
 *
 * A record whose `selectedOptionId` is null means **nobody wrote down a
 * choice**. It does not mean no choice was made. Those are different facts and
 * conflating them would let a future KPI report "0% of options acted on" from
 * an empty archive — the same failure the Finance surprise KPI was built to
 * avoid, in a different division.
 *
 * `deliberationState()` exists so callers read the state through a function
 * that cannot be misread, rather than by testing nulls and guessing.
 */
import {
  type MemoryScope,
  type Result,
  type ScopedVersionedMemory,
  err,
  nexusError,
  ok,
} from '@nexus/core';
import type { OptionSet } from './types.ts';

/** Business's own division scope (§12.1, "Owning division"). */
export const BUSINESS_MEMORY_SCOPE: MemoryScope = { kind: 'division', id: 'business' };

/**
 * Identity for one strategic question across re-framings.
 *
 * Derived from the question text, so asking the same question again supersedes
 * the earlier framing rather than sitting beside it as an unrelated record.
 *
 * Known limitation, stated rather than hidden: the same question in different
 * words yields a different key and a separate chain. Normalising that needs a
 * controlled vocabulary or a model call, and both are worse than an honest
 * limit — the same trade-off `Claim.subject` already makes.
 */
export function deliberationKey(question: string): string {
  const slug = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return `deliberation:${slug}`;
}

/**
 * A recorded framing.
 *
 * Every field after `presentedAt` is `null` and stays null until something
 * authoritative fills it. Nothing in this package may set them: Business
 * framed the options and is precisely the party that must not decide.
 */
export interface Deliberation {
  readonly optionSet: OptionSet;
  /** When the framing was put on record. */
  readonly presentedAt: string;
  /** The run that produced it, so the framing traces back to its evidence. */
  readonly runId: string;
  /**
   * null = NOT RECORDED. Never "was not evaluated".
   *
   * Filling this requires a source that observes the user reviewing the set.
   * No such source exists, and inventing one would fabricate the very data
   * §5's first KPI is supposed to measure.
   */
  readonly evaluatedAt: string | null;
  /** null = NOT RECORDED. Never "nothing was chosen". */
  readonly selectedOptionId: string | null;
  /** null = NOT RECORDED. Never "nothing happened". */
  readonly outcome: string | null;
}

/**
 * What is actually known about a deliberation.
 *
 * A discriminated answer rather than three nullable fields a caller has to
 * interpret. `presented` is the only state this system can currently reach,
 * and saying so in a type is what stops a later reader assuming the rest.
 */
export type DeliberationState =
  /** The framing exists. Nothing else is on record. */
  | { readonly kind: 'presented'; readonly at: string }
  /** Someone reviewed it. Requires a source that does not exist yet. */
  | { readonly kind: 'evaluated'; readonly at: string }
  /** An option was chosen. Requires a source that does not exist yet. */
  | { readonly kind: 'selected'; readonly optionId: string; readonly at: string }
  /** And the result is known. Requires a source that does not exist yet. */
  | { readonly kind: 'outcome-known'; readonly optionId: string; readonly outcome: string }
  /**
   * A result is recorded but not which option produced it.
   *
   * Real, not defensive: knowing how something turned out while never having
   * written down which way it was decided is an ordinary way for a record to
   * be incomplete. It gets its own state because the alternatives are both
   * lies -- naming an option would invent the decision, and reporting
   * `presented` would drop an outcome that is genuinely on record.
   */
  | { readonly kind: 'outcome-unattributed'; readonly outcome: string };

export function deliberationState(deliberation: Deliberation): DeliberationState {
  // Read outward-in: the most complete state that is actually recorded wins,
  // and anything missing simply stops the ladder rather than being guessed.
  if (deliberation.outcome !== null && deliberation.selectedOptionId === null) {
    return { kind: 'outcome-unattributed', outcome: deliberation.outcome };
  }
  if (deliberation.outcome !== null && deliberation.selectedOptionId !== null) {
    return {
      kind: 'outcome-known',
      optionId: deliberation.selectedOptionId,
      outcome: deliberation.outcome,
    };
  }
  if (deliberation.selectedOptionId !== null) {
    return {
      kind: 'selected',
      optionId: deliberation.selectedOptionId,
      at: deliberation.evaluatedAt ?? deliberation.presentedAt,
    };
  }
  if (deliberation.evaluatedAt !== null) {
    return { kind: 'evaluated', at: deliberation.evaluatedAt };
  }
  return { kind: 'presented', at: deliberation.presentedAt };
}

/**
 * Persists a framing.
 *
 * `validFrom` is the option set's own `createdAt` — when Business actually
 * presented it. Stamping it with the write time would make a later "what was
 * on the table in March" answer with something written in June.
 */
export async function rememberDeliberation(params: {
  readonly memory: ScopedVersionedMemory;
  readonly optionSet: OptionSet;
  readonly runId: string;
}): Promise<Result<Deliberation>> {
  const deliberation: Deliberation = {
    optionSet: params.optionSet,
    presentedAt: params.optionSet.createdAt,
    runId: params.runId,
    // Recorded as unknown, because they are.
    evaluatedAt: null,
    selectedOptionId: null,
    outcome: null,
  };

  const written = await params.memory.remember({
    scope: BUSINESS_MEMORY_SCOPE,
    kind: 'episode',
    content:
      `${params.optionSet.options.length} option(s) presented for: ${params.optionSet.question}`,
    key: deliberationKey(params.optionSet.question),
    reason: `framing presented with ${params.optionSet.options.length} option(s)`,
    tags: ['business:deliberation', ...params.optionSet.options.map((o) => `option:${o.id}`)],
    sourceRunId: params.runId,
    validFrom: params.optionSet.createdAt,
    metadata: { deliberation },
  });
  if (!written.ok) return written;
  return ok(deliberation);
}

/**
 * The framing that was on record at a point in time.
 *
 * Null means nothing was — which a caller must not read as "no options were
 * ever presented", only as "none is recorded for that moment".
 */
export async function deliberationAsOf(params: {
  readonly memory: ScopedVersionedMemory;
  readonly question: string;
  readonly at: string;
}): Promise<Result<Deliberation | null>> {
  const found = await params.memory.asOf(
    BUSINESS_MEMORY_SCOPE,
    deliberationKey(params.question),
    params.at,
  );
  if (!found.ok) return found;
  if (found.value === null) return ok(null);
  return parse(found.value.metadata?.['deliberation'], found.value.id);
}

/** Every framing of one question, oldest first. */
export async function deliberationHistory(params: {
  readonly memory: ScopedVersionedMemory;
  readonly question: string;
}): Promise<Result<readonly Deliberation[]>> {
  const history = await params.memory.history(
    BUSINESS_MEMORY_SCOPE,
    deliberationKey(params.question),
  );
  if (!history.ok) return history;

  const out: Deliberation[] = [];
  for (const window of history.value) {
    const parsed = parse(window.record.metadata?.['deliberation'], window.record.id);
    if (!parsed.ok) return parsed;
    if (parsed.value !== null) out.push(parsed.value);
  }
  return ok(out);
}

/**
 * Refuses rather than skips.
 *
 * An unreadable framing silently dropped would make the archive look thinner
 * than it is, and a KPI counting what is there would quietly undercount.
 */
function parse(stored: unknown, recordId: string): Result<Deliberation | null> {
  if (!isDeliberation(stored)) {
    return err(
      nexusError('INTERNAL', `stored deliberation '${recordId}' is unreadable`, {
        details: { recordId },
      }),
    );
  }
  return ok(stored);
}

function isDeliberation(value: unknown): value is Deliberation {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Partial<Deliberation>;
  return (
    typeof d.presentedAt === 'string' &&
    typeof d.runId === 'string' &&
    typeof d.optionSet === 'object' &&
    d.optionSet !== null &&
    // Present and explicitly nullable -- absent is not the same as null, and a
    // record missing the field entirely is malformed rather than "unknown".
    'evaluatedAt' in d &&
    'selectedOptionId' in d &&
    'outcome' in d
  );
}
