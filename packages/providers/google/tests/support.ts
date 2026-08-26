/** Test doubles, isolated to tests. No network, ever. */
import { modelId, providerId } from '@nexus/core';
import type { ModelDescriptor } from '@nexus/core';
import type { FetchLike } from '../src/provider.ts';

export const testModels: readonly ModelDescriptor[] = [
  {
    id: modelId('gemini-test-flash'),
    provider: providerId('google'),
    displayName: 'Gemini Test Flash',
    capabilities: ['text', 'tool_use', 'vision'],
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    inputCostPer1k: 0,
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
    calls.push({
      url,
      body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const last = calls[calls.length - 1];
    if (!last) throw new Error('unreachable');
    const { status = 200, body = {}, headers = {} } = respond(last);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }) as FetchLike & { calls: StubCall[] };
  fn.calls = calls;
  return fn;
}

export const okResponse = {
  candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
};
