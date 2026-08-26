import { test, expect, describe } from 'bun:test';
import {
  allowListPolicy,
  createPermissionEngine,
  denyListPolicy,
} from '../src/runtime/permissions.ts';
import type { Subject } from '../src/contracts/permissions.ts';

const agent: Subject = { kind: 'agent', id: 'finance.cfo' };

describe('permission engine', () => {
  test('denies by default when no policy is registered', () => {
    const engine = createPermissionEngine([]);
    const decision = engine.check({ subject: agent, capability: 'tool:execute' });
    expect(decision.allowed).toBe(false);
    expect(decision.policyId).toBe('default-deny');
  });

  test('denies by default when every policy abstains', () => {
    const engine = createPermissionEngine([allowListPolicy('grants', [])]);
    expect(engine.check({ subject: agent, capability: 'tool:execute' }).allowed).toBe(false);
  });

  test('allows a capability that is explicitly granted', () => {
    const engine = createPermissionEngine([
      allowListPolicy('grants', [
        { subject: { kind: 'agent', id: 'finance.cfo' }, capabilities: ['tool:execute'] },
      ]),
    ]);
    expect(engine.check({ subject: agent, capability: 'tool:execute' }).allowed).toBe(true);
    expect(engine.check({ subject: agent, capability: 'memory:write' }).allowed).toBe(false);
  });

  test('does not leak a grant across subjects', () => {
    const engine = createPermissionEngine([
      allowListPolicy('grants', [
        { subject: { kind: 'agent', id: 'finance.cfo' }, capabilities: ['tool:execute'] },
      ]),
    ]);
    const other: Subject = { kind: 'agent', id: 'engineering.architect' };
    expect(engine.check({ subject: other, capability: 'tool:execute' }).allowed).toBe(false);
  });

  test('honours resource scoping on a grant', () => {
    const engine = createPermissionEngine([
      allowListPolicy('grants', [
        {
          subject: { kind: 'agent' },
          capabilities: ['tool:execute'],
          resources: ['tool.search'],
        },
      ]),
    ]);
    expect(
      engine.check({ subject: agent, capability: 'tool:execute', resource: 'tool.search' }).allowed,
    ).toBe(true);
    expect(
      engine.check({ subject: agent, capability: 'tool:execute', resource: 'tool.wire-transfer' })
        .allowed,
    ).toBe(false);
    // A resource-scoped grant must not match a request with no resource at all.
    expect(engine.check({ subject: agent, capability: 'tool:execute' }).allowed).toBe(false);
  });

  test('an earlier deny policy wins over a later allow', () => {
    const engine = createPermissionEngine([
      denyListPolicy('kill-switch', ['net:fetch']),
      allowListPolicy('grants', [{ subject: { kind: 'agent' }, capabilities: ['net:fetch'] }]),
    ]);
    const decision = engine.check({ subject: agent, capability: 'net:fetch' });
    expect(decision.allowed).toBe(false);
    expect(decision.policyId).toBe('kill-switch');
  });

  test('require() returns a PERMISSION_DENIED Result carrying context', () => {
    const engine = createPermissionEngine([]);
    const result = engine.require({ subject: agent, capability: 'net:fetch', resource: 'api' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
      expect(result.error.details?.['subject']).toBe('agent:finance.cfo');
      expect(result.error.details?.['capability']).toBe('net:fetch');
    }
  });

  test('every decision explains itself', () => {
    const engine = createPermissionEngine([
      allowListPolicy('grants', [{ subject: { kind: 'agent' }, capabilities: ['a'] }]),
    ]);
    expect(engine.check({ subject: agent, capability: 'a' }).reason.length).toBeGreaterThan(0);
    expect(engine.check({ subject: agent, capability: 'b' }).reason.length).toBeGreaterThan(0);
  });
});
