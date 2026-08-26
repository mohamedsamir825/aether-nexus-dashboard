/**
 * The ToolBelt is the enforcement point between an agent and the outside world.
 * Three gates, in order: the tool must be on the agent's declared list, the
 * subject must hold every capability the tool declares, and the input must
 * validate. Only then does anything execute.
 */
import { type Result, err } from '../result.ts';
import { nexusError, fromUnknown } from '../errors.ts';
import type { ToolId } from '../ids.ts';
import type { ToolRegistry } from '../registry/registries.ts';
import type { ToolBelt, ToolDescriptor, ToolInvocation, ToolOutcome } from '../contracts/tool.ts';
import type { ExecutionContext } from '../contracts/execution.ts';
import type { Subject } from '../contracts/permissions.ts';

export function createToolBelt(params: {
  readonly registry: ToolRegistry;
  readonly subject: Subject;
  /** The tools the agent declared. Anything outside this list is invisible. */
  readonly allowed: readonly ToolId[];
}): ToolBelt {
  const { registry, subject, allowed } = params;
  const allowedSet = new Set<string>(allowed);

  const descriptors = (): readonly ToolDescriptor[] =>
    registry
      .list()
      .filter((tool) => allowedSet.has(tool.descriptor.id))
      .map((tool) => tool.descriptor);

  return {
    list: descriptors,

    has: (id) => allowedSet.has(id) && registry.has(id),

    async invoke<O = unknown>(
      invocation: ToolInvocation,
      context: ExecutionContext,
    ): Promise<Result<ToolOutcome<O>>> {
      if (!allowedSet.has(invocation.toolId)) {
        return err(
          nexusError('PERMISSION_DENIED', `tool '${invocation.toolId}' is not on this belt`, {
            details: { subject: `${subject.kind}:${subject.id}`, toolId: invocation.toolId },
          }),
        );
      }

      const found = registry.get(invocation.toolId);
      if (!found.ok) return found;
      const tool = found.value;

      for (const capability of tool.descriptor.requiredCapabilities) {
        const permitted = context.permissions.require({
          subject,
          capability,
          resource: tool.descriptor.id,
        });
        if (!permitted.ok) return permitted;
      }

      const validated = tool.validate(invocation.input);
      if (!validated.ok) return validated;

      try {
        const outcome = (await tool.execute(validated.value, context)) as Result<ToolOutcome<O>>;
        if (!outcome.ok) return outcome;

        // Principle 5 is enforced here, not left to each tool's good behaviour.
        if (tool.descriptor.producesEvidence && (outcome.value.evidence?.length ?? 0) === 0) {
          return err(
            nexusError('INTERNAL', `tool '${tool.descriptor.id}' declares evidence but returned none`, {
              details: { toolId: tool.descriptor.id },
            }),
          );
        }
        return outcome;
      } catch (cause) {
        return err(fromUnknown(cause, 'INTERNAL'));
      }
    },
  };
}
