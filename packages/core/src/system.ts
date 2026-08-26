/**
 * Assembles a running Core from configuration. This is the composition root:
 * the one place that decides which implementations are wired together, so that
 * every other file can depend on interfaces only.
 *
 * Note what it does NOT do: it registers no providers, no agents and no tools.
 * A freshly created system is a correct, empty, honest system -- it reports
 * itself as unable to serve model calls rather than pretending otherwise.
 */
import { type Clock, systemClock } from './clock.ts';
import { type Logger, consoleLogger } from './logger.ts';
import { type NexusConfig, describeConfig } from './config/config.ts';
import {
  type AgentRegistry,
  type ProviderRegistry,
  type SkillRegistry,
  type ToolRegistry,
  createAgentRegistry,
  createProviderRegistry,
  createSkillRegistry,
  createToolRegistry,
} from './registry/registries.ts';
import { createInMemoryEventBus } from './runtime/event-bus.ts';
import { createPermissionEngine } from './runtime/permissions.ts';
import { createInMemoryMemoryStore } from './runtime/memory.ts';
import { createModelRouter } from './runtime/model-router.ts';
import type { LimitTracker } from './runtime/limits.ts';
import { type HealthRegistry, createHealthRegistry, healthCheck } from './runtime/health.ts';
import { createSupervisor } from './runtime/supervisor.ts';
import type { EventBus } from './contracts/events.ts';
import type { PermissionEngine, PermissionPolicy } from './contracts/permissions.ts';
import type { MemoryStore } from './contracts/memory.ts';
import type { ModelRouter } from './contracts/model-router.ts';
import type { Supervisor } from './contracts/supervisor.ts';
import type { SystemHealth } from './contracts/health.ts';

export interface NexusSystem {
  readonly config: NexusConfig;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly events: EventBus;
  readonly permissions: PermissionEngine;
  readonly memory: MemoryStore;
  readonly models: ModelRouter;
  readonly supervisor: Supervisor;
  readonly health: HealthRegistry;
  readonly registries: {
    readonly agents: AgentRegistry;
    readonly skills: SkillRegistry;
    readonly tools: ToolRegistry;
    readonly providers: ProviderRegistry;
  };
  reportHealth(): Promise<SystemHealth>;
}

export interface CreateSystemParams {
  readonly config: NexusConfig;
  /** Evaluated in order. Empty means deny-everything, which is the safe default. */
  readonly policies?: readonly PermissionPolicy[];
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly memory?: MemoryStore;
  /** Enforces free-tier rate limits and quotas. Omitted means unenforced. */
  readonly limits?: LimitTracker;
}

export function createNexusSystem(params: CreateSystemParams): NexusSystem {
  const clock = params.clock ?? systemClock;
  const logger = params.logger ?? consoleLogger(params.config.logLevel);
  const events = createInMemoryEventBus(logger);
  const permissions = createPermissionEngine(params.policies ?? []);
  const memory = params.memory ?? createInMemoryMemoryStore({ clock });

  const registries = {
    agents: createAgentRegistry(),
    skills: createSkillRegistry(),
    tools: createToolRegistry(),
    providers: createProviderRegistry(),
  };

  const models = createModelRouter(registries.providers, {
    logger,
    ...(params.limits ? { limits: params.limits } : {}),
  });
  const health = createHealthRegistry(clock);

  health.register(healthCheck('memory', () => memory.health()));
  health.register(
    healthCheck('model-providers', async () => {
      const all = registries.providers.list();
      const configured = all.filter((provider) => provider.isConfigured());
      const summary = describeConfig(params.config);
      return {
        component: 'model-providers',
        status: configured.length > 0 ? 'healthy' : 'unavailable',
        checkedAt: clock.now().toISOString(),
        detail:
          configured.length > 0
            ? `${configured.length} of ${all.length} registered provider(s) configured`
            : 'no model provider adapters are registered; model calls will fail safely',
        // Credential *presence* only. describeConfig never emits key material.
        metadata: { credentials: summary.providers },
      };
    }),
  );
  health.register(
    healthCheck('agents', async () => ({
      component: 'agents',
      status: 'healthy',
      checkedAt: clock.now().toISOString(),
      detail: `${registries.agents.size} agent(s) registered`,
    })),
  );

  const supervisor = createSupervisor({
    agents: registries.agents,
    tools: registries.tools,
    models,
    memory,
    events,
    permissions,
    health,
    clock,
    logger,
  });

  return {
    config: params.config,
    clock,
    logger,
    events,
    permissions,
    memory,
    models,
    supervisor,
    health,
    registries,
    reportHealth: () => health.report(),
  };
}
