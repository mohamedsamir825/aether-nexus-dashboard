/**
 * The Finance agents.
 *
 * §4.3 names four stage owners: Controller (actuals), FP&A (variance, drivers,
 * forecast), Scenario Analysis (weighted paths) and CFO (recommendation).
 *
 * **One agent is registered, not four.** All six lifecycle stages run, but they
 * run inside the FP&A analyst rather than as separate agents handing off to one
 * another. Splitting them would mean four registrations, four permission
 * grants, and three delegations for a pipeline that is pure arithmetic over
 * data with no independent decision at any boundary — cost with no guarantee
 * bought. The stage owners are modelled as stages, and the ids below name the
 * roles so a later phase can split them without renaming anything.
 *
 * The other eleven specialists in §4.1's roster are not implemented and are not
 * registered: a roster entry that resolves to nothing is a fake implementation,
 * which is worse than an honest gap.
 *
 * The FP&A analyst runs the lifecycle. It owns no infrastructure: actuals come
 * through `context.tools`, so they pass the ToolBelt gates and are charged to
 * the budget, and everything after that is pure arithmetic over data.
 */
import {
  type AgentContext,
  type AgentResult,
  type AnyAgent,
  type Result,
  type RunId,
  agentId,
  divisionId,
  emptyUsage,
  err,
  nexusError,
  ok,
} from '@nexus/core';
import { createForecastLedger, type ForecastLedger } from './ledger.ts';
import { runLifecycle } from './lifecycle.ts';
import type { ScenarioSpec } from './forecast.ts';
import { FINANCE_ACTUALS_TOOL_ID, type ActualsOutput } from './tool.ts';
import type { FinanceRequest, FinanceResult, ForecastVintage } from './types.ts';

export const FINANCE_DIVISION_ID = divisionId('finance');

/** Registered. Runs every lifecycle stage. */
export const FINANCE_FPA_ID = agentId('finance.fpa');
/** Named for the stages they own in §4.3; not registered as separate agents yet. */
export const FINANCE_CFO_ID = agentId('finance.cfo');
export const FINANCE_CONTROLLER_ID = agentId('finance.controller');
export const FINANCE_SCENARIO_ID = agentId('finance.scenario');

/**
 * How a line item responds to a driver. The owner's model, supplied as
 * configuration rather than inferred — an inferred sensitivity would be a
 * number this system invented and then treated as the owner's.
 */
export type SensitivityModel = Readonly<Record<string, Readonly<Record<string, number>>>>;

export interface FinanceAnalystOptions {
  readonly ledger?: ForecastLedger;
  readonly sensitivities: SensitivityModel;
  readonly scenarios?: readonly ScenarioSpec[];
  readonly horizon: readonly string[];
  /** Driver values observed with the actuals, keyed by period. */
  readonly observedDrivers?: Readonly<Record<string, readonly { id: string; value: number }[]>>;
}

function isFinanceRequest(input: unknown): input is FinanceRequest {
  if (typeof input !== 'object' || input === null) return false;
  const candidate = input as Partial<FinanceRequest>;
  return (
    typeof candidate.question === 'string' &&
    candidate.question.trim() !== '' &&
    typeof candidate.baseline === 'object' &&
    candidate.baseline !== null &&
    typeof (candidate.baseline as ForecastVintage).id === 'string' &&
    Array.isArray((candidate.baseline as ForecastVintage).amounts)
  );
}

/** The narrative is derived from the structured result. Never the reverse. */
function narrate(result: Omit<FinanceResult, 'narrative'>): string {
  const lines: string[] = [`Question: ${result.request.question}`, ''];

  const material = result.variances.filter((v) => v.material);
  if (material.length === 0) {
    lines.push('No material variance. The forecast stands, and was not revised.');
    return lines.join('\n');
  }

  lines.push(`Material variances (${material.length}):`);
  for (const v of material) {
    lines.push(`  - ${v.lineItem} ${v.period}: ${v.actual} vs ${v.forecast} (${v.delta}) — ${v.reason}`);
  }

  if (result.attributions.length > 0) {
    lines.push('', 'Driver attribution:');
    for (const a of result.attributions) {
      const explained = a.total - a.unexplained;
      lines.push(`  - ${a.lineItem}: ${explained} explained, ${a.unexplained} unexplained`);
    }
  }

  if (result.revised === null) {
    lines.push('', 'The forecast was NOT revised: no driver movement accounts for the variance.');
  } else {
    lines.push(
      '',
      `Revised forecast: vintage ${result.revised.id} (v${result.revised.version}, ` +
        `supersedes ${result.revised.supersedes ?? 'nothing'}), confidence ${result.revised.confidence}.`,
    );
  }

  if (result.recommendations.length > 0) {
    lines.push('', 'Recommendations:');
    for (const r of result.recommendations) {
      lines.push(`  - ${r.claim.statement}`);
      lines.push(`    resting on ${r.claim.assumptions.length} stated assumption(s)`);
    }
  }

  return lines.join('\n');
}

export function createFinanceAnalyst(options: FinanceAnalystOptions): AnyAgent {
  const sensitivity = (lineItem: string, driver: string): number | undefined =>
    options.sensitivities[lineItem]?.[driver];

  return {
    descriptor: {
      id: FINANCE_FPA_ID,
      division: FINANCE_DIVISION_ID,
      role: 'fpa',
      displayName: 'FP&A Manager',
      description:
        'Runs the continuous forecast lifecycle: variance, driver attribution, ' +
        'forecast vintage update, scenarios, and a recommendation carrying its basis.',
      version: '1.0.0',
      skills: [],
      tools: [FINANCE_ACTUALS_TOOL_ID],
      capabilities: ['tool:execute', 'finance:actuals'],
      memoryScopes: [],
      modelPolicy: { requiredCapabilities: ['text'], allowFallback: true },
    },

    async handle(task, context: AgentContext): Promise<Result<AgentResult>> {
      if (!isFinanceRequest(task.input)) {
        return err(
          nexusError('INVALID_INPUT', 'a finance task needs a question and a baseline forecast', {
            details: { taskId: task.id },
          }),
        );
      }

      const request: FinanceRequest = task.input;
      const runId: RunId = context.runId;
      const now = () => context.clock.now();

      // --- stage 1: actuals, through the ToolBelt ---------------------------
      const loaded = await context.tools.invoke<ActualsOutput>(
        { toolId: FINANCE_ACTUALS_TOOL_ID, input: { period: request.actuals.period } },
        context,
      );
      if (!loaded.ok) return loaded;
      const actuals = loaded.value.output.actuals;
      const actualsEvidence = loaded.value.evidence ?? [];

      // The ledger starts from the baseline the caller committed to, so the
      // revision chain is anchored to a real prior position.
      const ledger = options.ledger ?? createForecastLedger({ initial: [request.baseline] });

      const outcome = runLifecycle({
        actuals,
        actualsEvidence: actualsEvidence.map((e) => e.id),
        baseline: request.baseline,
        ledger,
        ...(request.materiality !== undefined ? { materiality: request.materiality } : {}),
        observed: options.observedDrivers?.[actuals.period] ?? [],
        sensitivity,
        scenarios: options.scenarios ?? [],
        horizon: options.horizon,
        runId,
        actor: FINANCE_FPA_ID,
        now,
      });
      if (!outcome.ok) return outcome;

      const partial = {
        request,
        variances: outcome.value.variances,
        attributions: outcome.value.attributions,
        revised: outcome.value.revised,
        scenarios: outcome.value.scenarios,
        recommendations: outcome.value.recommendations,
        vintages: ledger.all(),
      };

      const result: FinanceResult = { ...partial, narrative: narrate(partial) };

      const material = outcome.value.variances.filter((v) => v.material).length;
      return ok({
        output: result,
        summary:
          `${material} material variance(s); ` +
          (outcome.value.revised === null
            ? 'forecast not revised'
            : `revised to vintage v${outcome.value.revised.version}`) +
          `; ${outcome.value.recommendations.length} recommendation(s)`,
        // The Controller's validation of the actuals, which is what every
        // variance claim cites. Market inputs will add to this when Finance
        // delegates to Research for them.
        evidence: actualsEvidence,
        usage: { ...emptyUsage, toolCalls: 1 },
      });
    },

    async health() {
      return {
        component: `agent:${FINANCE_FPA_ID}`,
        status: 'healthy' as const,
        checkedAt: new Date().toISOString(),
        detail: 'deterministic lifecycle; no provider required',
      };
    },
  };
}
