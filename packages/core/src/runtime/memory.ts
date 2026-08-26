/**
 * Volatile, in-process memory store.
 *
 * This is NOT the long-term memory system. It is a real, correct implementation
 * of the MemoryStore contract whose storage happens to be a Map, and it reports
 * itself as 'degraded' precisely so that nothing mistakes it for durable
 * storage. Choosing the persistent backend is a deliberate, deferred decision.
 */
import { type Result, ok, err } from '../result.ts';
import { nexusError } from '../errors.ts';
import { type MemoryId, memoryId as toMemoryId, type IdGenerator, cryptoIdGenerator } from '../ids.ts';
import { type Clock, systemClock } from '../clock.ts';
import type {
  MemoryQuery,
  MemoryRecord,
  MemoryScope,
  MemoryStore,
  MemoryWrite,
  ScopedMemory,
} from '../contracts/memory.ts';
import type { HealthReport } from '../contracts/health.ts';
import type { PermissionEngine, Subject } from '../contracts/permissions.ts';

const scopeKey = (scope: MemoryScope): string => `${scope.kind}:${scope.id}`;

export interface InMemoryMemoryStoreOptions {
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export function createInMemoryMemoryStore(options: InMemoryMemoryStoreOptions = {}): MemoryStore {
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? cryptoIdGenerator;
  const records = new Map<string, MemoryRecord>();

  return {
    async put(write: MemoryWrite) {
      if (write.content.trim() === '') {
        return err(nexusError('INVALID_INPUT', 'memory content must not be empty'));
      }
      const now = clock.now().toISOString();
      const record: MemoryRecord = {
        id: toMemoryId(ids.next('mem')),
        scope: write.scope,
        kind: write.kind,
        content: write.content,
        tags: write.tags ?? [],
        createdAt: now,
        updatedAt: now,
        ...(write.sourceRunId !== undefined ? { sourceRunId: write.sourceRunId } : {}),
        ...(write.confidence !== undefined ? { confidence: write.confidence } : {}),
        ...(write.metadata !== undefined ? { metadata: write.metadata } : {}),
      };
      records.set(record.id, record);
      return ok(record);
    },

    async get(id: MemoryId) {
      return ok(records.get(id) ?? null);
    },

    async query(query: MemoryQuery) {
      const wanted = scopeKey(query.scope);
      const needle = query.text?.toLowerCase();
      const matches = [...records.values()]
        .filter((record) => scopeKey(record.scope) === wanted)
        .filter((record) => !query.kinds || query.kinds.includes(record.kind))
        .filter((record) => !query.tags || query.tags.every((tag) => record.tags.includes(tag)))
        .filter((record) => !needle || record.content.toLowerCase().includes(needle))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return ok(query.limit !== undefined ? matches.slice(0, query.limit) : matches);
    },

    async delete(id: MemoryId) {
      if (!records.delete(id)) {
        return err(nexusError('NOT_FOUND', `memory '${id}' not found`, { details: { id } }));
      }
      return ok(undefined);
    },

    async health(): Promise<HealthReport> {
      return {
        component: 'memory:in-memory',
        status: 'degraded',
        checkedAt: clock.now().toISOString(),
        detail: 'volatile store: all records are lost on restart. Not for production use.',
        metadata: { records: records.size },
      };
    },
  };
}

/**
 * Narrows a store to the scopes an agent may touch, and checks a capability on
 * every access. An agent holding this cannot read another division's memory
 * even if it knows the scope id (core principle 11).
 */
export function createScopedMemory(params: {
  readonly store: MemoryStore;
  readonly subject: Subject;
  readonly scopes: readonly MemoryScope[];
  readonly permissions: PermissionEngine;
}): ScopedMemory {
  const { store, subject, scopes, permissions } = params;
  const allowed = new Set(scopes.map(scopeKey));

  const guard = (scope: MemoryScope, capability: 'memory:read' | 'memory:write'): Result<void> => {
    const key = scopeKey(scope);
    if (!allowed.has(key)) {
      return err(
        nexusError('PERMISSION_DENIED', `scope '${key}' is outside this subject's memory scopes`, {
          details: { subject: `${subject.kind}:${subject.id}`, scope: key },
        }),
      );
    }
    return permissions.require({ subject, capability, resource: key });
  };

  return {
    scopes,

    async remember(write) {
      const guarded = guard(write.scope, 'memory:write');
      if (!guarded.ok) return guarded;
      return store.put(write);
    },

    async recall(query) {
      const guarded = guard(query.scope, 'memory:read');
      if (!guarded.ok) return guarded;
      return store.query(query);
    },

    async forget(id) {
      const existing = await store.get(id);
      if (!existing.ok) return existing;
      if (!existing.value) {
        return err(nexusError('NOT_FOUND', `memory '${id}' not found`, { details: { id } }));
      }
      const guarded = guard(existing.value.scope, 'memory:write');
      if (!guarded.ok) return guarded;
      return store.delete(id);
    },
  };
}
