/**
 * Named model-selection policies.
 *
 * Agents should say what KIND of work this is, not assemble a policy by hand.
 * That keeps cost and capability decisions in one place a deployment can tune,
 * instead of scattered across every agent that ever calls a model.
 *
 * Deliberately implemented ABOVE `ModelSelectionPolicy` rather than as a field
 * inside it: a task class is a deployment concern, and adding it to the Core
 * contract would have been a contract edit for an ergonomic gain (ADR 0004).
 *
 * The defaults below name capabilities only, never vendors. A deployment that
 * wants "interactive work prefers the fastest provider" expresses that by
 * overriding a class with `preferredProviders` — the Core must not know which
 * vendor is fastest.
 */
import { type Result, ok, err } from '../result.ts';
import { nexusError } from '../errors.ts';
import type { ModelSelectionPolicy } from '../contracts/model-router.ts';

export type TaskClass = string;

/**
 * Vendor-neutral starting set. Fallback is on everywhere: on free tiers the
 * next provider is usually a better answer than a failure.
 */
export const DEFAULT_TASK_CLASSES = {
  /** Ordinary generation. */
  text: { requiredCapabilities: ['text'], allowFallback: true },
  /** Work that must read a lot of context at once. */
  'text.long-context': {
    requiredCapabilities: ['text'],
    minContextWindow: 200_000,
    allowFallback: true,
  },
  /** Anything that will call tools. */
  'tool-use': { requiredCapabilities: ['text', 'tool_use'], allowFallback: true },
  /** Output that must parse. */
  'structured-output': { requiredCapabilities: ['text', 'json_output'], allowFallback: true },
  /** Reasoning over images. */
  vision: { requiredCapabilities: ['text', 'vision'], allowFallback: true },
  /** Retrieval and memory indexing. */
  embeddings: { requiredCapabilities: ['embeddings'], allowFallback: true },
} as const satisfies Record<string, ModelSelectionPolicy>;

export type DefaultTaskClass = keyof typeof DEFAULT_TASK_CLASSES;

export interface TaskClassRegistry {
  policyFor(taskClass: TaskClass): Result<ModelSelectionPolicy>;
  list(): readonly TaskClass[];
}

export interface CreateTaskClassRegistryParams {
  /** Merged over the defaults; a matching name replaces the default entirely. */
  readonly overrides?: Readonly<Record<string, ModelSelectionPolicy>>;
  /** Start empty instead of from DEFAULT_TASK_CLASSES. */
  readonly includeDefaults?: boolean;
}

export function createTaskClassRegistry(
  params: CreateTaskClassRegistryParams = {},
): TaskClassRegistry {
  const policies: Record<string, ModelSelectionPolicy> = {
    ...(params.includeDefaults === false ? {} : DEFAULT_TASK_CLASSES),
    ...(params.overrides ?? {}),
  };

  return {
    policyFor(taskClass) {
      const policy = policies[taskClass];
      if (!policy) {
        return err(
          nexusError('NOT_FOUND', `unknown task class '${taskClass}'`, {
            details: { taskClass, available: Object.keys(policies).sort() },
          }),
        );
      }
      return ok(policy);
    },
    list: () => Object.keys(policies).sort(),
  };
}
