/**
 * Requirement 10 -- never commit or emit secrets -- is enforced by tests here,
 * not by convention. If describeConfig ever starts leaking key material, these
 * fail.
 */
import { test, expect, describe } from 'bun:test';
import { KNOWN_PROVIDERS, describeConfig, loadConfig, redactSecrets } from '../src/config/config.ts';

describe('loadConfig', () => {
  test('defaults to development/info with every provider disabled', () => {
    const result = loadConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.environment).toBe('development');
    expect(result.value.logLevel).toBe('info');
    for (const name of KNOWN_PROVIDERS) {
      expect(result.value.providers[name]?.enabled).toBe(false);
      expect(result.value.providers[name]?.apiKey).toBeUndefined();
    }
  });

  test('enables a provider only when its key is present and non-blank', () => {
    const result = loadConfig({
      NEXUS_ANTHROPIC_API_KEY: 'sk-ant-test-value',
      NEXUS_OPENAI_API_KEY: '   ',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.providers['anthropic']?.enabled).toBe(true);
    expect(result.value.providers['openai']?.enabled).toBe(false);
  });

  test('reads a base URL override', () => {
    const result = loadConfig({ NEXUS_OPENROUTER_BASE_URL: 'https://example.invalid/v1' });
    expect(result.ok && result.value.providers['openrouter']?.baseUrl).toBe('https://example.invalid/v1');
  });

  test('rejects an invalid environment', () => {
    const result = loadConfig({ NEXUS_ENV: 'staging' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
  });

  test('rejects an invalid log level', () => {
    expect(loadConfig({ NEXUS_LOG_LEVEL: 'verbose' }).ok).toBe(false);
  });
});

describe('secret handling', () => {
  const secret = 'sk-ant-super-secret-value';

  test('describeConfig reports presence but never the credential', () => {
    const config = loadConfig({ NEXUS_ANTHROPIC_API_KEY: secret });
    expect(config.ok).toBe(true);
    if (!config.ok) return;

    const summary = describeConfig(config.value);
    const serialised = JSON.stringify(summary);

    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain('sk-ant');
    const anthropic = summary.providers.find((p) => p.id === 'anthropic');
    expect(anthropic?.credentialPresent).toBe(true);
    expect(anthropic?.enabled).toBe(true);
  });

  test('describeConfig output has no key-bearing fields at all', () => {
    const config = loadConfig({ NEXUS_OPENAI_API_KEY: secret });
    if (!config.ok) throw new Error('expected config');
    for (const provider of describeConfig(config.value).providers) {
      expect(Object.keys(provider).sort()).toEqual([
        'baseUrlOverridden',
        'credentialPresent',
        'enabled',
        'id',
      ]);
    }
  });

  test('redactSecrets removes credentials from free text', () => {
    const line = `request failed with key ${secret} attached`;
    expect(redactSecrets(line, [secret])).toBe('request failed with key [REDACTED] attached');
  });

  test('redactSecrets ignores undefined and implausibly short values', () => {
    expect(redactSecrets('a b c', [undefined, 'b'])).toBe('a b c');
  });
});
