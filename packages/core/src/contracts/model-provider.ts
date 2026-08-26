/**
 * Provider-agnostic model layer (core principle 2).
 *
 * This file is the contract every vendor adapter implements -- Gemini,
 * OpenRouter, Anthropic, OpenAI, xAI, or anything not invented yet. The types
 * here are deliberately the *intersection* expressed in neutral terms: no
 * vendor field names, no vendor-shaped message objects, no vendor enums.
 *
 * The rule that keeps this honest: adding a provider must never require a
 * change to this file, to any agent, or to any skill. If a new provider forces
 * an edit here, the abstraction was wrong and the change needs an ADR.
 *
 * Vendor-specific knobs travel in `providerOptions`, which the router passes
 * through untouched and which agent logic must never populate.
 */
import type { Result } from '../result.ts';
import type { ModelId, ProviderId } from '../ids.ts';
import type { HealthReporter } from './health.ts';

/**
 * Text-model capabilities only. Speech (STT/TTS) is NOT here -- it lives on the
 * sibling `SpeechProvider` contract (ADR 0009), because it differs in request
 * shape, streaming semantics, failure modes and latency class.
 */
export type ModelCapability =
  | 'text'
  | 'streaming'
  | 'tool_use'
  | 'json_output'
  | 'vision'
  | 'embeddings'
  | 'reasoning';

export interface ModelDescriptor {
  readonly id: ModelId;
  readonly provider: ProviderId;
  readonly displayName: string;
  readonly capabilities: readonly ModelCapability[];
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  /** Cost in minor currency units per 1k tokens; omitted when not published. */
  readonly inputCostPer1k?: number;
  readonly outputCostPer1k?: number;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextPart {
  readonly type: 'text';
  readonly text: string;
}

export interface ToolCallPart {
  readonly type: 'tool_call';
  readonly callId: string;
  readonly toolName: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface ToolResultPart {
  readonly type: 'tool_result';
  readonly callId: string;
  readonly content: string;
  readonly isError?: boolean;
}

export type ContentPart = TextPart | ToolCallPart | ToolResultPart;

export interface Message {
  readonly role: MessageRole;
  readonly content: readonly ContentPart[];
}

/** A tool as offered to a model. Distinct from the executable Tool contract. */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
}

/**
 * JSON Schema is carried opaquely so the Core stays dependency-free. Validation
 * is delegated to a SchemaValidator, which a later package supplies.
 */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface SchemaValidator {
  validate(schema: JsonSchema, value: unknown): Result<void>;
}

export type StopReason = 'stop' | 'length' | 'tool_use' | 'content_filter' | 'error';

export interface GenerationRequest {
  readonly model: ModelId;
  readonly messages: readonly Message[];
  readonly system?: string;
  readonly tools?: readonly ToolDefinition[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly stopSequences?: readonly string[];
  readonly responseFormat?: 'text' | 'json';
  readonly signal?: AbortSignal;
  /** Vendor-specific passthrough. Set by configuration, never by agent code. */
  readonly providerOptions?: Readonly<Record<string, unknown>>;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface GenerationResponse {
  readonly model: ModelId;
  readonly provider: ProviderId;
  readonly content: readonly ContentPart[];
  readonly stopReason: StopReason;
  readonly usage: TokenUsage;
  readonly raw?: unknown;
}

export interface StreamChunk {
  readonly delta: ContentPart;
  readonly done: boolean;
}

export interface EmbeddingRequest {
  readonly model: ModelId;
  readonly input: readonly string[];
}

export interface EmbeddingResponse {
  readonly model: ModelId;
  readonly vectors: readonly (readonly number[])[];
  readonly usage: TokenUsage;
}

/**
 * Optional members are genuinely optional: a provider that cannot embed simply
 * omits `embed`, and the router routes around it rather than receiving a stub
 * that throws.
 */
export interface ModelProvider extends HealthReporter {
  readonly id: ProviderId;
  readonly displayName: string;
  /** False when required configuration (e.g. an API key) is absent. */
  isConfigured(): boolean;
  listModels(): Promise<Result<readonly ModelDescriptor[]>>;
  generate(request: GenerationRequest): Promise<Result<GenerationResponse>>;
  stream?(request: GenerationRequest): AsyncIterable<Result<StreamChunk>>;
  embed?(request: EmbeddingRequest): Promise<Result<EmbeddingResponse>>;
}
