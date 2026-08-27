/**
 * Deterministic Finance fixtures. No network, no model, no cost.
 *
 * The numbers are a small, checkable P&L: revenue driven by units and price,
 * COGS driven by units and unit cost. Every expected value in the tests can be
 * recomputed by hand, which is the point — a variance test whose expected value
 * came out of the code it tests proves nothing.
 */
import { agentId, runId } from '@nexus/core';
import type { Actuals, ForecastVintage } from '../src/types.ts';
import type { SensitivityModel } from '../src/agent.ts';

export const RUN = runId('run_fin');
export const FPA = agentId('finance.fpa');
export const fixedNow = () => new Date('2026-06-01T12:00:00Z');

export const HORIZON = ['2026-Q1', '2026-Q2'];

/**
 * revenue = units × price, cogs = units × unitCost.
 * Baseline: 1000 units at 50 = 50,000 revenue; at cost 30 = 30,000 COGS.
 */
export const SENSITIVITIES: SensitivityModel = {
  revenue: { units: 50, price: 1_000 },
  cogs: { units: 30, unitCost: 1_000 },
};

export const BASELINE: ForecastVintage = {
  id: 'fv_base',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: FPA,
  runId: RUN,
  supersedes: null,
  reason: 'opening plan for FY26',
  drivers: [
    { id: 'units', displayName: 'Units sold', value: 1_000, basis: 'FY25 run rate' },
    { id: 'price', displayName: 'Average price', value: 50, basis: 'list price, no discounting' },
    { id: 'unitCost', displayName: 'Unit cost', value: 30, basis: 'supplier contract' },
  ],
  amounts: [
    { lineItem: 'revenue', period: '2026-Q1', value: 50_000, origin: 'forecast' },
    { lineItem: 'revenue', period: '2026-Q2', value: 50_000, origin: 'forecast' },
    { lineItem: 'cogs', period: '2026-Q1', value: 30_000, origin: 'forecast' },
    { lineItem: 'cogs', period: '2026-Q2', value: 30_000, origin: 'forecast' },
  ],
  confidence: 0.8,
};

/** Q1 came in 6,000 above forecast on revenue — units ran at 1,120, not 1,000. */
export const Q1_ABOVE: Actuals = {
  period: '2026-Q1',
  validatedAt: '2026-04-05T09:00:00.000Z',
  validatedBy: agentId('finance.controller'),
  amounts: [
    { lineItem: 'revenue', period: '2026-Q1', value: 56_000, origin: 'actual' },
    { lineItem: 'cogs', period: '2026-Q1', value: 33_600, origin: 'actual' },
  ],
};

/** Units at 1,120 explains exactly 6,000 of revenue: (1120−1000) × 50. */
export const Q1_DRIVERS = [{ id: 'units', value: 1_120 }];

/** Q1 landed within both thresholds. Nothing should move. */
export const Q1_QUIET: Actuals = {
  period: '2026-Q1',
  validatedAt: '2026-04-05T09:00:00.000Z',
  validatedBy: agentId('finance.controller'),
  amounts: [
    { lineItem: 'revenue', period: '2026-Q1', value: 50_400, origin: 'actual' },
    { lineItem: 'cogs', period: '2026-Q1', value: 30_200, origin: 'actual' },
  ],
};

/** A big miss that no driver movement explains — the honest-failure case. */
export const Q1_UNEXPLAINED: Actuals = {
  period: '2026-Q1',
  validatedAt: '2026-04-05T09:00:00.000Z',
  validatedBy: agentId('finance.controller'),
  amounts: [
    { lineItem: 'revenue', period: '2026-Q1', value: 20_000, origin: 'actual' },
    { lineItem: 'cogs', period: '2026-Q1', value: 30_000, origin: 'actual' },
  ],
};

export const SCENARIOS = [
  { id: 's_base', label: 'base', probability: 0.6, drivers: [] },
  { id: 's_up', label: 'upside', probability: 0.2, drivers: [{ id: 'units', value: 1_300 }] },
  { id: 's_down', label: 'downside', probability: 0.2, drivers: [{ id: 'units', value: 900 }] },
];
