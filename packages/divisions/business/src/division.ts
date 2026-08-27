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
 * capability of its own, and this one does not.
 */
import {
  type Division,
  type DivisionDescriptor,
  type DivisionInstaller,
  type Result,
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
  // Only the power to delegate. No tool execution, no memory, no retrieval:
  // the blast radius of a division that only frames should be small enough to
  // read in one line.
  requiredCapabilities: ['agent:dispatch'],
};

export function createBusinessDivision(): Division {
  return {
    descriptor: businessDescriptor,

    install(installer: DivisionInstaller): Result<void> {
      const agent = installer.registerAgent(createStrategyDirector());
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
