/**
 * The versioned memory view an agent is allowed to hold.
 *
 * `ScopedMemory` narrows a store to the scopes a subject may touch and checks a
 * capability on every access. It exposes remember/recall/forget and nothing
 * else, which is right for the contract it implements — but an agent that needs
 * `asOf` or `history` cannot get there without the raw store, and handing an
 * agent the raw store hands it every scope in the system.
 *
 * So this is the same guard over the versioned surface. `ScopedMemory` is a
 * Core contract and is not touched; this is an additional runtime view, which
 * is why it lives here rather than beside it.
 *
 * The guard is duplicated deliberately rather than shared through a mutable
 * base: an authorisation check that can be swapped out by whoever constructs
 * the object is not much of a check.
 */
import { type Result, err } from '../result.ts';
import { nexusError } from '../errors.ts';
import type { MemoryScope } from '../contracts/memory.ts';
import type { PermissionEngine, Subject } from '../contracts/permissions.ts';
import type {
  MemoryKey,
  ValidityWindow,
  VersionedMemoryStore,
  VersionedRecord,
  VersionedWrite,
} from '../contracts/versioned-memory.ts';

/** Matches `durable-memory.ts`: both halves escaped so ids cannot collide. */
function scopeKey(scope: MemoryScope): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  return `${esc(scope.kind)}:${esc(scope.id)}`;
}

export interface ScopedVersionedMemory {
  readonly scopes: readonly MemoryScope[];
  remember(write: VersionedWrite): Promise<Result<VersionedRecord>>;
  current(scope: MemoryScope, key: MemoryKey): Promise<Result<VersionedRecord | null>>;
  asOf(scope: MemoryScope, key: MemoryKey, at: string): Promise<Result<VersionedRecord | null>>;
  history(scope: MemoryScope, key: MemoryKey): Promise<Result<readonly ValidityWindow[]>>;
}

export function createScopedVersionedMemory(params: {
  readonly store: VersionedMemoryStore;
  readonly subject: Subject;
  readonly scopes: readonly MemoryScope[];
  readonly permissions: PermissionEngine;
}): ScopedVersionedMemory {
  const allowed = new Set(params.scopes.map(scopeKey));

  const guard = (scope: MemoryScope, capability: 'memory:read' | 'memory:write'): Result<void> => {
    const key = scopeKey(scope);
    if (!allowed.has(key)) {
      return err(
        nexusError('PERMISSION_DENIED', `scope '${key}' is outside this subject's memory scopes`, {
          details: { subject: `${params.subject.kind}:${params.subject.id}`, scope: key },
        }),
      );
    }
    return params.permissions.require({ subject: params.subject, capability, resource: key });
  };

  return {
    scopes: params.scopes,

    async remember(write) {
      const guarded = guard(write.scope, 'memory:write');
      if (!guarded.ok) return guarded;
      return params.store.remember(write);
    },

    async current(scope, key) {
      const guarded = guard(scope, 'memory:read');
      if (!guarded.ok) return guarded;
      return params.store.current(scope, key);
    },

    async asOf(scope, key, at) {
      const guarded = guard(scope, 'memory:read');
      if (!guarded.ok) return guarded;
      return params.store.asOf(scope, key, at);
    },

    async history(scope, key) {
      // Reading history is reading, even though it returns many records: the
      // past is not less protected than the present.
      const guarded = guard(scope, 'memory:read');
      if (!guarded.ok) return guarded;
      return params.store.history(scope, key);
    },
  };
}

/** Whether a store offers the versioned surface, for a caller holding a MemoryStore. */
export function isVersionedStore(store: unknown): store is VersionedMemoryStore {
  return (
    typeof store === 'object' &&
    store !== null &&
    typeof (store as VersionedMemoryStore).asOf === 'function' &&
    typeof (store as VersionedMemoryStore).history === 'function'
  );
}
