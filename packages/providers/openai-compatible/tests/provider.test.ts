import { test, expect, describe } from 'bun:test';
import { modelId, providerId } from '@nexus/core';
import type { NexusErrorCode } from '@nexus/core';
import { createOpenAICompatibleProvider } from '../src/provider.ts';
import { OPENAI_COMPATIBLE_PRESETS } from '../src/presets.ts';
import { okResponse, stubFetch, testModels } from './support.ts';

const build = (over: Partial<Parameters<typeof createOpenAICompatibleProvider>[0]> = {}) =>
  createOpenAICompatibleProvider({
    id: 'testcorp',
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'test-key-value',
    models: testModels,
    fetch: stubFetch(() => ({ body: okResponse })),
    ...over,
  });

const request = {
  model: modelId('test-small'),
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }],
};

describe('configuration', () => {
  test('is unconfigured without a credential', () => {
    expect(build({ apiKey: undefined }).isConfigured()).toBe(false);
    expect(build({ apiKey: '   ' }).isConfigured()).toBe(false);
  });

  test('a credential-optional endpoint is configured without one', () => {
    // Local runtimes legitimately need no key.
    expect(build({ apiKey: undefined, credentialOptional: true }).isConfigured()).toBe(true);
  });

  test('an unconfigured provider never reaches the network', async () => {
    const fetcher = stubFetch(() => ({ body: okResponse }));
    const provider = build({ apiKey: undefined, fetch: fetcher });

    const result = await provider.generate(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_CONFIGURED');
    expect(fetcher.calls).toHaveLength(0);
  });
});

describe('requests', () => {
  test('posts to the chat-completions path with a bearer credential', async () => {
    const fetcher = stubFetch(() => ({ body: okResponse }));
    await build({ fetch: fetcher }).generate(request);

    expect(fetcher.calls[0]?.url).toBe('https://example.invalid/v1/chat/completions');
    expect(fetcher.calls[0]?.headers['authorization']).toBe('Bearer test-key-value');
    expect(fetcher.calls[0]?.body['model']).toBe('test-small');
  });

  test('merges extra headers some gateways require', async () => {
    const fetcher = stubFetch(() => ({ body: okResponse }));
    await build({ fetch: fetcher, headers: { 'http-referer': 'https://nexus.local' } }).generate(request);
    expect(fetcher.calls[0]?.headers['http-referer']).toBe('https://nexus.local');
  });

  test('maps a successful response into neutral types', async () => {
    const result = await build().generate(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(result.value.stopReason).toBe('stop');
    expect(result.value.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(result.value.provider).toBe(providerId('testcorp'));
  });
});

describe('failure mapping', () => {
  const httpCases: [number, NexusErrorCode][] = [
    [401, 'NOT_CONFIGURED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'PROVIDER_UNAVAILABLE'],
    [503, 'PROVIDER_UNAVAILABLE'],
    [400, 'INVALID_INPUT'],
  ];

  test.each(httpCases)('maps HTTP %i onto %s', async (status, code) => {
    const result = await build({
      fetch: stubFetch(() => ({ status, body: { error: 'nope' } })),
    }).generate(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  test('captures retry-after so the router can back off rather than fail over', async () => {
    const result = await build({
      fetch: stubFetch(() => ({ status: 429, body: {}, headers: { 'retry-after': '30' } })),
    }).generate(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details?.['retryAfterMs']).toBe(30_000);
  });

  test('a transport failure is a Result, not a throw', async () => {
    const result = await build({
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    }).generate(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  test('malformed JSON is reported, not thrown', async () => {
    const result = await build({
      fetch: stubFetch(() => ({ body: 'not json at all' })),
    }).generate(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  test('an empty choices array is reported rather than yielding empty content', async () => {
    const result = await build({
      fetch: stubFetch(() => ({ body: { choices: [] } })),
    }).generate(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  test('an already-aborted signal is CANCELLED and sends nothing', async () => {
    const fetcher = stubFetch(() => ({ body: okResponse }));
    const controller = new AbortController();
    controller.abort();

    const result = await build({ fetch: fetcher }).generate({ ...request, signal: controller.signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CANCELLED');
    expect(fetcher.calls).toHaveLength(0);
  });
});

describe('health', () => {
  test('is unavailable while unconfigured and healthy once configured', async () => {
    expect((await build({ apiKey: undefined }).health()).status).toBe('unavailable');
    expect((await build().health()).status).toBe('healthy');
  });

  test('does not spend a request probing reachability', async () => {
    // Free tiers charge for every call; health is polled often.
    const fetcher = stubFetch(() => ({ body: okResponse }));
    await build({ fetch: fetcher }).health();
    expect(fetcher.calls).toHaveLength(0);
  });

  test('never leaks the credential', async () => {
    const report = JSON.stringify(await build({ apiKey: 'sk-super-secret-value' }).health());
    expect(report).not.toContain('sk-super-secret-value');
  });
});

describe('presets', () => {
  test('declare base URLs but no invented model catalogues', () => {
    for (const preset of Object.values(OPENAI_COMPATIBLE_PRESETS)) {
      expect(preset.baseUrl).toMatch(/^https?:\/\//);
      expect('models' in preset).toBe(false);
    }
  });

  test('the local runtime preset needs no credential', () => {
    expect('apiKeyEnv' in OPENAI_COMPATIBLE_PRESETS.ollama).toBe(false);
  });
});
