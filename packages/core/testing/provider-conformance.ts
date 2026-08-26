/**
 * The conformance suite every ModelProvider must pass.
 *
 * Lives outside `src/` on purpose: it imports `bun:test`, and the Core's
 * production source must not depend on a test framework. It is published as the
 * `@nexus/core/testing` entry point so provider packages can run it against
 * their own adapter.
 *
 * Everything here runs **offline**. The point is to prove an adapter honours
 * the contract -- returns Results instead of throwing, reports configuration
 * honestly, describes its models truthfully -- without a credential or a
 * network call. Tests that need a real key are opt-in via `live`.
 */
import { describe, test, expect } from 'bun:test';
import type { ModelProvider } from '../src/contracts/model-provider.ts';

export interface ProviderConformanceSuite {
  /** Human name, used in the test titles. */
  readonly name: string;
  /** A provider with credentials present (they need not be valid). */
  readonly createConfigured: () => ModelProvider;
  /** The same provider with credentials absent. */
  readonly createUnconfigured: () => ModelProvider;
  /**
   * Opt in to tests that make real network calls. Leave false in CI unless a
   * working credential is available.
   */
  readonly live?: boolean;
}

export function describeProviderConformance(suite: ProviderConformanceSuite): void {
  describe(`${suite.name} — ModelProvider conformance`, () => {
    // --- identity --------------------------------------------------------
    test('has a stable, non-empty identity', () => {
      const a = suite.createConfigured();
      const b = suite.createConfigured();
      expect(a.id.length).toBeGreaterThan(0);
      expect(a.displayName.length).toBeGreaterThan(0);
      expect(a.id).toBe(b.id);
    });

    // --- configuration ---------------------------------------------------
    test('reports configuration honestly', () => {
      expect(suite.createConfigured().isConfigured()).toBe(true);
      expect(suite.createUnconfigured().isConfigured()).toBe(false);
    });

    test('an unconfigured provider fails generate() with a Result, never a throw', async () => {
      const provider = suite.createUnconfigured();
      const result = await provider.generate({
        model: 'anything' as never,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_CONFIGURED');
    });

    test('an unconfigured provider fails embed() the same way, when it offers one', async () => {
      const provider = suite.createUnconfigured();
      if (!provider.embed) return; // genuinely optional; nothing to assert
      const result = await provider.embed({ model: 'anything' as never, input: ['hi'] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_CONFIGURED');
    });

    // --- model catalogue -------------------------------------------------
    test('describes its models truthfully', async () => {
      const provider = suite.createConfigured();
      const models = await provider.listModels();
      expect(models.ok).toBe(true);
      if (!models.ok) return;

      expect(models.value.length).toBeGreaterThan(0);
      for (const model of models.value) {
        expect(model.id.length).toBeGreaterThan(0);
        // A model must claim the provider that serves it, or routing breaks.
        expect(model.provider).toBe(provider.id);
        expect(model.displayName.length).toBeGreaterThan(0);
        expect(model.capabilities.length).toBeGreaterThan(0);
        expect(model.contextWindow).toBeGreaterThan(0);
        expect(model.maxOutputTokens).toBeGreaterThan(0);
        if (model.inputCostPer1k !== undefined) {
          expect(model.inputCostPer1k).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test('model ids are unique within the provider', async () => {
      const models = await suite.createConfigured().listModels();
      if (!models.ok) return;
      const ids = models.value.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    test('listModels() is stable across calls', async () => {
      const provider = suite.createConfigured();
      const first = await provider.listModels();
      const second = await provider.listModels();
      expect(first.ok && second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(first.value.map((m) => m.id).sort()).toEqual(second.value.map((m) => m.id).sort());
      }
    });

    // --- health ----------------------------------------------------------
    test('health() reports without throwing, in either configuration', async () => {
      for (const provider of [suite.createConfigured(), suite.createUnconfigured()]) {
        const report = await provider.health();
        expect(['healthy', 'degraded', 'unavailable']).toContain(report.status);
        expect(report.component.length).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(report.checkedAt))).toBe(false);
      }
    });

    test('an unconfigured provider is not healthy', async () => {
      const report = await suite.createUnconfigured().health();
      expect(report.status).not.toBe('healthy');
    });

    test('health output carries no credential material', async () => {
      const serialised = JSON.stringify(await suite.createConfigured().health());
      for (const marker of ['sk-', 'Bearer ', 'api_key', 'apiKey']) {
        expect(serialised).not.toContain(marker);
      }
    });

    // --- cancellation ----------------------------------------------------
    test('an already-aborted request returns a Result, never a throw', async () => {
      const provider = suite.createConfigured();
      const models = await provider.listModels();
      if (!models.ok || !models.value[0]) return;

      const controller = new AbortController();
      controller.abort();

      const result = await provider.generate({
        model: models.value[0].id,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        signal: controller.signal,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(['CANCELLED', 'NOT_CONFIGURED']).toContain(result.error.code);
    });

    // --- live (opt-in) ---------------------------------------------------
    const live = suite.live === true ? test : test.skip;

    live('completes a minimal real generation', async () => {
      const provider = suite.createConfigured();
      const models = await provider.listModels();
      expect(models.ok).toBe(true);
      if (!models.ok) return;

      const textModel = models.value.find((m) => m.capabilities.includes('text'));
      expect(textModel).toBeDefined();
      if (!textModel) return;

      const result = await provider.generate({
        model: textModel.id,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with the word OK.' }] }],
        maxOutputTokens: 16,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.provider).toBe(provider.id);
      expect(result.value.content.length).toBeGreaterThan(0);
      expect(result.value.usage.outputTokens).toBeGreaterThan(0);
    }, 30_000);
  });
}
