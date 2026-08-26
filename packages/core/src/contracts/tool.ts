/**
 * Tools are the only way NEXUS touches the outside world (core principle 3:
 * tool-agnostic agents). An agent declares which tools it may use; it never
 * imports one directly, and it never learns which SDK sits behind it.
 */
import type { Result } from '../result.ts';
import type { ToolId } from '../ids.ts';
import type { Capability } from './permissions.ts';
import type { ExecutionContext } from './execution.ts';
import type { JsonSchema } from './model-provider.ts';
import type { Evidence } from './evidence.ts';
import type { HealthReporter } from './health.ts';

/**
 * Declared so the permission layer and the audit trail can reason about a tool
 * *before* it runs. 'external' means it leaves the process.
 */
export type SideEffect = 'none' | 'read' | 'write' | 'external';

export interface ToolDescriptor {
  readonly id: ToolId;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly requiredCapabilities: readonly Capability[];
  readonly sideEffect: SideEffect;
  /** True when output must be accompanied by Evidence (principle 5). */
  readonly producesEvidence: boolean;
}

export interface ToolInvocation<I = unknown> {
  readonly toolId: ToolId;
  readonly input: I;
}

export interface ToolOutcome<O = unknown> {
  readonly output: O;
  /** Required to be non-empty when descriptor.producesEvidence is true. */
  readonly evidence?: readonly Evidence[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Tool<I = unknown, O = unknown> extends Partial<HealthReporter> {
  readonly descriptor: ToolDescriptor;
  /** Validate input against inputSchema before any side effect occurs. */
  validate(input: unknown): Result<I>;
  execute(input: I, context: ExecutionContext): Promise<Result<ToolOutcome<O>>>;
}

/** The permission-checked handle a skill uses; it cannot reach unlisted tools. */
export interface ToolBelt {
  list(): readonly ToolDescriptor[];
  has(id: ToolId): boolean;
  invoke<O = unknown>(invocation: ToolInvocation, context: ExecutionContext): Promise<Result<ToolOutcome<O>>>;
}

/**
 * A tool whose input/output types are not known at the call site. Registries
 * hold these: `Tool<never, unknown>` would be uninhabitable, and `unknown`
 * correctly says "some concrete tool, parameterisation erased".
 */
export type AnyTool = Tool<unknown, unknown>;
