/**
 * The OpenAI chat-completions wire format, and the translation to and from
 * NEXUS's neutral types.
 *
 * This file is where the vendor shape is allowed to exist. Nothing above it --
 * no agent, no skill, no router -- ever sees these types. That containment is
 * the whole point of ADR 0004.
 */
import type {
  ContentPart,
  GenerationRequest,
  Message,
  StopReason,
  ToolDefinition,
} from '@nexus/core';

// --- wire types (vendor-shaped, internal to this package) -----------------

export interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface WireResponseMessage {
  content?: string | null;
  tool_calls?: WireToolCall[];
}

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
}

export interface WireRequest {
  model: string;
  messages: WireMessage[];
  tools?: { type: 'function'; function: ToolDefinition }[];
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
  response_format?: { type: 'json_object' };
}

export interface WireResponse {
  choices?: { message?: WireResponseMessage; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

// --- outbound: neutral -> wire -------------------------------------------

/**
 * One neutral Message can become SEVERAL wire messages: OpenAI models a tool
 * result as its own `role: "tool"` message keyed by call id, while NEXUS carries
 * results as content parts of a single turn. Flattening that is the main
 * asymmetry between the two shapes.
 */
export function toWireMessages(message: Message): WireMessage[] {
  const text = message.content
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');

  const toolCalls = message.content
    .filter((p): p is Extract<ContentPart, { type: 'tool_call' }> => p.type === 'tool_call')
    .map((p) => ({
      id: p.callId,
      type: 'function' as const,
      function: { name: p.toolName, arguments: JSON.stringify(p.arguments) },
    }));

  const toolResults = message.content.filter(
    (p): p is Extract<ContentPart, { type: 'tool_result' }> => p.type === 'tool_result',
  );

  const out: WireMessage[] = [];

  // Tool results carry their own role and must precede the turn's own content.
  for (const result of toolResults) {
    out.push({ role: 'tool', content: result.content, tool_call_id: result.callId });
  }

  if (text !== '' || toolCalls.length > 0 || out.length === 0) {
    const role = message.role === 'tool' ? 'user' : message.role;
    out.push({
      role,
      content: text === '' ? null : text,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }

  return out;
}

export function toWireRequest(request: GenerationRequest): WireRequest {
  const messages: WireMessage[] = [];
  if (request.system !== undefined && request.system !== '') {
    messages.push({ role: 'system', content: request.system });
  }
  for (const message of request.messages) messages.push(...toWireMessages(message));

  return {
    model: request.model,
    messages,
    ...(request.tools && request.tools.length > 0
      ? { tools: request.tools.map((t) => ({ type: 'function' as const, function: t })) }
      : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}),
    ...(request.stopSequences && request.stopSequences.length > 0
      ? { stop: [...request.stopSequences] }
      : {}),
    ...(request.responseFormat === 'json' ? { response_format: { type: 'json_object' as const } } : {}),
    // providerOptions is vendor passthrough, set by configuration, never by
    // agent code (ADR 0004).
    ...(request.providerOptions ?? {}),
  };
}

// --- inbound: wire -> neutral --------------------------------------------

export function toStopReason(finishReason: string | null | undefined): StopReason {
  switch (finishReason) {
    case 'stop':
    case 'end_turn':
      return 'stop';
    case 'length':
    case 'max_tokens':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'content_filter';
    default:
      // An unrecognised reason is reported as 'stop' only when the response was
      // otherwise well-formed; callers distinguish by inspecting content.
      return finishReason ? 'stop' : 'error';
  }
}

/**
 * Tool-call arguments arrive as a JSON *string*. A model can emit malformed
 * JSON there, so parsing is fallible and must not throw: an unparseable call
 * is surfaced as a tool_call with the raw text preserved, rather than dropped.
 */
export function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { _value: parsed };
  } catch {
    return { _unparsed: raw };
  }
}

export function toContentParts(message: WireResponseMessage | undefined): ContentPart[] {
  const parts: ContentPart[] = [];
  const content = message?.content;
  if (typeof content === 'string' && content !== '') {
    parts.push({ type: 'text', text: content });
  }
  for (const call of message?.tool_calls ?? []) {
    parts.push({
      type: 'tool_call',
      callId: call.id,
      toolName: call.function.name,
      arguments: parseToolArguments(call.function.arguments),
    });
  }
  return parts;
}
