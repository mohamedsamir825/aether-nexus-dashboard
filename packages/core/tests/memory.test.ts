import { test, expect, describe } from 'bun:test';
import { createInMemoryMemoryStore, createScopedMemory } from '../src/runtime/memory.ts';
import { allowListPolicy, createPermissionEngine } from '../src/runtime/permissions.ts';
import { fixedClock } from '../src/clock.ts';
import { memoryId } from '../src/ids.ts';
import type { MemoryScope } from '../src/contracts/memory.ts';
import type { Subject } from '../src/contracts/permissions.ts';
import { sequentialIds } from './support/doubles.ts';

const clock = fixedClock(new Date('2026-01-01T00:00:00Z'));
const userScope: MemoryScope = { kind: 'user', id: 'u1' };
const financeScope: MemoryScope = { kind: 'division', id: 'finance' };
const agent: Subject = { kind: 'agent', id: 'finance.cfo' };

const newStore = () => createInMemoryMemoryStore({ clock, ids: sequentialIds() });

describe('in-memory memory store', () => {
  test('stores and recalls by scope', async () => {
    const store = newStore();
    await store.put({ scope: userScope, kind: 'fact', content: 'prefers concise answers' });
    await store.put({ scope: financeScope, kind: 'fact', content: 'fiscal year ends in March' });

    const userMemories = await store.query({ scope: userScope });
    expect(userMemories.ok && userMemories.value).toHaveLength(1);
    expect(userMemories.ok && userMemories.value[0]?.content).toBe('prefers concise answers');
  });

  test('rejects empty content', async () => {
    const result = await newStore().put({ scope: userScope, kind: 'fact', content: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
  });

  test('filters by kind, tag, text and limit', async () => {
    const store = newStore();
    await store.put({ scope: userScope, kind: 'fact', content: 'alpha', tags: ['x'] });
    await store.put({ scope: userScope, kind: 'preference', content: 'beta', tags: ['x', 'y'] });
    await store.put({ scope: userScope, kind: 'fact', content: 'gamma', tags: ['y'] });

    const facts = await store.query({ scope: userScope, kinds: ['fact'] });
    expect(facts.ok && facts.value).toHaveLength(2);

    const tagged = await store.query({ scope: userScope, tags: ['x', 'y'] });
    expect(tagged.ok && tagged.value).toHaveLength(1);

    const text = await store.query({ scope: userScope, text: 'GAMM' });
    expect(text.ok && text.value).toHaveLength(1);

    const limited = await store.query({ scope: userScope, limit: 2 });
    expect(limited.ok && limited.value).toHaveLength(2);
  });

  test('deletes, and reports NOT_FOUND for an unknown id', async () => {
    const store = newStore();
    const put = await store.put({ scope: userScope, kind: 'fact', content: 'x' });
    expect(put.ok).toBe(true);
    if (put.ok) expect((await store.delete(put.value.id)).ok).toBe(true);
    expect((await store.delete(memoryId('missing'))).ok).toBe(false);
  });

  test('reports itself as degraded so it is never mistaken for durable storage', async () => {
    const health = await newStore().health();
    expect(health.status).toBe('degraded');
    expect(health.detail).toContain('volatile');
  });
});

describe('scoped memory', () => {
  const grantAll = createPermissionEngine([
    allowListPolicy('grants', [
      { subject: { kind: 'agent' }, capabilities: ['memory:read', 'memory:write'] },
    ]),
  ]);

  test('allows access inside the declared scope', async () => {
    const store = newStore();
    const memory = createScopedMemory({
      store,
      subject: agent,
      scopes: [financeScope],
      permissions: grantAll,
    });

    expect((await memory.remember({ scope: financeScope, kind: 'fact', content: 'x' })).ok).toBe(true);
    const recalled = await memory.recall({ scope: financeScope });
    expect(recalled.ok && recalled.value).toHaveLength(1);
  });

  test('refuses a scope outside the agent specialisation, even a real one', async () => {
    const store = newStore();
    await store.put({ scope: userScope, kind: 'fact', content: 'private' });

    const memory = createScopedMemory({
      store,
      subject: agent,
      scopes: [financeScope],
      permissions: grantAll,
    });

    const read = await memory.recall({ scope: userScope });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.code).toBe('PERMISSION_DENIED');

    const write = await memory.remember({ scope: userScope, kind: 'fact', content: 'x' });
    expect(write.ok).toBe(false);
  });

  test('an in-scope request still requires the capability', async () => {
    const readOnly = createPermissionEngine([
      allowListPolicy('grants', [{ subject: { kind: 'agent' }, capabilities: ['memory:read'] }]),
    ]);
    const memory = createScopedMemory({
      store: newStore(),
      subject: agent,
      scopes: [financeScope],
      permissions: readOnly,
    });

    expect((await memory.recall({ scope: financeScope })).ok).toBe(true);
    const write = await memory.remember({ scope: financeScope, kind: 'fact', content: 'x' });
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.error.code).toBe('PERMISSION_DENIED');
  });

  test('forget is scope-checked against the record, not the caller claim', async () => {
    const store = newStore();
    const foreign = await store.put({ scope: userScope, kind: 'fact', content: 'private' });
    expect(foreign.ok).toBe(true);

    const memory = createScopedMemory({
      store,
      subject: agent,
      scopes: [financeScope],
      permissions: grantAll,
    });

    if (foreign.ok) {
      const result = await memory.forget(foreign.value.id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');
    }
  });
});
