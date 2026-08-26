/**
 * Memory (core principle 11: long-term memory that still respects agent
 * specialisation and permissions).
 *
 * Memory is addressed by scope. An agent never receives the raw store -- it
 * receives a ScopedMemory bound to the scopes it is permitted to touch, so
 * specialisation is structural rather than advisory.
 */
import type { Result } from '../result.ts';
import type { MemoryId } from '../ids.ts';
import type { HealthReporter } from './health.ts';

export type MemoryScopeKind = 'user' | 'division' | 'agent' | 'run';

export interface MemoryScope {
  readonly kind: MemoryScopeKind;
  readonly id: string;
}

export type MemoryKind = 'fact' | 'preference' | 'episode' | 'artifact' | 'summary';

export interface MemoryRecord {
  readonly id: MemoryId;
  readonly scope: MemoryScope;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Where this memory came from, so recall can be justified. */
  readonly sourceRunId?: string;
  readonly confidence?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MemoryWrite {
  readonly scope: MemoryScope;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly sourceRunId?: string;
  readonly confidence?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MemoryQuery {
  readonly scope: MemoryScope;
  readonly kinds?: readonly MemoryKind[];
  readonly tags?: readonly string[];
  /** Substring match today; a semantic index is a later, additive concern. */
  readonly text?: string;
  readonly limit?: number;
}

export interface MemoryStore extends HealthReporter {
  put(write: MemoryWrite): Promise<Result<MemoryRecord>>;
  get(id: MemoryId): Promise<Result<MemoryRecord | null>>;
  query(query: MemoryQuery): Promise<Result<readonly MemoryRecord[]>>;
  delete(id: MemoryId): Promise<Result<void>>;
}

/** The permission-narrowed view handed to a skill or agent. */
export interface ScopedMemory {
  readonly scopes: readonly MemoryScope[];
  remember(write: MemoryWrite): Promise<Result<MemoryRecord>>;
  recall(query: MemoryQuery): Promise<Result<readonly MemoryRecord[]>>;
  forget(id: MemoryId): Promise<Result<void>>;
}
