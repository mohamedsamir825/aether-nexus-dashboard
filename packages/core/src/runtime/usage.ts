/**
 * Aggregating usage across a delegation chain.
 *
 * The Supervisor shares one budget guard down a chain, so spend is *enforced*
 * correctly without this. What it does not do is add a delegate's metrics back
 * into the caller's, so an agent that delegates and then reports only its own
 * usage understates the work it caused. The budget still holds; the
 * observability numbers quietly stop being true.
 *
 * ## Cost is the part that needs care
 *
 * `UsageMetrics.costMinorUnits` is optional on purpose, and the contract is
 * explicit about why: it is "omitted -- never zero -- when cost is unknown, so
 * 'free' and 'unmeasured' stay distinguishable" (spec §21).
 *
 * A naive sum destroys exactly that. `undefined + 5` treated as `0 + 5` reports
 * a total of 5 for a chain where one leg's cost was never measured, and the
 * result is indistinguishable from a chain that genuinely cost 5.
 *
 * So cost survives a merge only when **both** sides know theirs. One unknown
 * leg makes the total unknown, because a partial sum presented as a total is
 * the same lie in a different shape.
 */
import type { UsageMetrics } from '../contracts/execution.ts';

export function mergeUsage(a: UsageMetrics, b: UsageMetrics): UsageMetrics {
  const merged: UsageMetrics = {
    modelCalls: a.modelCalls + b.modelCalls,
    toolCalls: a.toolCalls + b.toolCalls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    durationMs: a.durationMs + b.durationMs,
  };

  // Both known -> a real total. Either unknown -> the total is unknown, and
  // saying so is the whole point of the field being optional.
  if (a.costMinorUnits !== undefined && b.costMinorUnits !== undefined) {
    return { ...merged, costMinorUnits: a.costMinorUnits + b.costMinorUnits };
  }
  return merged;
}

/** Folds many usages into one, with the same cost rule applied throughout. */
export function sumUsage(usages: readonly UsageMetrics[]): UsageMetrics {
  return usages.reduce(mergeUsage, {
    modelCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    // Starts known-and-zero so a fold over all-known usages stays known. The
    // first unknown leg drops it, which is correct: one unmeasured cost makes
    // the total unmeasured.
    costMinorUnits: 0,
  });
}
