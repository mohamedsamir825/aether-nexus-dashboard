/**
 * The composition root must produce an honest system: empty, and truthful
 * about being empty. A foundation that reported "healthy" with no providers
 * registered would be exactly the kind of demo this project is not.
 */
import { test, expect, describe } from 'bun:test';
import { createNexusSystem } from '../src/system.ts';
import { loadConfig } from '../src/config/config.ts';
import { unwrap } from '../src/result.ts';
import { nullLogger } from '../src/logger.ts';
import { fixedClock } from '../src/clock.ts';
import { stubProvider } from './support/doubles.ts';

const clock = fixedClock(new Date('2026-01-01T00:00:00Z'));
const build = (env: Record<string, string | undefined> = {}) =>
  createNexusSystem({ config: unwrap(loadConfig(env)), logger: nullLogger, clock });

describe('nexus system', () => {
  test('starts with empty registries', () => {
    const system = build();
    expect(system.registries.agents.size).toBe(0);
    expect(system.registries.tools.size).toBe(0);
    expect(system.registries.skills.size).toBe(0);
    expect(system.registries.providers.size).toBe(0);
  });

  test('denies everything until a policy is supplied', () => {
    const system = build();
    const decision = system.permissions.check({
      subject: { kind: 'agent', id: 'anything' },
      capability: 'tool:execute',
    });
    expect(decision.allowed).toBe(false);
  });

  test('reports unavailable while no provider adapter is registered', async () => {
    const health = await build().reportHealth();
    expect(health.status).toBe('unavailable');
    const providers = health.components.find((c) => c.component === 'model-providers');
    expect(providers?.status).toBe('unavailable');
    expect(providers?.detail).toContain('no model provider adapters are registered');
  });

  test('a model call fails safely rather than pretending to succeed', async () => {
    const result = await build().models.generate(
      { requiredCapabilities: ['text'] },
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_CONFIGURED');
  });

  test('registering a configured provider brings the system up', async () => {
    const system = build();
    system.registries.providers.register(
      stubProvider({ id: 'anthropic', models: [{ id: 'm', capabilities: ['text'] }] }),
    );

    const health = await system.reportHealth();
    const providers = health.components.find((c) => c.component === 'model-providers');
    expect(providers?.status).toBe('healthy');
    // Memory is volatile, so the system as a whole is honestly 'degraded'.
    expect(health.status).toBe('degraded');
  });

  test('health metadata never carries credential values', async () => {
    const secret = 'sk-ant-super-secret-value';
    const system = createNexusSystem({
      config: unwrap(loadConfig({ NEXUS_ANTHROPIC_API_KEY: secret })),
      logger: nullLogger,
      clock,
    });

    const serialised = JSON.stringify(await system.reportHealth());
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain('sk-ant');
  });
});
