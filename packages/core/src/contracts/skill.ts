/**
 * A Skill is a reusable, testable procedure -- "how to do one thing well".
 * Skills are owned by agents but defined independently so two agents can share
 * one, and so a skill can be unit-tested without instantiating an agent.
 */
import type { Result } from '../result.ts';
import type { SkillId, ToolId } from '../ids.ts';
import type { Capability } from './permissions.ts';
import type { ExecutionContext } from './execution.ts';
import type { JsonSchema } from './model-provider.ts';
import type { ModelRouter } from './model-router.ts';
import type { ScopedMemory } from './memory.ts';
import type { ToolBelt } from './tool.ts';
import type { Evidence } from './evidence.ts';

export interface SkillDescriptor {
  readonly id: SkillId;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  /** Tools this skill cannot function without. */
  readonly requiredTools: readonly ToolId[];
  readonly requiredCapabilities: readonly Capability[];
}

/** Everything a skill is allowed to reach. Nothing else is in scope. */
export interface SkillContext extends ExecutionContext {
  readonly tools: ToolBelt;
  readonly models: ModelRouter;
  readonly memory: ScopedMemory;
}

export interface SkillOutcome<O = unknown> {
  readonly output: O;
  readonly evidence?: readonly Evidence[];
}

export interface Skill<I = unknown, O = unknown> {
  readonly descriptor: SkillDescriptor;
  validate(input: unknown): Result<I>;
  run(input: I, context: SkillContext): Promise<Result<SkillOutcome<O>>>;
}

/** A skill with its input/output parameterisation erased. See AnyTool. */
export type AnySkill = Skill<unknown, unknown>;
