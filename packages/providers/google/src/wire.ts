/**
 * Google's `generateContent` wire format, and the translation to and from
 * NEXUS's neutral types.
 *
 * ## Why this file is the interesting one
 *
 * ADR 0004 said the model abstraction should be judged on the SECOND adapter,
 * not the first, because one adapter always fits the abstraction it was
 * designed against. This is that second adapter, and Google's protocol differs
 * from OpenAI's in every dimension that matters:
 *
 *  - Roles are `user` / `model`; there is no `assistant` and no `system` role.
 *    System instructions live in their own top-level field.
 *  - A turn is a list of typed `parts`, not a string plus side-channels.
 *  - The model name goes in the URL path, not the request body.
 *  - Sampling parameters nest under `generationConfig`.
 *  - Finish reasons are upper-case, and a turn containing a function call still
 *    reports `STOP`.
 *
 * ## The one genuine impedance mismatch
 *
 * NEXUS keys a tool result to the `callId` of the call it answers. **Google has
 * no call ids** -- a `functionResponse` is keyed by function NAME. Translating
 * outward therefore needs to resolve a callId back to the name it referred to,
 * which this file does by scanning the conversation for the matching call.
 *
 * That is real work, and it is worth being explicit that it did NOT require
 * changing `ContentPart` or any other Core contract. The neutral shape carries
 * strictly more information than Google's, so the mapping is lossy in the
 * harmless direction. Had it been the other way round, ADR 0004 would have
 * needed superseding.
 */
import type {
  ContentPart,
  GenerationRequest,
  Message,
  StopReason,
  ToolDefinition,
} from '@nexus/core';

// --- wire types (vendor-shaped, internal to this package) -----------------

export interface WireFunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

export interface WireFunctionResponse {
  name: string;
  response: Record<string, unknown>;
}

export type WirePart =
  | { text: string }
  | { functionCall: WireFunctionCall }
  | { functionResponse: WireFunctionResponse };

export interface WireContent {
  role: 'user' | 'model';
  parts: WirePart[];
}

export interface WireRequest {
  contents: WireContent[];
  systemInstruction?: { parts: { text: string }[] };
  tools?: [{ functionDeclarations: ToolDefinition[] }];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    responseMimeType?: string;
  };
}

export interface WireResponse {
  candidates?: { content?: { parts?: WirePart[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

// --- outbound: neutral -> wire -------------------------------------------

/** Google has only two roles; a tool turn is authored by the user side. */
const toWireRole = (role: Message['role']): 'user' | 'model' =>
  role === 'assistant' ? 'model' : 'user';

/**
 * Resolves `callId -> toolName` across the conversation, so a tool result can
 * be rendered as Google's name-keyed `functionResponse`.
 */
function buildCallNames(messages: readonly Message[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === 'tool_call') names.set(part.callId, part.toolName);
    }
  }
  return names;
}

export function toWireContents(messages: readonly Message[]): WireContent[] {
  const callNames = buildCallNames(messages);
  const contents: WireContent[] = [];

  for (const message of messages) {
    const parts: WirePart[] = [];

    for (const part of message.content) {
      if (part.type === 'text') {
        if (part.text !== '') parts.push({ text: part.text });
      } else if (part.type === 'tool_call') {
        parts.push({ functionCall: { name: part.toolName, args: { ...part.arguments } } });
      } else {
        // Google keys the response by name. When the originating call is not in
        // this conversation the id is the only handle we have, so it is used
        // rather than inventing a name -- a wrong name would be silently wrong,
        // an unknown one fails loudly at the provider.
        const name = callNames.get(part.callId) ?? part.callId;
        parts.push({
          functionResponse: {
            name,
            response: part.isError ? { error: part.content } : { output: part.content },
          },
        });
      }
    }

    if (parts.length > 0) contents.push({ role: toWireRole(message.role), parts });
  }

  return contents;
}

export function toWireRequest(request: GenerationRequest): WireRequest {
  const generationConfig = {
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
    ...(request.stopSequences && request.stopSequences.length > 0
      ? { stopSequences: [...request.stopSequences] }
      : {}),
    ...(request.responseFormat === 'json' ? { responseMimeType: 'application/json' } : {}),
  };

  return {
    contents: toWireContents(request.messages),
    ...(request.system !== undefined && request.system !== ''
      ? { systemInstruction: { parts: [{ text: request.system }] } }
      : {}),
    ...(request.tools && request.tools.length > 0
      ? { tools: [{ functionDeclarations: [...request.tools] }] as [{ functionDeclarations: ToolDefinition[] }] }
      : {}),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    ...(request.providerOptions ?? {}),
  };
}

// --- inbound: wire -> neutral --------------------------------------------

const CONTENT_FILTER_REASONS = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
]);

/**
 * Google reports `STOP` even for a turn that is entirely a function call, so
 * the presence of calls decides `tool_use` -- reading finishReason alone would
 * tell the agent the turn was finished when it is waiting on a tool.
 */
export function toStopReason(finishReason: string | undefined, hasToolCalls: boolean): StopReason {
  if (hasToolCalls) return 'tool_use';
  switch (finishReason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case undefined:
      return 'error';
    default:
      return CONTENT_FILTER_REASONS.has(finishReason) ? 'content_filter' : 'error';
  }
}

/**
 * Synthesises the call ids Google does not provide. Deterministic within a
 * response so a later tool result can be matched back to its call.
 */
export function toContentParts(parts: readonly WirePart[] | undefined): ContentPart[] {
  const out: ContentPart[] = [];
  let callIndex = 0;

  for (const part of parts ?? []) {
    if ('text' in part) {
      if (part.text !== '') out.push({ type: 'text', text: part.text });
    } else if ('functionCall' in part) {
      out.push({
        type: 'tool_call',
        callId: `${part.functionCall.name}#${callIndex++}`,
        toolName: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      });
    }
    // functionResponse never appears in a model turn; ignored if it does.
  }

  return out;
}
