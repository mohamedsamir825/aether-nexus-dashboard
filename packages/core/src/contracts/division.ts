/**
 * Divisions (spec §3).
 *
 * ## A Division is not an execution path
 *
 * This is the constraint that matters. Work flows User -> Supervisor -> Agent,
 * exactly as ADR 0007 requires, and a Division does not sit in that path.
 *
 * Giving `Division` a `dispatch()` of its own would be the obvious design and
 * the wrong one: there would then be two ways to reach an agent, one of which
 * bypasses the permission check, budget inheritance, delegation-depth bound and
 * event trail the Supervisor provides. That is the "parallel architecture" a
 * division must never become.
 *
 * So a Division is a *bundle*: identity, roster, entry points, and the
 * capabilities its agents need. It installs itself into the existing registries
 * and then gets out of the way.
 */
import type { Result } from '../result.ts';
import type { AgentId, DivisionId } from '../ids.ts';
import type { AnyAgent } from './agent.ts';
import type { AnyTool } from './tool.ts';
import type { Capability } from './permissions.ts';
import type { HealthReporter } from './health.ts';

export interface DivisionDescriptor {
  readonly id: DivisionId;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  /** Every agent the division owns. */
  readonly agents: readonly AgentId[];
  /**
   * The roles other divisions may address, deliberately narrower than the
   * roster: internal specialists are not addressable from outside (§3.2).
   * Declaring this is what makes a division's surface reviewable.
   */
  readonly entryPoints: readonly string[];
  /**
   * What the division's agents collectively need granted. Declared so a
   * deployment can see the blast radius before installing it -- never assumed,
   * and never self-granted (deny-by-default still governs, ADR 0005).
   */
  readonly requiredCapabilities: readonly Capability[];
}

/**
 * The only surface a division may touch while installing. Narrow on purpose: a
 * division that could reach the permission engine during install could grant
 * itself the capabilities it just declared.
 */
export interface DivisionInstaller {
  registerAgent(agent: AnyAgent): Result<unknown>;
  registerTool(tool: AnyTool): Result<unknown>;
}

export interface Division extends Partial<HealthReporter> {
  readonly descriptor: DivisionDescriptor;
  /** Installs the division's agents and tools into the host system. */
  install(installer: DivisionInstaller): Result<void>;
}
