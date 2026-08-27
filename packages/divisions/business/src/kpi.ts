/**
 * Business KPIs (spec §5) — and why none of them computes yet.
 *
 * §5 names four: decision quality reviewed after outcomes are known; strategic
 * surprises not anticipated; opportunities identified that were acted on; time
 * from market signal to briefing.
 *
 * Finance's file implements four of its five. This one implements none, and
 * that is the finding rather than an omission: every §5 KPI needs a fact about
 * something *outside* this division — what the user decided, what actually
 * happened, when a signal first arrived — and NEXUS has no authoritative source
 * for any of them. §4.3's "user decision" stage is not built.
 *
 * ## What was built instead
 *
 * `deliberation.ts` now records the artifact each of these will one day be
 * computed from. Persisting it does not make any of them computable, and this
 * file exists so that nobody later mistakes a full archive for a measurable
 * one. The census below is the honest reading of that archive: it counts
 * states, and today every record is in exactly one of them.
 *
 * A KPI that quietly reports a plausible number nobody can check is worse than
 * a missing one, because it will be believed.
 */
import { deliberationState, type Deliberation } from './deliberation.ts';

/**
 * How many framings are in each state.
 *
 * A census, not a KPI. `selected: 0` here means **nothing is recorded as
 * chosen**, never "the user chose nothing" — the distinction the whole module
 * turns on, carried through to the count so a reader cannot lose it.
 */
export interface DeliberationTally {
  readonly presented: number;
  readonly evaluated: number;
  readonly selected: number;
  readonly outcomeKnown: number;
  readonly outcomeUnattributed: number;
}

export function tallyDeliberations(
  deliberations: readonly Deliberation[],
): DeliberationTally {
  const kinds = deliberations.map((d) => deliberationState(d).kind);
  return {
    presented: kinds.filter((k) => k === 'presented').length,
    evaluated: kinds.filter((k) => k === 'evaluated').length,
    selected: kinds.filter((k) => k === 'selected').length,
    outcomeKnown: kinds.filter((k) => k === 'outcome-known').length,
    outcomeUnattributed: kinds.filter((k) => k === 'outcome-unattributed').length,
  };
}

/**
 * Deliberately not implemented, with what each one is actually waiting on.
 *
 * Named individually rather than as "KPIs pending", because the four are
 * blocked on three different missing things and lumping them together would
 * hide that three of them unblock the moment a decision is recorded.
 */
export const BLOCKED_KPIS = [
  'decision quality reviewed after outcomes are known — needs a recorded decision AND a recorded outcome',
  'opportunities identified that were acted on — needs a recorded decision; framings alone cannot show adoption',
  'strategic surprises not anticipated — needs an authoritative record of what happened, the way Finance has actuals',
  'time from market signal to briefing — needs a signal that arrives independently of the run that asks for it; ' +
    'retrieval performed BY a framing run measures the run, not responsiveness',
] as const;
