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
  type ScopedVersionedMemory,
  mergeUsage,
  nexusError,
  ok,
} from '@nexus/core';
import { createForecastLedger, type ForecastLedger } from './ledger.ts';
import { runLifecycle } from './lifecycle.ts';
import { financeKpis } from './kpi.ts';
import { sourceMarketInputs } from './market.ts';
import { FINANCE_MEMORY_SCOPE, rememberVintage, restoreLedger } from './persistence.ts';
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
  /**
   * Durable forecast history, pre-scoped by the composition root.
   *
   * `AgentContext.memory` carries the plain `ScopedMemory` surface, which has
   * no `asOf` or `history` -- and adding them would be a Core contract change.
   * So the versioned view arrives here instead, already narrowed to Finance's
   * scope with a capability checked on every access, built the same way the
   * Supervisor builds the plain one. Absent means this division runs without
   * history, exactly as it did before Phase 10.
   */
  readonly versionedMemory?: ScopedVersionedMemory;
  /** Names the forecast line, so several do not share one chain. */
  readonly ledgerName?: string;
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

  if (result.unsourcedMarketDrivers.length > 0) {
    lines.push(
      `Unsourced market drivers: ${result.unsourcedMarketDrivers.join(', ')} — ` +
        'Research returned no evidence for these, so they rest on assumption alone.',
      '',
    );
  }

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
      capabilities: ['tool:execute', 'finance:actuals', 'memory:read', 'memory:write'],
      memoryScopes: [FINANCE_MEMORY_SCOPE],
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
      const ledgerName = options.ledgerName ?? 'default';
      const now = () => context.clock.now();

      // --- stage 1: actuals, through the ToolBelt ---------------------------
      const loaded = await context.tools.invoke<ActualsOutput>(
        { toolId: FINANCE_ACTUALS_TOOL_ID, input: { period: request.actuals.period } },
        context,
      );
      if (!loaded.ok) return loaded;
      const actuals = loaded.value.output.actuals;
      const actualsEvidence = loaded.value.evidence ?? [];

      // --- market inputs, by delegation to Research (§4.3) ------------------
      // Runs through the Supervisor, so the shared budget, the delegation
      // depth bound and the event trail all apply. Finance never reaches
      // Research's pipeline directly.
      const market = await sourceMarketInputs({
        inputs: request.marketInputs ?? [],
        drivers: request.baseline.drivers,
        context,
      });

      const baseline =
        market.drivers === request.baseline.drivers
          ? request.baseline
          : { ...request.baseline, drivers: market.drivers };

      // A ledger restored from memory carries every vintage any earlier run
      // wrote, which is what makes accuracy-per-horizon (§4.2) mean anything:
      // a forecast made in January can be scored against April's actuals only
      // if January's numbers still exist.
      let ledger = options.ledger;
      if (ledger === undefined && options.versionedMemory !== undefined) {
        const restored = await restoreLedger({
          memory: options.versionedMemory,
          ledgerName,
        });
        // An unreadable chain is a real failure. Continuing with a fresh
        // ledger would renumber every vintage after the missing one and make
        // every horizon wrong by an amount nobody could see.
        if (!restored.ok) return restored;
        ledger = restored.value;
      }
      if (ledger === undefined) ledger = createForecastLedger();

      // A ledger with no history is anchored on the caller's baseline -- and
      // the baseline is PERSISTED too. Storing only revisions would leave the
      // next process a chain starting at v2, which the ledger correctly
      // refuses to load, and would lose the position the forecast started
      // from. The first vintage is history as much as any later one.
      if (ledger.head() === null) {
        const seeded = ledger.append(baseline);
        if (!seeded.ok) return seeded;
        if (options.versionedMemory !== undefined) {
          const stored = await rememberVintage({
            memory: options.versionedMemory,
            ledgerName,
            vintage: baseline,
          });
          if (!stored.ok) return stored;
        }
      }

      const outcome = runLifecycle({
        actuals,
        actualsEvidence: actualsEvidence.map((e) => e.id),
        baseline,
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

      // Persisted so the next run -- or the next process -- starts from this
      // position rather than from the caller's baseline.
      let persisted = false;
      if (outcome.value.revised !== null && options.versionedMemory !== undefined) {
        const stored = await rememberVintage({
          memory: options.versionedMemory,
          ledgerName,
          vintage: outcome.value.revised,
        });
        if (!stored.ok) return stored;
        persisted = true;
      }

      const partial = {
        request,
        variances: outcome.value.variances,
        attributions: outcome.value.attributions,
        revised: outcome.value.revised,
        scenarios: outcome.value.scenarios,
        recommendations: outcome.value.recommendations,
        vintages: ledger.all(),
        kpis: financeKpis({
          ledger,
          actuals,
          attributions: outcome.value.attributions,
          revised: outcome.value.revised,
        }),
        unsourcedMarketDrivers: market.unsourced,
        persisted,
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
        // The Controller's validation of the actuals, which every variance
        // claim cites, plus whatever Research supplied for market drivers.
        evidence: [...actualsEvidence, ...market.evidence],
        // One tool call of its own, plus everything the delegated Research
        // runs actually cost.
        usage: mergeUsage(market.usage, { ...emptyUsage, toolCalls: 1 }),
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
