/**
 * ExecutionBudget was defined in Phase 1 and enforced by nothing (spec §27 C5).
 * These tests are the enforcement.
 */
import { test, expect, describe } from 'bun:test';
import { createBudgetGuard, unlimitedBudgetGuard } from '../src/runtime/budget.ts';
import { createBudgetedRouter } from '../src/runtime/budgeted-router.ts';
import { createModelRouter } from '../src/runtime/model-router.ts';
import { createProviderRegistry } from '../src/registry/registries.ts';
import { fixedClock } from '../src/clock.ts';
import { stubProvider } from './support/doubles.ts';
import type { Message } from '../src/contracts/model-provider.ts';

const messages: readonly Message[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
const start = () => fixedClock(new Date('2026-01-01T00:00:00Z'));

describe('budget guard', () => {
  test('an unset dimension means no limit, not zero', () => {
    const guard = createBudgetGuard({}, start());
    for (let i = 0; i < 50; i++) {
      expect(guard.chargeToolCall().ok).toBe(true);
      expect(guard.chargeModelCall().ok).toBe(true);
    }
    expect(guard.usage.toolCalls).toBe(50);
  });

  test('enforces maxToolCalls', () => {
    const guard = createBudgetGuard({ maxToolCalls: 2 }, start());
    expect(guard.chargeToolCall().ok).toBe(true);
    expect(guard.chargeToolCall().ok).toBe(true);

    const third = guard.chargeToolCall();
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.error.code).toBe('BUDGET_EXCEEDED');
      expect(third.error.details?.['dimension']).toBe('maxToolCalls');
    }
  });

  test('enforces maxModelCalls independently of tool calls', () => {
    const guard = createBudgetGuard({ maxModelCalls: 1 }, start());
    expect(guard.chargeModelCall().ok).toBe(true);
    expect(guard.chargeModelCall().ok).toBe(false);
    // Tool calls are a separate dimension and remain unlimited.
    expect(guard.chargeToolCall().ok).toBe(true);
  });

  test('a refused charge is not counted', () => {
    const guard = createBudgetGuard({ maxToolCalls: 1 }, start());
    guard.chargeToolCall();
    guard.chargeToolCall();
    guard.chargeToolCall();
    expect(guard.usage.toolCalls).toBe(1);
  });

  test('enforces the wall-clock deadline', () => {
    const clock = start();
    const guard = createBudgetGuard({ timeoutMs: 1_000 }, clock);
    expect(guard.checkDeadline().ok).toBe(true);

    clock.advance(1_000);
    const late = guard.checkDeadline();
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.details?.['dimension']).toBe('timeoutMs');
  });

  test('an expired run cannot spend its remaining call allowance', () => {
    const clock = start();
    const guard = createBudgetGuard({ timeoutMs: 500, maxToolCalls: 100 }, clock);
    expect(guard.chargeToolCall().ok).toBe(true);

    clock.advance(500);
    const afterTimeout = guard.chargeToolCall();
    expect(afterTimeout.ok).toBe(false);
    if (!afterTimeout.ok) expect(afterTimeout.error.details?.['dimension']).toBe('timeoutMs');
  });

  test('unlimitedBudgetGuard never refuses', () => {
    const guard = unlimitedBudgetGuard(start());
    expect(guard.chargeModelCall().ok).toBe(true);
    expect(guard.checkDeadline().ok).toBe(true);
  });
});

describe('budgeted router', () => {
  const registry = () => {
    const r = createProviderRegistry();
    r.register(stubProvider({ id: 'free', models: [{ id: 'm', capabilities: ['text'] }] }));
    return r;
  };

  test('charges one model call per generate', async () => {
    const guard = createBudgetGuard({ maxModelCalls: 2 }, start());
    const router = createBudgetedRouter(createModelRouter(registry()), guard);

    expect((await router.generate({ requiredCapabilities: ['text'] }, { messages })).ok).toBe(true);
    expect((await router.generate({ requiredCapabilities: ['text'] }, { messages })).ok).toBe(true);

    const third = await router.generate({ requiredCapabilities: ['text'] }, { messages });
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe('BUDGET_EXCEEDED');
  });

  test('refuses before reaching the provider', async () => {
    const r = createProviderRegistry();
    const provider = stubProvider({ id: 'free', models: [{ id: 'm', capabilities: ['text'] }] });
    r.register(provider);

    const guard = createBudgetGuard({ maxModelCalls: 0 }, start());
    const router = createBudgetedRouter(createModelRouter(r), guard);

    const result = await router.generate({ requiredCapabilities: ['text'] }, { messages });
    expect(result.ok).toBe(false);
    // The whole point of charging first: no provider was contacted.
    expect(provider.calls).toEqual([]);
  });

  test('route() resolves a policy without spending a model call', async () => {
    const guard = createBudgetGuard({ maxModelCalls: 1 }, start());
    const router = createBudgetedRouter(createModelRouter(registry()), guard);

    expect((await router.route({ requiredCapabilities: ['text'] })).ok).toBe(true);
    expect(guard.usage.modelCalls).toBe(0);
    expect((await router.generate({ requiredCapabilities: ['text'] }, { messages })).ok).toBe(true);
  });
});
