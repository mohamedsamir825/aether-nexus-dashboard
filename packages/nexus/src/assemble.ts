/**
 * The composition root: registration and policy (§23).
 *
 * Core builds the runtime. It does not know what a Research division is, and
 * must not -- §2 lists "product or division logic" under what the Core must
 * *contain*, meaning must not hold. So `createNexusSystem` takes no divisions,
 * and assembling the product belongs here, one layer out.
 *
 * ## Why this file matters more than it looks
 *
 * Before it, no code outside a test ever installed a division. Every
 * cross-division integration existed only inside a harness that built its own
 * policy, its own memory wiring and its own registration order. Three harnesses
 * meant three assemblies, none of which was the one a deployment would run --
 * so the tests proved each division worked under *a* configuration rather than
 * under *the* configuration.
 *
 * This is that configuration. The tests now import it rather than reinventing
 * it, which is what makes them evidence about NEXUS rather than about a fixture.
 *
 * ## §23's test, made runnable
 *
 * "Adding a division must touch only its own package plus registration and
 * policy." Registration is `install()` below; policy is `policy.ts`. A division
 * that needs a Core change to be installed here has broken the abstraction, and
 * that is now something a person can check by trying.
 */
import {
  createDurableMemoryStore,
  createNexusSystem,
  createScopedVersionedMemory,
  installDivision,
  type Clock,
  type Division,
  type Logger,
  type MemoryFileSystem,
  type NexusConfig,
  type NexusSystem,
  type PermissionPolicy,
  type Result,
  type ScopedVersionedMemory,
  ok,
} from '@nexus/core';
import { createResearchDivision, type SourceRetriever } from '@nexus/division-research';
import {
  FINANCE_MEMORY_SCOPE,
  createFinanceDivision,
  type ActualsSource,
  type ScenarioSpec,
  type SensitivityModel,
} from '@nexus/division-finance';
import { BUSINESS_MEMORY_SCOPE, createBusinessDivision } from '@nexus/division-business';
import { NEXUS_POLICIES } from './policy.ts';

export interface AssembleParams {
  readonly config: NexusConfig;
  /** Where durable memory lives. One log for the whole system. */
  readonly memoryPath: string;
  readonly fs: MemoryFileSystem;
  /** The corpus Research reads. Supplied, never discovered. */
  readonly retriever: SourceRetriever;
  /** Validated period actuals for Finance. */
  readonly actuals: ActualsSource;
  readonly sensitivities: SensitivityModel;
  readonly horizon: readonly string[];
  /** Scenario paths Finance weighs. Omitted means stage 5 does not run. */
  readonly scenarios?: readonly ScenarioSpec[];
  readonly observedDrivers?: Readonly<Record<string, readonly { id: string; value: number }[]>>;
  readonly clock?: Clock;
  readonly logger?: Logger;
  /** Defaults to the standard set. Overridable so a test can withhold a grant. */
  readonly policies?: readonly PermissionPolicy[];
}

export interface Nexus {
  readonly system: NexusSystem;
  /** Finance's versioned view, exposed so a caller can ask historical questions. */
  readonly financeHistory: ScopedVersionedMemory;
  /**
   * Business's versioned view over its own framings.
   *
   * Exposed for the same reason as Finance's: asking "what options were on the
   * table in March" is a question about the archive, not about a run, and a
   * caller with no way to ask it would have to re-run the division to find out
   * -- which would answer with today's facts instead of March's.
   */
  readonly businessHistory: ScopedVersionedMemory;
  readonly divisions: readonly Division[];
}

/**
 * Assembles the system.
 *
 * Returns a `Result` rather than throwing: a division that fails descriptor
 * verification is a configuration error the caller should see, not a crash.
 * Installation stops at the first failure, so a half-assembled system is never
 * handed back looking complete.
 */
export function assembleNexus(params: AssembleParams): Result<Nexus> {
  const memoryStore = createDurableMemoryStore({
    path: params.memoryPath,
    fs: params.fs,
    ...(params.clock !== undefined ? { clock: params.clock } : {}),
  });

  const system = createNexusSystem({
    config: params.config,
    policies: params.policies ?? NEXUS_POLICIES,
    memory: memoryStore,
    ...(params.clock !== undefined ? { clock: params.clock } : {}),
    ...(params.logger !== undefined ? { logger: params.logger } : {}),
  });

  // Finance needs `asOf`/`history`, which AgentContext does not carry. The
  // view is built HERE, by the composition root, narrowed to Finance's own
  // scope and checked against the same permission engine the Supervisor uses --
  // so the guard is identical whether the plain or versioned surface is used.
  const financeHistory = createScopedVersionedMemory({
    store: memoryStore,
    subject: { kind: 'agent', id: 'finance.fpa' },
    scopes: [FINANCE_MEMORY_SCOPE],
    permissions: system.permissions,
  });

  // Built the same way, over Business's own scope alone. Two views over one
  // store, each narrowed to one division: this is where scope isolation is
  // actually decided, and giving either of them both scopes would undo it.
  const businessHistory = createScopedVersionedMemory({
    store: memoryStore,
    subject: { kind: 'agent', id: 'business.strategy' },
    scopes: [BUSINESS_MEMORY_SCOPE],
    permissions: system.permissions,
  });

  const divisions: readonly Division[] = [
    createResearchDivision({ retriever: params.retriever }),
    createFinanceDivision({
      actuals: params.actuals,
      versionedMemory: financeHistory,
      sensitivities: params.sensitivities,
      horizon: params.horizon,
      ...(params.scenarios !== undefined ? { scenarios: params.scenarios } : {}),
      ...(params.observedDrivers !== undefined
        ? { observedDrivers: params.observedDrivers }
        : {}),
    }),
    createBusinessDivision({ versionedMemory: businessHistory }),
  ];

  const installed = installAll(system, divisions);
  if (!installed.ok) return installed;

  return ok({ system, financeHistory, businessHistory, divisions });
}

/**
 * Installs every division, stopping at the first failure.
 *
 * Separate from `assembleNexus` so the failure path is reachable in a test with
 * a deliberately misdescribed division. Without that, "a half-assembled system
 * is never handed back" was a claim resting on one unexercised line.
 */
export function installAll(
  system: NexusSystem,
  divisions: readonly Division[],
): Result<void> {
  for (const division of divisions) {
    // Through the verifying installer, so a division whose descriptor
    // misdescribes it fails at assembly rather than at a delegation months on.
    const result = installDivision({
      division,
      registerAgent: (agent) => system.registries.agents.register(agent),
      registerTool: (tool) => system.registries.tools.register(tool),
    });
    if (!result.ok) return result;
  }
  return ok(undefined);
}
