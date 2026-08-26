import { test, expect, describe } from 'bun:test';
import { createToolBelt } from '../src/runtime/tool-belt.ts';
import { createToolRegistry } from '../src/registry/registries.ts';
import { createExecutionContext } from '../src/runtime/execution.ts';
import { createInMemoryEventBus } from '../src/runtime/event-bus.ts';
import { allowListPolicy, createPermissionEngine } from '../src/runtime/permissions.ts';
import { fixedClock } from '../src/clock.ts';
import { toolId } from '../src/ids.ts';
import type { PermissionEngine, Subject } from '../src/contracts/permissions.ts';
import { sequentialIds, stubTool } from './support/doubles.ts';

const clock = fixedClock(new Date('2026-01-01T00:00:00Z'));
const subject: Subject = { kind: 'agent', id: 'test.agent' };

const grantAll = createPermissionEngine([
  allowListPolicy('grants', [{ subject: { kind: 'agent' }, capabilities: ['tool:execute', 'net:fetch'] }]),
]);

function context(permissions: PermissionEngine = grantAll) {
  return createExecutionContext({
    actor: subject,
    events: createInMemoryEventBus(),
    permissions,
    clock,
    ids: sequentialIds(),
  });
}

describe('tool belt', () => {
  test('invokes a tool that is on the belt', async () => {
    const registry = createToolRegistry();
    registry.register(stubTool({ id: 'echo' }));
    const belt = createToolBelt({ registry, subject, allowed: [toolId('echo')] });

    const result = await belt.invoke({ toolId: toolId('echo'), input: { value: 'hi' } }, context());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.output).toEqual({ echoed: 'hi' });
  });

  test('refuses a registered tool the agent did not declare', async () => {
    const registry = createToolRegistry();
    registry.register(stubTool({ id: 'wire-transfer' }));
    const belt = createToolBelt({ registry, subject, allowed: [toolId('echo')] });

    const result = await belt.invoke({ toolId: toolId('wire-transfer'), input: { value: 'x' } }, context());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');
  });

  test('hides undeclared tools from list() and has()', () => {
    const registry = createToolRegistry();
    registry.register(stubTool({ id: 'echo' }));
    registry.register(stubTool({ id: 'wire-transfer' }));
    const belt = createToolBelt({ registry, subject, allowed: [toolId('echo')] });

    expect(belt.list().map((d) => d.id)).toEqual([toolId('echo')]);
    expect(belt.has(toolId('wire-transfer'))).toBe(false);
  });

  test('enforces every capability the tool declares', async () => {
    const registry = createToolRegistry();
    registry.register(stubTool({ id: 'fetch', requiredCapabilities: ['net:fetch', 'secrets:read'] }));
    const belt = createToolBelt({ registry, subject, allowed: [toolId('fetch')] });

    const result = await belt.invoke({ toolId: toolId('fetch'), input: { value: 'x' } }, context());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
      expect(result.error.details?.['capability']).toBe('secrets:read');
    }
  });

  test('validates input before executing', async () => {
    const registry = createToolRegistry();
    registry.register(stubTool({ id: 'echo' }));
    const belt = createToolBelt({ registry, subject, allowed: [toolId('echo')] });

    const result = await belt.invoke({ toolId: toolId('echo'), input: { value: 42 } }, context());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
  });

  test('reports NOT_FOUND for a declared but unregistered tool', async () => {
    const belt = createToolBelt({
      registry: createToolRegistry(),
      subject,
      allowed: [toolId('ghost')],
    });
    const result = await belt.invoke({ toolId: toolId('ghost'), input: { value: 'x' } }, context());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  test('rejects an evidence-declaring tool that returns no evidence', async () => {
    const registry = createToolRegistry();
    registry.register(stubTool({ id: 'research', producesEvidence: true, omitEvidence: true }));
    const belt = createToolBelt({ registry, subject, allowed: [toolId('research')] });

    const result = await belt.invoke({ toolId: toolId('research'), input: { value: 'x' } }, context());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('declares evidence but returned none');
  });

  test('accepts an evidence-declaring tool that supplies evidence', async () => {
    const registry = createToolRegistry();
    registry.register(stubTool({ id: 'research', producesEvidence: true }));
    const belt = createToolBelt({ registry, subject, allowed: [toolId('research')] });

    const result = await belt.invoke({ toolId: toolId('research'), input: { value: 'claim' } }, context());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.evidence).toHaveLength(1);
  });

  test('contains a tool that throws', async () => {
    const registry = createToolRegistry();
    registry.register(stubTool({ id: 'boom', throwWith: 'disk on fire' }));
    const belt = createToolBelt({ registry, subject, allowed: [toolId('boom')] });

    const result = await belt.invoke({ toolId: toolId('boom'), input: { value: 'x' } }, context());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTERNAL');
      expect(result.error.message).toContain('disk on fire');
    }
  });
});
