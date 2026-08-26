/** Test doubles, isolated to tests (core principle 7). No network, ever. */
import { modelId, providerId } from '@nexus/core';
import type { ModelDescriptor } from '@nexus/core';
import type { FetchLike } from '../src/provider.ts';

export const testModels: readonly ModelDescriptor[] = [
  {
    id: modelId('test-small'),
    provider: providerId('testcorp'),
    displayName: 'Test Small',
    capabilities: ['text'],
    contextWindow: 32_000,
    maxOutputTokens: 4_096,
    inputCostPer1k: 0,
  },
  {
    id: modelId('test-large'),
    provider: providerId('testcorp'),
    displayName: 'Test Large',
    capabilities: ['text', 'tool_use'],
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
  },
];

export interface StubCall {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

export function stubFetch(
  respond: (call: StubCall) => { status?: number; body?: unknown; headers?: Record<string, string> },
): FetchLike & { calls: StubCall[] } {
  const calls: StubCall[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const call: StubCall = {
      url,
      body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const { status = 200, body = {}, headers = {} } = respond(call);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }) as FetchLike & { calls: StubCall[] };
  fn.calls = calls;
  return fn;
}

/** A well-formed chat-completions response. */
export const okResponse = {
  choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 5, completion_tokens: 2 },
};
