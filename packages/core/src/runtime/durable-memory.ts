/**
 * Durable memory: an append-only log on disk (Phase 10).
 *
 * The volatile store said what it was -- a Map that reports itself 'degraded'
 * so nothing mistakes it for storage. This is the real thing, and it keeps two
 * promises the volatile one could not: it survives a restart, and it remembers
 * what it used to believe.
 *
 * ## Append-only, because the alternative erases the point
 *
 * Records are appended as JSON lines and never rewritten in place. A store that
 * edits a belief cannot answer "what did I think in March", which is precisely
 * what versioned memory is for. Deletion writes a tombstone rather than
 * removing a line: a fact that was believed and then retracted is different
 * from a fact that never existed, and only an append-only log can tell them
 * apart.
 *
 * A crash mid-write costs at most the last line, which is dropped on load
 * rather than failing the whole store. Losing one uncommitted record is
 * recoverable; refusing to open the file is not.
 *
 * ## Zero dependencies, injected filesystem
 *
 * The filesystem arrives as a parameter, so the tests exercise the real code
 * against an in-memory implementation and touch no disk. That is the same
 * choice `createFileCorpusRetriever` made, for the same reason.
 */
import { type Result, ok, err } from '../result.ts';
import { nexusError } from '../errors.ts';
import {
  type MemoryId,
  memoryId as toMemoryId,
  type IdGenerator,
  cryptoIdGenerator,
} from '../ids.ts';
import { type Clock, systemClock } from '../clock.ts';
import type {
  MemoryQuery,

  MemoryScope,
  MemoryStore,
  MemoryWrite,
} from '../contracts/memory.ts';
import type {
  MemoryKey,
  ValidityWindow,
  VersionedMemoryStore,
  VersionedRecord,
  VersionedWrite,
} from '../contracts/versioned-memory.ts';
import type { HealthReport } from '../contracts/health.ts';
import { rankByRelevance } from './retrieval-rank.ts';

/**
 * The slice of a filesystem this needs. Deliberately tiny: a store that could
 * do arbitrary filesystem work would be a much larger thing to trust.
 */
export interface MemoryFileSystem {
  readFileSync(path: string, encoding: 'utf8'): string;
  appendFileSync(path: string, data: string, encoding: 'utf8'): void;
  existsSync(path: string): boolean;
}

type LogEntry =
  | { readonly op: 'put'; readonly record: VersionedRecord }
  | { readonly op: 'delete'; readonly id: MemoryId; readonly at: string };

export interface DurableMemoryOptions {
  readonly path: string;
  readonly fs: MemoryFileSystem;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

/**
 * Scope identity.
 *
 * The separator is escaped on both halves, so a scope id containing a colon
 * cannot be crafted to collide with a different scope -- `{kind:'user', id:
 * 'a:b'}` and `{kind:'user:a', id:'b'}` must never address the same memories.
 */
function scopeKey(scope: MemoryScope): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  return `${esc(scope.kind)}:${esc(scope.id)}`;
}

const keyOf = (scope: MemoryScope, key: MemoryKey): string => `${scopeKey(scope)}::${key}`;

export function createDurableMemoryStore(
  options: DurableMemoryOptions,
): MemoryStore & VersionedMemoryStore {
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? cryptoIdGenerator;

  const byId = new Map<string, VersionedRecord>();
  /** Every version of a key, in write order. */
  const chains = new Map<string, VersionedRecord[]>();
  const deleted = new Set<string>();
  let corruptLines = 0;

  const index = (record: VersionedRecord) => {
    byId.set(record.id, record);
    const chainKey = keyOf(record.scope, record.key);
    const chain = chains.get(chainKey);
    if (chain === undefined) chains.set(chainKey, [record]);
    else chain.push(record);
  };

  // --- load ---------------------------------------------------------------
  if (options.fs.existsSync(options.path)) {
    const raw = options.fs.readFileSync(options.path, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim() !== '');
    for (const [position, line] of lines.entries()) {
      let entry: LogEntry;
      try {
        entry = JSON.parse(line) as LogEntry;
      } catch {
        // A truncated final line is a crash mid-append and costs one record.
        // Anything else is real corruption, and both are counted so health
        // can report a store that is quietly losing data.
        corruptLines += 1;
        if (position !== lines.length - 1) continue;
        continue;
      }
      if (entry.op === 'delete') deleted.add(entry.id);
      else index(entry.record);
    }
  }

  const append = (entry: LogEntry): Result<void> => {
    try {
      options.fs.appendFileSync(options.path, `${JSON.stringify(entry)}\n`, 'utf8');
      return ok(undefined);
    } catch (cause) {
      // The in-memory index is NOT updated when the write fails. A store that
      // remembers what it could not persist would lie after the next restart.
      return err(
        nexusError('INTERNAL', `memory could not be persisted to ${options.path}`, { cause }),
      );
    }
  };

  const live = (record: VersionedRecord): boolean => !deleted.has(record.id);
  const chainOf = (scope: MemoryScope, key: MemoryKey): readonly VersionedRecord[] =>
    (chains.get(keyOf(scope, key)) ?? []).filter(live);

  /** The window a version held, ended by its successor or its own validTo. */
  const windows = (chain: readonly VersionedRecord[]): ValidityWindow[] =>
    chain.map((record, i) => {
      const next = chain[i + 1];
      const to = record.validTo ?? next?.validFrom;
      return { record, from: record.validFrom, ...(to !== undefined ? { to } : {}) };
    });

  const store: MemoryStore & VersionedMemoryStore = {
    // --- MemoryStore ------------------------------------------------------
    async put(write: MemoryWrite) {
      // An unversioned put still gets a key, derived from its own id, so every
      // record in the log has the same shape and the loader has no special case.
      return store.remember({
        ...write,
        key: `anon:${ids.next('k')}`,
        reason: 'unversioned write',
      });
    },

    async get(id: MemoryId) {
      const found = byId.get(id);
      return ok(found !== undefined && live(found) ? found : null);
    },

    async query(query: MemoryQuery) {
      const wanted = scopeKey(query.scope);
      const candidates = [...byId.values()]
        .filter(live)
        .filter((record) => scopeKey(record.scope) === wanted)
        .filter((record) => !query.kinds || query.kinds.includes(record.kind))
        .filter((record) => !query.tags || query.tags.every((tag) => record.tags.includes(tag)));

      if (query.text === undefined || query.text.trim() === '') {
        const recent = [...candidates].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return ok(query.limit === undefined ? recent : recent.slice(0, query.limit));
      }

      const ranked = rankByRelevance({
        query: query.text,
        documents: candidates.map((record) => ({ id: record.id, text: record.content })),
      });
      const order = new Map(ranked.map((r, i) => [r.id, i]));
      const matched = candidates
        .filter((record) => order.has(record.id))
        .sort((a, b) => (order.get(a.id) as number) - (order.get(b.id) as number));
      return ok(query.limit === undefined ? matched : matched.slice(0, query.limit));
    },

    async delete(id: MemoryId) {
      const found = byId.get(id);
      if (found === undefined) return err(nexusError('NOT_FOUND', `no memory '${id}'`));
      const written = append({ op: 'delete', id, at: clock.now().toISOString() });
      if (!written.ok) return written;
      deleted.add(id);
      return ok(undefined);
    },

    // --- VersionedMemoryStore ---------------------------------------------
    async remember(write: VersionedWrite) {
      if (write.content.trim() === '') {
        return err(nexusError('INVALID_INPUT', 'memory content must not be empty'));
      }
      if (write.reason.trim() === '') {
        return err(nexusError('INVALID_INPUT', 'a memory version must say why it exists'));
      }

      const chain = chainOf(write.scope, write.key);
      const head = chain[chain.length - 1];
      const now = clock.now().toISOString();
      const validFrom = write.validFrom ?? now;

      // Time must move forward within a chain. A version valid before the one
      // it supersedes would make `asOf` ambiguous: two records would claim the
      // same instant with no rule for choosing.
      if (head !== undefined && validFrom < head.validFrom) {
        return err(
          nexusError(
            'INVALID_INPUT',
            `validFrom '${validFrom}' precedes the current version's '${head.validFrom}'`,
            { details: { key: write.key, validFrom, head: head.validFrom } },
          ),
        );
      }

      const record: VersionedRecord = {
        id: toMemoryId(ids.next('mem')),
        scope: write.scope,
        kind: write.kind,
        content: write.content,
        tags: write.tags ?? [],
        createdAt: now,
        updatedAt: now,
        key: write.key,
        version: (head?.version ?? 0) + 1,
        supersedes: head?.id ?? null,
        validFrom,
        reason: write.reason,
        ...(write.validTo !== undefined ? { validTo: write.validTo } : {}),
        ...(write.sourceRunId !== undefined ? { sourceRunId: write.sourceRunId } : {}),
        ...(write.confidence !== undefined ? { confidence: write.confidence } : {}),
        ...(write.metadata !== undefined ? { metadata: write.metadata } : {}),
      };

      const written = append({ op: 'put', record });
      if (!written.ok) return written;
      index(record);
      return ok(record);
    },

    async current(scope, key) {
      const chain = chainOf(scope, key);
      const head = chain[chain.length - 1];
      if (head === undefined) return ok(null);
      // An expired belief has no current version. Returning it anyway would
      // report something the store knows to be over as though it still held.
      if (head.validTo !== undefined && head.validTo <= clock.now().toISOString()) return ok(null);
      return ok(head);
    },

    async asOf(scope, key, at) {
      for (const window of windows(chainOf(scope, key))) {
        if (window.from <= at && (window.to === undefined || at < window.to)) {
          return ok(window.record);
        }
      }
      return ok(null);
    },

    async history(scope, key) {
      return ok(windows(chainOf(scope, key)));
    },

    async health(): Promise<HealthReport> {
      const checkedAt = clock.now().toISOString();
      if (corruptLines > 0) {
        return {
          component: 'memory:durable',
          status: 'degraded',
          checkedAt,
          detail: `${corruptLines} unreadable line(s) in ${options.path}; those records are lost`,
        };
      }
      return {
        component: 'memory:durable',
        status: 'healthy',
        checkedAt,
        detail: `${byId.size} record(s) across ${chains.size} key(s)`,
      };
    },
  };

  return store;
}
