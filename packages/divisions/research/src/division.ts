/**
 * The Research Division.
 *
 * Note what this file does NOT contain: any way to run a research task. Work
 * reaches the analyst through the Supervisor, exactly like any other agent
 * (ADR 0013). The division's whole job is to declare who it is, what it needs,
 * and to install its agent and tool into the registries it is handed.
 */
import {
  type Division,
  type DivisionDescriptor,
  type DivisionInstaller,
  type HealthReport,
  type Result,
  ok,
} from '@nexus/core';
import type { SourceRetriever } from './retrieval.ts';
import {
  RESEARCH_RETRIEVE_CAPABILITY,
  createRetrieveTool,
} from './tool.ts';
import {
  RESEARCH_ANALYST_ID,
  RESEARCH_ANALYST_ROLE,
  RESEARCH_DIVISION_ID,
  createResearchAnalyst,
} from './agent.ts';

export const researchDescriptor: DivisionDescriptor = {
  id: RESEARCH_DIVISION_ID,
  displayName: 'Research & Intelligence',
  description:
    'Retrieves sources, extracts evidence, and produces typed claims with ' +
    'provenance. Distinguishes fact from inference and surfaces contradictions.',
  version: '1.0.0',
  agents: [RESEARCH_ANALYST_ID],
  // The one role another division may address. The pipeline's internals are
  // not addressable from outside (spec §3.2).
  entryPoints: [RESEARCH_ANALYST_ROLE],
  // Declared so a deployment can see the blast radius before installing. This
  // requests capabilities; it does not grant them (ADR 0005).
  requiredCapabilities: [
    'agent:dispatch',
    'tool:execute',
    RESEARCH_RETRIEVE_CAPABILITY,
    'memory:read',
    'memory:write',
  ],
};

export interface CreateResearchDivisionOptions {
  /** Where sources come from. Injected: the division owns no corpus itself. */
  readonly retriever: SourceRetriever;
}

export function createResearchDivision(options: CreateResearchDivisionOptions): Division {
  return {
    descriptor: researchDescriptor,

    install(installer: DivisionInstaller): Result<void> {
      const tool = installer.registerTool(createRetrieveTool({ retriever: options.retriever }));
      if (!tool.ok) return tool;

      const agent = installer.registerAgent(createResearchAnalyst());
      if (!agent.ok) return agent;

      return ok(undefined);
    },

    async health(): Promise<HealthReport> {
      return {
        component: `division:${RESEARCH_DIVISION_ID}`,
        status: 'healthy',
        checkedAt: new Date().toISOString(),
        detail: '1 agent, 1 tool, deterministic pipeline',
      };
    },
  };
}
