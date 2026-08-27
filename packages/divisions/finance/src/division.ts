/**
 * The Finance Division (spec §4).
 *
 * A bundle, not an execution path (ADR 0013). It registers its agents and its
 * tool into the host registries and then gets out of the way: work still flows
 * User -> Supervisor -> Agent, and Finance has no `dispatch()` of its own.
 *
 * `entryPoints` is narrower than the roster on purpose (§3.2). Other divisions
 * address the CFO or FP&A; they do not reach past them into internal stages.
 */
import {
  type Division,
  type DivisionDescriptor,
  type DivisionInstaller,
  type Result,
  ok,
} from '@nexus/core';
import {
  FINANCE_DIVISION_ID,
  FINANCE_FPA_ID,
  createFinanceAnalyst,
  type FinanceAnalystOptions,
} from './agent.ts';
import { FINANCE_ACTUALS_CAPABILITY, createActualsTool, type ActualsSource } from './tool.ts';

export const financeDescriptor: DivisionDescriptor = {
  id: FINANCE_DIVISION_ID,
  displayName: 'Finance',
  description:
    'The continuous forecast lifecycle: validated actuals, variance, driver ' +
    'attribution, immutable forecast vintages, weighted scenarios, and ' +
    'recommendations that carry their basis.',
  version: '1.0.0',
  // Only agents that are actually registered. §4.1 lists eleven further
  // specialists; they are not implemented, so they are not claimed here.
  agents: [FINANCE_FPA_ID],
  entryPoints: ['fpa'],
  requiredCapabilities: [
    'tool:execute',
    FINANCE_ACTUALS_CAPABILITY,
    'memory:read',
    'memory:write',
  ],
};

export interface CreateFinanceDivisionOptions extends FinanceAnalystOptions {
  readonly actuals: ActualsSource;
}

export function createFinanceDivision(options: CreateFinanceDivisionOptions): Division {
  return {
    descriptor: financeDescriptor,

    install(installer: DivisionInstaller): Result<void> {
      const agent = installer.registerAgent(createFinanceAnalyst(options));
      if (!agent.ok) return agent;

      const tool = installer.registerTool(createActualsTool({ source: options.actuals }));
      if (!tool.ok) return tool;

      return ok(undefined);
    },

    async health() {
      return {
        component: `division:${FINANCE_DIVISION_ID}`,
        status: 'healthy' as const,
        checkedAt: new Date().toISOString(),
        detail: 'deterministic; no provider, no network, no cost',
      };
    },
  };
}
