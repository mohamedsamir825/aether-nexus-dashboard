/**
 * Budget enforcement.
 *
 * `ExecutionBudget` was defined in Phase 1 and carried through delegation, but
 * nothing checked it -- so a delegation chain had no real ceiling. This is the
 * enforcement (spec §13.3, §18.2).
 *
 * One guard per top-level dispatch, shared with every child context. Charging
 * happens BEFORE the work, so a refused call costs nothing. An unset budget
 * field means "no limit for this dimension", never zero.
 */
import { type Result, ok, err } from '../result.ts';
import { nexusError } from '../errors.ts';
import { type Clock, systemClock } from '../clock.ts';
import type { BudgetGuard, BudgetUsage, ExecutionBudget } from '../contracts/execution.ts';

export function createBudgetGuard(
  budget: ExecutionBudget,
  clock: Clock = systemClock,
): BudgetGuard {
  const startedAt = clock.now().getTime();
  let modelCalls = 0;
  let toolCalls = 0;

  const elapsed = (): number => clock.now().getTime() - startedAt;

  const exceeded = (dimension: string, limit: number, attempted: number) =>
    err(
      nexusError('BUDGET_EXCEEDED', `execution budget exceeded: ${dimension}`, {
        details: { dimension, limit, attempted },
      }),
    );

  const checkDeadline = (): Result<void> => {
    const { timeoutMs } = budget;
    if (timeoutMs === undefined) return ok(undefined);
    const spent = elapsed();
    if (spent >= timeoutMs) return exceeded('timeoutMs', timeoutMs, spent);
    return ok(undefined);
  };

  return {
    budget,

    chargeModelCall() {
      // The deadline is checked on every charge: a run that has run out of time
      // must not be able to spend its remaining call allowance.
      const deadline = checkDeadline();
      if (!deadline.ok) return deadline;

      const { maxModelCalls } = budget;
      if (maxModelCalls !== undefined && modelCalls >= maxModelCalls) {
        return exceeded('maxModelCalls', maxModelCalls, modelCalls + 1);
      }
      modelCalls += 1;
      return ok(undefined);
    },

    chargeToolCall() {
      const deadline = checkDeadline();
      if (!deadline.ok) return deadline;

      const { maxToolCalls } = budget;
      if (maxToolCalls !== undefined && toolCalls >= maxToolCalls) {
        return exceeded('maxToolCalls', maxToolCalls, toolCalls + 1);
      }
      toolCalls += 1;
      return ok(undefined);
    },

    checkDeadline,

    get usage(): BudgetUsage {
      return { modelCalls, toolCalls, elapsedMs: elapsed() };
    },
  };
}

/** A guard with no limits. For tests and for callers that opt out explicitly. */
export function unlimitedBudgetGuard(clock: Clock = systemClock): BudgetGuard {
  return createBudgetGuard({}, clock);
}
