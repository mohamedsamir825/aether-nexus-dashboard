/**
 * The Business & Strategy Division (spec §5).
 *
 * A bundle, not an execution path (ADR 0013). It registers one agent and no
 * tools -- everything Business needs belongs to another division and is reached
 * by delegation through the Supervisor, which is §4.4's "all via delegation"
 * taken literally.
 *
 * That it registers no tool is worth noticing rather than glossing: a division
 * whose entire job is framing other divisions' outputs should not hold any
 * execution capability of its own, and this one does not. What it does hold is
 * its own memory scope -- it has to remember the framings it presented, since
 * every §5 KPI is eventually computed over them.
 */
import {
  type Division,
  type DivisionDescriptor,
  type DivisionInstaller,
  type Result,
  type ScopedVersionedMemory,
  ok,
} from '@nexus/core';
import {
  BUSINESS_DIVISION_ID,
  BUSINESS_STRATEGY_ID,
  BUSINESS_STRATEGY_ROLE,
  createStrategyDirector,
} from './agent.ts';

export const businessDescriptor: DivisionDescriptor = {
  id: BUSINESS_DIVISION_ID,
  displayName: 'Business & Strategy',
  description:
    'Frames strategic options with explicit trade-offs. Does not price them ' +
    '(Finance does), does not assert market facts without Research evidence, ' +
    'and does not recommend — the strategic call is the user’s (§5).',
  version: '1.0.0',
  // §5 lists ten roles. One is implemented, so one is claimed.
  agents: [BUSINESS_STRATEGY_ID],
  entryPoints: [BUSINESS_STRATEGY_ROLE],
  // Delegation, and its own memory scope. Still no `tool:execute`, no
  // `research:retrieve` and no `finance:actuals`: Business cannot run a tool,
  // read a corpus or touch actuals, and that is a missing grant rather than a
  // comment asking it not to.
  requiredCapabilities: ['agent:dispatch', 'memory:read', 'memory:write'],
};

export interface CreateBusinessDivisionOptions {
  /** Durable framing history. Absent means this division runs without memory. */
  readonly versionedMemory?: ScopedVersionedMemory;
}

export function createBusinessDivision(options: CreateBusinessDivisionOptions = {}): Division {
  return {
    descriptor: businessDescriptor,

    install(installer: DivisionInstaller): Result<void> {
      const agent = installer.registerAgent(createStrategyDirector(options));
      if (!agent.ok) return agent;
      return ok(undefined);
    },

    async health() {
      return {
        component: `division:${BUSINESS_DIVISION_ID}`,
        status: 'healthy' as const,
        checkedAt: new Date().toISOString(),
        detail: 'option framing; no tools, no provider, no cost',
      };
    },
  };
}
