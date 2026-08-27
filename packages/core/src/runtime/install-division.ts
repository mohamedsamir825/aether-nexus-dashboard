/**
 * Installing a division, and checking that it told the truth about itself.
 *
 * `DivisionDescriptor` is a set of claims: this is my roster, these are the
 * roles others may address, these are the capabilities my agents need. Nothing
 * checked any of them. A descriptor could name an agent it never registers, or
 * publish an entry point no agent serves, and the mistake would surface much
 * later as a delegation that fails with NOT_FOUND for reasons nobody can trace
 * back to a typo in a string array.
 *
 * The capability check is the one that matters most: an agent declaring a
 * capability its division never declared means the division's stated blast
 * radius is smaller than its real one, which is exactly the thing a deployment
 * reads `requiredCapabilities` to find out.
 *
 * This wraps `install()` rather than changing the `Division` contract, so a
 * division stays a bundle that installs itself and the verification is the
 * host's business.
 */
import { type Result, ok, err } from '../result.ts';
import { nexusError } from '../errors.ts';
import type { AnyAgent } from '../contracts/agent.ts';
import type { AnyTool } from '../contracts/tool.ts';
import type { Division, DivisionInstaller } from '../contracts/division.ts';

export interface InstallDivisionParams {
  readonly division: Division;
  readonly registerAgent: (agent: AnyAgent) => Result<unknown>;
  readonly registerTool: (tool: AnyTool) => Result<unknown>;
}

export interface InstalledDivision {
  readonly agents: readonly AnyAgent[];
  readonly tools: readonly AnyTool[];
}

export function installDivision(params: InstallDivisionParams): Result<InstalledDivision> {
  const agents: AnyAgent[] = [];
  const tools: AnyTool[] = [];

  // Recorded as they go past, so the check afterwards is against what actually
  // happened rather than against what the descriptor says happened.
  const installer: DivisionInstaller = {
    registerAgent(agent) {
      const result = params.registerAgent(agent);
      if (result.ok) agents.push(agent);
      return result;
    },
    registerTool(tool) {
      const result = params.registerTool(tool);
      if (result.ok) tools.push(tool);
      return result;
    },
  };

  const installed = params.division.install(installer);
  if (!installed.ok) return installed;

  const descriptor = params.division.descriptor;
  const problems: string[] = [];

  const registeredIds = new Set(agents.map((a) => String(a.descriptor.id)));
  for (const claimed of descriptor.agents) {
    if (!registeredIds.has(String(claimed))) {
      problems.push(`roster names '${String(claimed)}' but it was never registered`);
    }
  }
  for (const agent of agents) {
    if (!descriptor.agents.some((id) => String(id) === String(agent.descriptor.id))) {
      problems.push(`registered '${String(agent.descriptor.id)}' without declaring it on the roster`);
    }
  }

  const roles = new Set(agents.map((a) => a.descriptor.role));
  for (const entry of descriptor.entryPoints) {
    if (!roles.has(entry)) {
      problems.push(`entry point '${entry}' is served by no registered agent`);
    }
  }

  const declared = new Set(descriptor.requiredCapabilities.map(String));
  for (const agent of agents) {
    for (const capability of agent.descriptor.capabilities) {
      if (!declared.has(String(capability))) {
        problems.push(
          `agent '${String(agent.descriptor.id)}' needs '${String(capability)}', which the division does not declare`,
        );
      }
    }
  }

  if (problems.length > 0) {
    return err(
      nexusError(
        'INVALID_INPUT',
        `division '${String(descriptor.id)}' does not match its descriptor: ${problems.join('; ')}`,
        { details: { division: String(descriptor.id), problems } },
      ),
    );
  }

  return ok({ agents, tools });
}
