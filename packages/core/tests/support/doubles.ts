/**
 * Test doubles.
 *
 * These are ISOLATED TO TESTS by design (core principle 7). Nothing here is
 * exported from the package, nothing is importable by production code, and no
 * double is registered by default anywhere in src/. A double that pretended to
 * be a real provider would defeat the purpose of the health mechanism.
 */
import { type Result, ok, err } from '../../src/result.ts';
import { nexusError } from '../../src/errors.ts';
import {
  type IdGenerator,
  agentId,
  divisionId,
  modelId,
  providerId,
  toolId,
} from '../../src/ids.ts';
import type {
  GenerationRequest,
  GenerationResponse,
  ModelCapability,
  ModelDescriptor,
  ModelProvider,
} from '../../src/contracts/model-provider.ts';
import type { AnyAgent, AgentContext, AgentResult, AgentTask } from '../../src/contracts/agent.ts';
import type { Tool, ToolOutcome } from '../../src/contracts/tool.ts';
import type { Capability } from '../../src/contracts/permissions.ts';
import type { HealthReport } from '../../src/contracts/health.ts';
import { emptyUsage } from '../../src/contracts/execution.ts';

/** Deterministic ids so assertions do not depend on randomness. */
export function sequentialIds(): IdGenerator {
  let counter = 0;
  return { next: (prefix) => `${prefix}_${++counter}` };
}

export interface StubProviderOptions {
  readonly id: string;
  readonly configured?: boolean;
  readonly models?: readonly {
    id: string;
    capabilities: readonly ModelCapability[];
    contextWindow?: number;
    inputCostPer1k?: number;
  }[];
  /** Force generate() to fail, to exercise router fallback. */
  readonly failWith?: string;
  /** Force generate() to throw, to exercise adapter containment. */
  readonly throwWith?: string;
  readonly listModelsFails?: boolean;
}

export function stubProvider(options: StubProviderOptions): ModelProvider & { calls: string[] } {
  const calls: string[] = [];
  const descriptors: ModelDescriptor[] = (options.models ?? [
    { id: `${options.id}-default`, capabilities: ['text'] as const },
  ]).map((model) => ({
    id: modelId(model.id),
    provider: providerId(options.id),
    displayName: model.id,
    capabilities: model.capabilities,
    contextWindow: model.contextWindow ?? 100_000,
    maxOutputTokens: 4096,
    ...(model.inputCostPer1k !== undefined ? { inputCostPer1k: model.inputCostPer1k } : {}),
  }));

  return {
    calls,
    id: providerId(options.id),
    displayName: options.id,
    isConfigured: () => options.configured ?? true,
    async listModels(): Promise<Result<readonly ModelDescriptor[]>> {
      if (options.listModelsFails) {
        return err(nexusError('PROVIDER_UNAVAILABLE', `${options.id} cannot list models`));
      }
      return ok(descriptors);
    },
    async generate(request: GenerationRequest): Promise<Result<GenerationResponse>> {
      if (options.configured === false) {
        return err(nexusError('NOT_CONFIGURED', `${options.id} has no credential`));
      }
      if (request.signal?.aborted) {
        return err(nexusError('CANCELLED', 'request aborted before dispatch'));
      }
      calls.push(request.model);
      if (options.throwWith) throw new Error(options.throwWith);
      if (options.failWith) {
        return err(nexusError('PROVIDER_UNAVAILABLE', options.failWith));
      }
      return ok({
        model: request.model,
        provider: providerId(options.id),
        content: [{ type: 'text', text: `response from ${options.id}` }],
        stopReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1 },
      });
    },
    async health(): Promise<HealthReport> {
      return {
        component: `provider:${options.id}`,
        status: options.configured === false ? 'unavailable' : 'healthy',
        checkedAt: new Date(0).toISOString(),
        ...(options.configured === false ? { detail: 'no credential configured' } : {}),
      };
    },
  };
}

export interface StubAgentOptions {
  readonly id: string;
  readonly division?: string;
  readonly role?: string;
  readonly tools?: readonly string[];
  readonly capabilities?: readonly Capability[];
  readonly memoryScopes?: readonly { kind: 'user' | 'division' | 'agent' | 'run'; id: string }[];
  readonly throwWith?: string;
  readonly handler?: (task: AgentTask, context: AgentContext) => Promise<Result<AgentResult>>;
}

export function stubAgent(options: StubAgentOptions): AnyAgent {
  return {
    descriptor: {
      id: agentId(options.id),
      division: divisionId(options.division ?? 'test'),
      role: options.role ?? 'tester',
      displayName: options.id,
      description: 'test double',
      version: '0.0.0',
      skills: [],
      tools: (options.tools ?? []).map(toolId),
      capabilities: options.capabilities ?? [],
      memoryScopes: options.memoryScopes ?? [],
      modelPolicy: { requiredCapabilities: ['text'] },
    },
    async handle(task, context) {
      if (options.throwWith) throw new Error(options.throwWith);
      if (options.handler) return options.handler(task, context);
      return ok({
        output: { echoed: task.objective },
        summary: `handled by ${options.id}`,
        evidence: [],
        usage: emptyUsage,
      });
    },
  };
}

export interface StubToolOptions {
  readonly id: string;
  readonly requiredCapabilities?: readonly Capability[];
  readonly producesEvidence?: boolean;
  /** When true, execute() returns success but omits evidence. */
  readonly omitEvidence?: boolean;
  readonly throwWith?: string;
}

export function stubTool(options: StubToolOptions): Tool<{ value: string }, { echoed: string }> {
  return {
    descriptor: {
      id: toolId(options.id),
      name: options.id,
      description: 'test double',
      version: '0.0.0',
      inputSchema: { type: 'object', required: ['value'] },
      outputSchema: { type: 'object' },
      requiredCapabilities: options.requiredCapabilities ?? [],
      sideEffect: 'none',
      producesEvidence: options.producesEvidence ?? false,
    },
    validate(input): Result<{ value: string }> {
      if (typeof input !== 'object' || input === null || !('value' in input)) {
        return err(nexusError('INVALID_INPUT', 'expected { value: string }'));
      }
      const value = (input as { value: unknown }).value;
      if (typeof value !== 'string') {
        return err(nexusError('INVALID_INPUT', 'value must be a string'));
      }
      return ok({ value });
    },
    async execute(input): Promise<Result<ToolOutcome<{ echoed: string }>>> {
      if (options.throwWith) throw new Error(options.throwWith);
      const evidence =
        options.producesEvidence && !options.omitEvidence
          ? [
              {
                id: 'ev_1' as never,
                claim: input.value,
                source: { kind: 'computation' as const, retrievedAt: new Date(0).toISOString() },
                confidence: 1,
              },
            ]
          : undefined;
      return ok({
        output: { echoed: input.value },
        ...(evidence ? { evidence } : {}),
      });
    },
  };
}
