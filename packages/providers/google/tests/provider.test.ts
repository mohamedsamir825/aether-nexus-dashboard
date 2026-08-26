import { test, expect, describe } from 'bun:test';
import { modelId, providerId } from '@nexus/core';
import type { NexusErrorCode } from '@nexus/core';
import { createGoogleProvider } from '../src/provider.ts';
import { okResponse, stubFetch, testModels } from './support.ts';

const build = (over: Partial<Parameters<typeof createGoogleProvider>[0]> = {}) =>
  createGoogleProvider({
    apiKey: 'test-key-value',
    models: testModels,
    fetch: stubFetch(() => ({ body: okResponse })),
    ...over,
  });

const request = {
  model: modelId('gemini-test-flash'),
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }],
};

describe('transport', () => {
  test('addresses the model in the URL path, not the body', () => {
    const fetcher = stubFetch(() => ({ body: okResponse }));
    return build({ fetch: fetcher })
      .generate(request)
      .then(() => {
        expect(fetcher.calls[0]?.url).toBe(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-flash:generateContent',
        );
        expect('model' in (fetcher.calls[0]?.body ?? {})).toBe(false);
      });
  });

  test('sends the credential as a header, not a query parameter', async () => {
    // Query strings leak into proxy logs and browser history.
    const fetcher = stubFetch(() => ({ body: okResponse }));
    await build({ fetch: fetcher }).generate(request);
    expect(fetcher.calls[0]?.headers['x-goog-api-key']).toBe('test-key-value');
    expect(fetcher.calls[0]?.url).not.toContain('key=');
  });

  test('an unconfigured provider never reaches the network', async () => {
    const fetcher = stubFetch(() => ({ body: okResponse }));
    const result = await build({ apiKey: undefined, fetch: fetcher }).generate(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_CONFIGURED');
    expect(fetcher.calls).toHaveLength(0);
  });

  test('honours a base URL override', async () => {
    const fetcher = stubFetch(() => ({ body: okResponse }));
    await build({ fetch: fetcher, baseUrl: 'https://proxy.invalid/v1' }).generate(request);
    expect(fetcher.calls[0]?.url).toStartWith('https://proxy.invalid/v1/models/');
  });
});

describe('responses', () => {
  test('maps a successful response into neutral types', async () => {
    const result = await build().generate(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(result.value.stopReason).toBe('stop');
    expect(result.value.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(result.value.provider).toBe(providerId('google'));
  });

  test('a function-call turn is reported as tool_use', async () => {
    const result = await build({
      fetch: stubFetch(() => ({
        body: {
          candidates: [
            {
              content: { parts: [{ functionCall: { name: 'search', args: { q: 'x' } } }] },
              finishReason: 'STOP',
            },
          ],
        },
      })),
    }).generate(request);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.stopReason).toBe('tool_use');
  });

  test('a blocked prompt is an error, not an empty answer', async () => {
    // Google returns no candidates at all. Treating that as empty content would
    // hand the agent silence and let it carry on.
    const result = await build({
      fetch: stubFetch(() => ({ body: { promptFeedback: { blockReason: 'SAFETY' } } })),
    }).generate(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNSUPPORTED');
      expect(result.error.details?.['blockReason']).toBe('SAFETY');
    }
  });

  test('no candidates is reported rather than yielding empty content', async () => {
    const result = await build({
      fetch: stubFetch(() => ({ body: { candidates: [] } })),
    }).generate(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
  });
});

describe('failure mapping', () => {
  const cases: [number, NexusErrorCode][] = [
    [401, 'NOT_CONFIGURED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'PROVIDER_UNAVAILABLE'],
    [400, 'INVALID_INPUT'],
  ];

  test.each(cases)('maps HTTP %i onto %s', async (status, code) => {
    const result = await build({
      fetch: stubFetch(() => ({ status, body: { error: { message: 'nope' } } })),
    }).generate(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  test('Google reports an invalid key as 400; that is a configuration problem', async () => {
    const result = await build({
      fetch: stubFetch(() => ({ status: 400, body: { error: { message: 'API key not valid' } } })),
    }).generate(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  test('captures retry-after for backoff', async () => {
    const result = await build({
      fetch: stubFetch(() => ({ status: 429, body: {}, headers: { 'retry-after': '12' } })),
    }).generate(request);
    if (!result.ok) expect(result.error.details?.['retryAfterMs']).toBe(12_000);
  });

  test('a transport failure is a Result, not a throw', async () => {
    const result = await build({ fetch: () => Promise.reject(new Error('ENOTFOUND')) }).generate(request);
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
  test('reflects configuration without spending a request', async () => {
    const fetcher = stubFetch(() => ({ body: okResponse }));
    expect((await build({ apiKey: undefined }).health()).status).toBe('unavailable');
    expect((await build({ fetch: fetcher }).health()).status).toBe('healthy');
    expect(fetcher.calls).toHaveLength(0);
  });

  test('never leaks the credential', async () => {
    const report = JSON.stringify(await build({ apiKey: 'AIza-super-secret-value' }).health());
    expect(report).not.toContain('AIza-super-secret-value');
  });
});
