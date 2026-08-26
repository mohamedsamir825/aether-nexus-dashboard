/**
 * Wraps a ModelRouter so every generation is charged against the run's budget.
 *
 * The router itself is deliberately context-free (it serves the whole system),
 * so enforcement lives in a per-run wrapper -- the same shape as ToolBelt, which
 * wraps the tool registry for one agent. The Supervisor builds one of these per
 * run and hands it to the agent as `context.models`.
 */
import type { Result } from '../result.ts';
import type {
  ModelRouter,
  ModelSelection,
  ModelSelectionPolicy,
  RoutedGenerationRequest,
} from '../contracts/model-router.ts';
import type { GenerationResponse } from '../contracts/model-provider.ts';
import type { BudgetGuard } from '../contracts/execution.ts';

export function createBudgetedRouter(router: ModelRouter, guard: BudgetGuard): ModelRouter {
  return {
    // Routing resolves a policy without calling a model, so it costs nothing
    // and is not charged -- only the deadline applies.
    async route(policy: ModelSelectionPolicy): Promise<Result<ModelSelection>> {
      const deadline = guard.checkDeadline();
      if (!deadline.ok) return deadline;
      return router.route(policy);
    },

    async generate(
      policy: ModelSelectionPolicy,
      request: RoutedGenerationRequest,
    ): Promise<Result<GenerationResponse>> {
      const charged = guard.chargeModelCall();
      if (!charged.ok) return charged;
      return router.generate(policy, request);
    },
  };
}
