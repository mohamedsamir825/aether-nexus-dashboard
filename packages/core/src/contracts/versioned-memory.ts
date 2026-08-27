/**
 * Versioned memory: what NEXUS believed, and when it believed it (gap `A3`).
 *
 * `MemoryRecord` answers "what do I know". This answers a harder question:
 * "what did I know in March, and what changed since". Those are different, and
 * a system that only stores the current answer cannot tell you it was ever
 * wrong -- which is the same failure `ForecastLedger` exists to prevent, one
 * layer down.
 *
 * **Nothing in `contracts/memory.ts` changes.** `VersionedRecord` extends
 * `MemoryRecord`, so every existing reader keeps working and versioning is
 * something a store either offers or does not.
 *
 * ## Two timelines, deliberately separate
 *
 * `createdAt` (inherited) is when NEXUS *recorded* the belief. `validFrom` and
 * `validTo` are when the belief was *true in the world*. Conflating them is the
 * classic bitemporal mistake: learning in June that a price changed in March
 * has to be expressible, and with one timeline it is not.
 *
 * ## Supersession is a chain, not a flag
 *
 * A new version points back at the one it replaces. The predecessor is never
 * rewritten -- no `supersededBy` field exists, because setting one would mean
 * mutating a record that is supposed to be immutable. "Is this the current
 * version" is answered by asking whether anything points at it, exactly as the
 * forecast ledger answers it.
 */
import type { Result } from '../result.ts';
import type { MemoryId } from '../ids.ts';
import type { MemoryRecord, MemoryScope, MemoryWrite } from './memory.ts';

/**
 * Stable identity for a belief across its revisions.
 *
 * Versions of one belief share a key; a `MemoryId` identifies one version.
 * Without this there is nothing to chain: two records about the owner's job
 * title would be two unrelated facts rather than one fact that changed.
 */
export type MemoryKey = string;

export interface VersionedRecord extends MemoryRecord {
  readonly key: MemoryKey;
  /** 1 for the first version of a key, then monotonic. */
  readonly version: number;
  /** The version this replaces, or null for the first. */
  readonly supersedes: MemoryId | null;
  /** When the belief became true in the world. */
  readonly validFrom: string;
  /**
   * When it stopped being true, if it has.
   *
   * Usually implicit -- a successor's `validFrom` ends its predecessor -- so
   * this is only set for a belief that expires with nothing replacing it
   * ("was on that team until March", and then no longer on any team).
   */
  readonly validTo?: string;
  /** Why this version exists. A revision with no reason loses the audit trail. */
  readonly reason: string;
}

export interface VersionedWrite extends MemoryWrite {
  readonly key: MemoryKey;
  readonly reason: string;
  /** Defaults to the write time when the caller does not know better. */
  readonly validFrom?: string;
  readonly validTo?: string;
}

/** A belief and the interval over which it held. */
export interface ValidityWindow {
  readonly record: VersionedRecord;
  readonly from: string;
  /** Absent means "still holds as far as this store knows". */
  readonly to?: string;
}

export interface VersionedMemoryStore {
  /**
   * Records a new version of `key`, superseding the current one.
   *
   * Refuses rather than repairs when the caller's expectations do not match
   * the store: a write built against a version that has since been superseded
   * is a lost update, and silently rebasing it produces a history that never
   * happened.
   */
  remember(write: VersionedWrite): Promise<Result<VersionedRecord>>;

  /** The version in force now, or null if the key is unknown or expired. */
  current(scope: MemoryScope, key: MemoryKey): Promise<Result<VersionedRecord | null>>;

  /**
   * What was believed at a point in time.
   *
   * This is the whole reason the type exists: it can answer questions about
   * the past without the past having been overwritten.
   */
  asOf(scope: MemoryScope, key: MemoryKey, at: string): Promise<Result<VersionedRecord | null>>;

  /** Every version of a key, oldest first, with its validity window. */
  history(scope: MemoryScope, key: MemoryKey): Promise<Result<readonly ValidityWindow[]>>;
}
