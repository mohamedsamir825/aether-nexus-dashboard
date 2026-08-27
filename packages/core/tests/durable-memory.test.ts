import { test, expect, describe } from 'bun:test';
import { createDurableMemoryStore, type MemoryFileSystem } from '../src/runtime/durable-memory.ts';
import { fixedClock } from '../src/clock.ts';
import { memoryId } from '../src/ids.ts';
import type { MemoryScope } from '../src/contracts/memory.ts';

const clock = fixedClock(new Date('2026-06-01T12:00:00Z'));
const USER: MemoryScope = { kind: 'user', id: 'owner' };
const OTHER: MemoryScope = { kind: 'user', id: 'someone-else' };

/** An in-memory filesystem, so the real code runs and no disk is touched. */
function fakeFs(initial = ''): MemoryFileSystem & { content: () => string; fail: boolean } {
  let data = initial;
  const fs = {
    fail: false,
    existsSync: () => data !== '',
    readFileSync: () => data,
    appendFileSync: (_p: string, chunk: string) => {
      if (fs.fail) throw new Error('disk full');
      data += chunk;
    },
    content: () => data,
  };
  return fs;
}

let counter = 0;
const ids = { next: (prefix: string) => `${prefix}_${++counter}` };

const store = (fs: MemoryFileSystem) =>
  createDurableMemoryStore({ path: '/memory.log', fs, clock, ids });

const write = (over: Record<string, unknown> = {}) => ({
  scope: USER,
  kind: 'fact' as const,
  content: 'The owner works at Acme.',
  key: 'owner:employer',
  reason: 'initial',
  ...over,
});

describe('durability — the promise the volatile store could not make', () => {
  test('records survive a restart', async () => {
    const fs = fakeFs();
    const first = store(fs);
    const put = await first.remember(write());
    expect(put.ok).toBe(true);

    // A completely new store over the same file: this is what a restart is.
    const second = store(fs);
    const recalled = await second.current(USER, 'owner:employer');
    expect(recalled.ok && recalled.value?.content).toBe('The owner works at Acme.');
  });

  test('a write that cannot be persisted is not remembered either', async () => {
    // A store that holds what it failed to save tells the truth until the next
    // restart and then quietly starts lying.
    const fs = fakeFs();
    const s = store(fs);
    fs.fail = true;

    const put = await s.remember(write());
    expect(put.ok).toBe(false);
    if (!put.ok) expect(put.error.code).toBe('INTERNAL');

    const recalled = await s.current(USER, 'owner:employer');
    expect(recalled.ok && recalled.value).toBeNull();
  });

  test('a truncated final line costs one record, not the whole store', async () => {
    const fs = fakeFs();
    const s = store(fs);
    await s.remember(write());
    await s.remember(write({ content: 'Second fact.', key: 'k2', reason: 'x' }));

    // Simulate a crash mid-append.
    const truncated = fakeFs(`${fs.content()}{"op":"put","record":{"id":"mem_9`);
    const recovered = store(truncated);
    const survived = await recovered.current(USER, 'owner:employer');
    expect(survived.ok && survived.value?.content).toBe('The owner works at Acme.');

    // ...and health says so rather than reporting a clean store.
    const health = await recovered.health();
    expect(health.status).toBe('degraded');
    expect(health.detail).toContain('unreadable');
  });

  test('deletion is a tombstone, so retracted and never-known stay different', async () => {
    const fs = fakeFs();
    const s = store(fs);
    const put = await s.remember(write());
    if (!put.ok) throw new Error('expected success');

    const before = await s.get(put.value.id);
    expect(before.ok && before.value).not.toBeNull();

    expect((await s.delete(put.value.id)).ok).toBe(true);
    const after = await s.get(put.value.id);
    expect(after.ok && after.value).toBeNull();

    // The original line is still in the log; it was retracted, not erased.
    expect(fs.content()).toContain('The owner works at Acme.');
    expect(fs.content()).toContain('"op":"delete"');

    // And the retraction survives a restart.
    const restarted = store(fs);
    const stillGone = await restarted.get(put.value.id);
    expect(stillGone.ok && stillGone.value).toBeNull();
  });

  test('deleting something that never existed is NOT_FOUND', async () => {
    const s = store(fakeFs());
    const gone = await s.delete(memoryId('mem_nope'));
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.error.code).toBe('NOT_FOUND');
  });
});

describe('versioning and supersession (A3)', () => {
  test('a new version supersedes without overwriting', async () => {
    const fs = fakeFs();
    const s = store(fs);
    await s.remember(write({ validFrom: '2024-01-01T00:00:00.000Z' }));
    await s.remember(
      write({
        content: 'The owner works at Globex.',
        reason: 'changed jobs',
        validFrom: '2026-03-01T00:00:00.000Z',
      }),
    );

    const current = await s.current(USER, 'owner:employer');
    expect(current.ok && current.value?.content).toBe('The owner works at Globex.');
    expect(current.ok && current.value?.version).toBe(2);
    expect(current.ok && current.value?.supersedes).not.toBeNull();

    const history = await s.history(USER, 'owner:employer');
    expect(history.ok && history.value).toHaveLength(2);
  });

  test('asOf answers what was believed at a point in the past', async () => {
    // The whole reason the type exists: the past is still there to be asked.
    const s = store(fakeFs());
    await s.remember(write({ validFrom: '2024-01-01T00:00:00.000Z' }));
    await s.remember(
      write({
        content: 'The owner works at Globex.',
        reason: 'changed jobs',
        validFrom: '2026-03-01T00:00:00.000Z',
      }),
    );

    const back = await s.asOf(USER, 'owner:employer', '2025-06-01T00:00:00.000Z');
    expect(back.ok && back.value?.content).toBe('The owner works at Acme.');

    const now = await s.asOf(USER, 'owner:employer', '2026-06-01T00:00:00.000Z');
    expect(now.ok && now.value?.content).toBe('The owner works at Globex.');

    // Before anything was true, nothing was believed.
    const before = await s.asOf(USER, 'owner:employer', '2020-01-01T00:00:00.000Z');
    expect(before.ok && before.value).toBeNull();
  });

  test('recording time and validity time are separate timelines', async () => {
    // Learning in June that something changed in March has to be expressible.
    const s = store(fakeFs());
    const put = await s.remember(write({ validFrom: '2026-03-01T00:00:00.000Z' }));
    if (!put.ok) throw new Error('expected success');

    expect(put.value.createdAt).toBe('2026-06-01T12:00:00.000Z'); // when recorded
    expect(put.value.validFrom).toBe('2026-03-01T00:00:00.000Z'); // when true
  });

  test('a version valid before the one it supersedes is refused', async () => {
    // Otherwise asOf is ambiguous: two records claim the same instant with no
    // rule for choosing between them.
    const s = store(fakeFs());
    await s.remember(write({ validFrom: '2026-03-01T00:00:00.000Z' }));
    const backdated = await s.remember(
      write({ content: 'Older claim.', reason: 'backdated', validFrom: '2020-01-01T00:00:00.000Z' }),
    );
    expect(backdated.ok).toBe(false);
    if (!backdated.ok) expect(backdated.error.message).toContain('precedes');
  });

  test('an expired belief has no current version', async () => {
    const s = store(fakeFs());
    await s.remember(
      write({
        validFrom: '2024-01-01T00:00:00.000Z',
        validTo: '2025-01-01T00:00:00.000Z',
        reason: 'left the team',
      }),
    );
    // The clock is 2026: this ended a year ago.
    const current = await s.current(USER, 'owner:employer');
    expect(current.ok && current.value).toBeNull();

    // But it is still answerable about its own window.
    const during = await s.asOf(USER, 'owner:employer', '2024-06-01T00:00:00.000Z');
    expect(during.ok && during.value?.content).toBe('The owner works at Acme.');
  });

  test('a version must say why it exists', async () => {
    const s = store(fakeFs());
    const silent = await s.remember(write({ reason: '  ' }));
    expect(silent.ok).toBe(false);
    if (!silent.ok) expect(silent.error.message).toContain('why it exists');
  });

  test('history survives a restart intact', async () => {
    const fs = fakeFs();
    const s = store(fs);
    await s.remember(write({ validFrom: '2024-01-01T00:00:00.000Z' }));
    await s.remember(
      write({ content: 'Globex.', reason: 'moved', validFrom: '2026-03-01T00:00:00.000Z' }),
    );

    const restarted = store(fs);
    const history = await restarted.history(USER, 'owner:employer');
    expect(history.ok && history.value.map((w) => w.record.version)).toEqual([1, 2]);
    // The first window is closed by the second's start.
    expect(history.ok && history.value[0]?.to).toBe('2026-03-01T00:00:00.000Z');
    expect(history.ok && history.value[1]?.to).toBeUndefined();
  });
});

describe('scope isolation under adversarial ids', () => {
  test('one scope cannot read another', async () => {
    const s = store(fakeFs());
    await s.remember(write());
    const theirs = await s.current(OTHER, 'owner:employer');
    expect(theirs.ok && theirs.value).toBeNull();
  });

  test('a crafted scope id cannot collide with a different scope', async () => {
    // Without escaping, {kind:'user', id:'a:b'} and {kind:'user:a', id:'b'}
    // both flatten to "user:a:b" and silently share memories.
    const s = store(fakeFs());
    await s.remember(write({ scope: { kind: 'user', id: 'a:b' }, content: 'Mine.' }));

    const collide = await s.query({ scope: { kind: 'user', id: 'b' } as MemoryScope });
    expect(collide.ok && collide.value).toEqual([]);

    const mine = await s.query({ scope: { kind: 'user', id: 'a:b' } });
    expect(mine.ok && mine.value).toHaveLength(1);
  });

  test('a query never leaks records from another scope', async () => {
    const s = store(fakeFs());
    await s.remember(write({ content: 'Owner secret.' }));
    await s.remember(write({ scope: OTHER, key: 'k', content: 'Other secret.' }));

    const found = await s.query({ scope: USER, text: 'secret' });
    expect(found.ok && found.value.map((r) => r.content)).toEqual(['Owner secret.']);
  });
});

describe('ranked recall (A5)', () => {
  test('ranks by relevance rather than returning insertion order', async () => {
    const s = store(fakeFs());
    await s.remember(write({ key: 'a', content: 'A note about invoicing and billing cycles.' }));
    await s.remember(write({ key: 'b', content: 'Billing. Billing. Billing and more billing.' }));
    await s.remember(write({ key: 'c', content: 'Something about gardening.' }));

    const found = await s.query({ scope: USER, text: 'billing' });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    // Gardening matched nothing and is absent, not present with a zero score.
    expect(found.value).toHaveLength(2);
    expect(found.value[0]?.content).toContain('Billing');
  });

  test('a query matching nothing returns nothing, not everything', async () => {
    const s = store(fakeFs());
    await s.remember(write());
    const found = await s.query({ scope: USER, text: 'submarine' });
    expect(found.ok && found.value).toEqual([]);
  });

  test('an empty query falls back to recency rather than ranking noise', async () => {
    const s = store(fakeFs());
    await s.remember(write({ key: 'a', content: 'First.' }));
    await s.remember(write({ key: 'b', content: 'Second.' }));
    const found = await s.query({ scope: USER });
    expect(found.ok && found.value).toHaveLength(2);
  });
});
