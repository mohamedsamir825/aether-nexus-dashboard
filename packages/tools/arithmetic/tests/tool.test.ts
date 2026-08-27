import { test, expect, describe } from 'bun:test';
import {
  createInMemoryEventBus,
  createExecutionContext,
  createPermissionEngine,
  fixedClock,
} from '@nexus/core';
import { createMathEvaluateTool, mathEvaluateDescriptor } from '../src/tool.ts';

const clock = fixedClock(new Date('2026-01-01T00:00:00Z'));
const tool = createMathEvaluateTool();

const context = () =>
  createExecutionContext({
    actor: { kind: 'agent', id: 'test.agent' },
    events: createInMemoryEventBus(),
    permissions: createPermissionEngine([]),
    clock,
  });

describe('descriptor', () => {
  test('declares no side effect', () => {
    // Pure computation needs no external-write authorisation.
    expect(mathEvaluateDescriptor.sideEffect).toBe('none');
  });

  test('declares that it produces evidence', () => {
    // A computed number is a claim; the expression is its evidence.
    expect(mathEvaluateDescriptor.producesEvidence).toBe(true);
  });

  test('requires an explicit capability', () => {
    expect(mathEvaluateDescriptor.requiredCapabilities).toContain('tool:execute');
  });
});

describe('validation', () => {
  test('accepts a well-formed input', () => {
    expect(tool.validate({ expression: '1 + 1' }).ok).toBe(true);
    expect(tool.validate({ expression: '1 + 1', precision: 2 }).ok).toBe(true);
  });

  test('rejects a missing or wrongly-typed expression', () => {
    expect(tool.validate({}).ok).toBe(false);
    expect(tool.validate({ expression: 42 }).ok).toBe(false);
    expect(tool.validate({ expression: '' }).ok).toBe(false);
  });

  test('rejects unknown properties rather than ignoring them', () => {
    // A caller passing an option we do not implement should learn that, not
    // have it silently dropped.
    expect(tool.validate({ expression: '1', mode: 'turbo' }).ok).toBe(false);
  });

  test('rejects an out-of-range precision', () => {
    expect(tool.validate({ expression: '1', precision: -1 }).ok).toBe(false);
    expect(tool.validate({ expression: '1', precision: 99 }).ok).toBe(false);
    expect(tool.validate({ expression: '1', precision: 1.5 }).ok).toBe(false);
  });
});

describe('execution', () => {
  test('computes and returns the expression alongside the result', async () => {
    const outcome = await tool.execute({ expression: '2 + 3 * 4' }, context());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.output).toEqual({ expression: '2 + 3 * 4', result: 14 });
  });

  test('applies the requested precision', async () => {
    const outcome = await tool.execute({ expression: '10 / 3', precision: 2 }, context());
    expect(outcome.ok && outcome.value.output.result).toBe(3.33);
  });

  test('produces evidence whose claim is the equation', async () => {
    const outcome = await tool.execute({ expression: '6 * 7' }, context());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const evidence = outcome.value.evidence?.[0];
    expect(evidence?.claim).toBe('6 * 7 = 42');
    expect(evidence?.source.kind).toBe('computation');
    expect(evidence?.source.retrievedAt).toBe('2026-01-01T00:00:00.000Z');
    // Deterministic arithmetic over a closed grammar: nothing is inferred.
    expect(evidence?.confidence).toBe(1);
  });

  test('a bad expression is a Result, not a throw', async () => {
    const outcome = await tool.execute({ expression: '1 / 0' }, context());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('INVALID_INPUT');
  });
});
