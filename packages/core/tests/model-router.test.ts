/**
 * These tests are the guarantee behind core principle 2: an agent states a
 * policy and never names a vendor. Every case below changes only which
 * providers are registered -- never any calling code.
 */
import { test, expect, describe } from 'bun:test';
import { createModelRouter } from '../src/runtime/model-router.ts';
import { createProviderRegistry } from '../src/registry/registries.ts';
import { modelId, providerId } from '../src/ids.ts';
import { stubProvider } from './support/doubles.ts';
import type { Message } from '../src/contracts/model-provider.ts';

const messages: readonly Message[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];

describe('model router', () => {
  test('fails safely with NOT_CONFIGURED when no provider is registered', async () => {
    const router = createModelRouter(createProviderRegistry());
    const result = await router.route({ requiredCapabilities: ['text'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  test('excludes providers that are registered but unconfigured', async () => {
    const registry = createProviderRegistry();
    registry.register(stubProvider({ id: 'openai', configured: false }));
    const result = await createModelRouter(registry).route({ requiredCapabilities: ['text'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  test('rejects a policy no model satisfies', async () => {
    const registry = createProviderRegistry();
    registry.register(stubProvider({ id: 'openai', models: [{ id: 'gpt', capabilities: ['text'] }] }));
    const result = await createModelRouter(registry).route({ requiredCapabilities: ['vision'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  test('selects by declared capability', async () => {
    const registry = createProviderRegistry();
    registry.register(
      stubProvider({ id: 'openai', models: [{ id: 'text-only', capabilities: ['text'] }] }),
    );
    registry.register(
      stubProvider({ id: 'google', models: [{ id: 'multimodal', capabilities: ['text', 'vision'] }] }),
    );

    const result = await createModelRouter(registry).route({ requiredCapabilities: ['text', 'vision'] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.model.id).toBe(modelId('multimodal'));
      expect(result.value.provider).toBe(providerId('google'));
    }
  });

  test('filters on context window and cost ceiling', async () => {
    const registry = createProviderRegistry();
    registry.register(
      stubProvider({
        id: 'a',
        models: [{ id: 'small', capabilities: ['text'], contextWindow: 8_000, inputCostPer1k: 1 }],
      }),
    );
    registry.register(
      stubProvider({
        id: 'b',
        models: [{ id: 'large', capabilities: ['text'], contextWindow: 200_000, inputCostPer1k: 5 }],
      }),
    );
    const router = createModelRouter(registry);

    const big = await router.route({ requiredCapabilities: ['text'], minContextWindow: 100_000 });
    expect(big.ok && big.value.model.id).toBe(modelId('large'));

    const cheap = await router.route({ requiredCapabilities: ['text'], maxInputCostPer1k: 2 });
    expect(cheap.ok && cheap.value.model.id).toBe(modelId('small'));
  });

  test('honours explicit model preference over provider preference', async () => {
    const registry = createProviderRegistry();
    registry.register(stubProvider({ id: 'a', models: [{ id: 'a1', capabilities: ['text'] }] }));
    registry.register(stubProvider({ id: 'b', models: [{ id: 'b1', capabilities: ['text'] }] }));

    const result = await createModelRouter(registry).route({
      requiredCapabilities: ['text'],
      preferredProviders: [providerId('a')],
      preferredModels: [modelId('b1')],
    });
    expect(result.ok && result.value.model.id).toBe(modelId('b1'));
  });

  test('generate() reaches the selected provider without the caller naming it', async () => {
    const registry = createProviderRegistry();
    const provider = stubProvider({ id: 'anthropic', models: [{ id: 'm', capabilities: ['text'] }] });
    registry.register(provider);

    const result = await createModelRouter(registry).generate(
      { requiredCapabilities: ['text'] },
      { messages },
    );
    expect(result.ok).toBe(true);
    expect(provider.calls).toEqual(['m']);
  });

  test('falls back to the next candidate only when the policy allows it', async () => {
    const registry = createProviderRegistry();
    registry.register(
      stubProvider({
        id: 'primary',
        models: [{ id: 'p', capabilities: ['text'] }],
        failWith: 'primary is down',
      }),
    );
    registry.register(stubProvider({ id: 'backup', models: [{ id: 'b', capabilities: ['text'] }] }));
    const router = createModelRouter(registry);
    const policy = { requiredCapabilities: ['text'] as const, preferredProviders: [providerId('primary')] };

    const withoutFallback = await router.generate(policy, { messages });
    expect(withoutFallback.ok).toBe(false);

    const withFallback = await router.generate({ ...policy, allowFallback: true }, { messages });
    expect(withFallback.ok).toBe(true);
    if (withFallback.ok) expect(withFallback.value.provider).toBe(providerId('backup'));
  });

  test('contains a provider adapter that throws', async () => {
    const registry = createProviderRegistry();
    registry.register(
      stubProvider({
        id: 'broken',
        models: [{ id: 'x', capabilities: ['text'] }],
        throwWith: 'socket hang up',
      }),
    );
    const result = await createModelRouter(registry).generate(
      { requiredCapabilities: ['text'] },
      { messages },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
      expect(result.error.message).toContain('socket hang up');
    }
  });

  test('skips a provider that cannot list models rather than aborting', async () => {
    const registry = createProviderRegistry();
    registry.register(stubProvider({ id: 'flaky', listModelsFails: true }));
    registry.register(stubProvider({ id: 'good', models: [{ id: 'g', capabilities: ['text'] }] }));

    const result = await createModelRouter(registry).route({ requiredCapabilities: ['text'] });
    expect(result.ok && result.value.provider).toBe(providerId('good'));
  });
});
