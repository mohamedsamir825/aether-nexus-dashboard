/**
 * Concrete catalogues. Each is a plain Registry with an identity function; the
 * only added behaviour is lookup by division/role, which the Supervisor needs
 * to resolve a DispatchTarget.
 */
import { type Registry, createRegistry } from './registry.ts';
import type { AnyAgent } from '../contracts/agent.ts';
import type { AnySkill } from '../contracts/skill.ts';
import type { AnyTool } from '../contracts/tool.ts';
import type { ModelProvider } from '../contracts/model-provider.ts';
import type { DivisionId } from '../ids.ts';

export type SkillRegistry = Registry<AnySkill>;
export type ToolRegistry = Registry<AnyTool>;
export type ProviderRegistry = Registry<ModelProvider>;

export interface AgentRegistry extends Registry<AnyAgent> {
  findByRole(division: DivisionId, role: string): AnyAgent | undefined;
  listByDivision(division: DivisionId): readonly AnyAgent[];
}

export function createSkillRegistry(): SkillRegistry {
  return createRegistry('skill', (skill) => skill.descriptor.id);
}

export function createToolRegistry(): ToolRegistry {
  return createRegistry('tool', (tool) => tool.descriptor.id);
}

export function createProviderRegistry(): ProviderRegistry {
  return createRegistry('provider', (provider) => provider.id);
}

export function createAgentRegistry(): AgentRegistry {
  const base = createRegistry<AnyAgent>('agent', (agent) => agent.descriptor.id);
  return {
    ...base,
    get size() {
      return base.size;
    },
    findByRole(division, role) {
      return base.list().find(
        (agent) => agent.descriptor.division === division && agent.descriptor.role === role,
      );
    },
    listByDivision(division) {
      return base.list().filter((agent) => agent.descriptor.division === division);
    },
  };
}
