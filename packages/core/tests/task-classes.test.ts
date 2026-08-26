import { test, expect, describe } from 'bun:test';
import {
  DEFAULT_TASK_CLASSES,
  createTaskClassRegistry,
} from '../src/runtime/task-classes.ts';
import { providerId } from '../src/ids.ts';

describe('task classes', () => {
  test('resolves a default class to a policy', () => {
    const registry = createTaskClassRegistry();
    const policy = registry.policyFor('tool-use');
    expect(policy.ok).toBe(true);
    if (policy.ok) expect(policy.value.requiredCapabilities).toEqual(['text', 'tool_use']);
  });

  test('an unknown class fails with the available names, not silently', () => {
    const result = createTaskClassRegistry().policyFor('nonexistent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.details?.['available']).toContain('text');
    }
  });

  test('the defaults name capabilities, never vendors', () => {
    // The Core must not know which provider is fastest or cheapest; a
    // deployment expresses that by overriding a class.
    for (const policy of Object.values(DEFAULT_TASK_CLASSES)) {
      expect('preferredProviders' in policy).toBe(false);
      expect('preferredModels' in policy).toBe(false);
      expect(policy.requiredCapabilities.length).toBeGreaterThan(0);
    }
  });

  test('every default allows fallback', () => {
    // On free tiers the next provider is almost always a better answer than a
    // failure.
    for (const policy of Object.values(DEFAULT_TASK_CLASSES)) {
      expect(policy.allowFallback).toBe(true);
    }
  });

  test('a deployment can override a class with vendor preferences', () => {
    const registry = createTaskClassRegistry({
      overrides: {
        text: {
          requiredCapabilities: ['text'],
          preferredProviders: [providerId('groq')],
          allowFallback: true,
        },
      },
    });
    const policy = registry.policyFor('text');
    expect(policy.ok && policy.value.preferredProviders).toEqual([providerId('groq')]);
  });

  test('a deployment can add classes of its own', () => {
    const registry = createTaskClassRegistry({
      overrides: { 'finance.forecast': { requiredCapabilities: ['text'], minContextWindow: 500_000 } },
    });
    expect(registry.policyFor('finance.forecast').ok).toBe(true);
    expect(registry.list()).toContain('finance.forecast');
  });

  test('defaults can be excluded entirely', () => {
    const registry = createTaskClassRegistry({
      includeDefaults: false,
      overrides: { only: { requiredCapabilities: ['text'] } },
    });
    expect(registry.list()).toEqual(['only']);
    expect(registry.policyFor('text').ok).toBe(false);
  });
});
