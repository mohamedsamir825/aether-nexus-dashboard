/**
 * The forecast ledger — vintages, supersession, and no overwriting.
 *
 * Spec §4.3: "Every forecast is a **versioned, immutable vintage** with its
 * assumptions attached — superseded, never overwritten, so accuracy can be
 * measured retrospectively."
 *
 * That last clause is the whole reason. If a forecast is edited in place, then
 * once actuals arrive there is nothing left to compare them against: the record
 * says the forecast was always right. Retrospective accuracy (§4.2's first KPI)
 * is only measurable if the number that was believed at the time still exists.
 *
 * ## Why this is in-memory, and what that costs
 *
 * Durable versioned memory is `A3`, scheduled for Phase 10, and this division
 * does not pre-empt it. What is implemented here is the *semantics* —
 * immutability, supersession, an ordered chain — behind a narrow interface, so
 * Phase 10 replaces the storage without touching the callers. Until then a
 * ledger lives for one process: history within a run is complete, history
 * across restarts does not exist. That limit is documented rather than implied.
 */
import { type Result, err, nexusError, ok } from '@nexus/core';
import type { ForecastVintage } from './types.ts';

export interface ForecastLedger {
  /** Every vintage, oldest first. */
  all(): readonly ForecastVintage[];
  /** The vintage nothing supersedes — the current position. */
  head(): ForecastVintage | null;
  get(id: string): ForecastVintage | null;
  /**
   * Appends a vintage that supersedes the current head.
   *
   * Refuses rather than repairs: appending onto a stale head is a lost update,
   * and silently rebasing it would produce a chain whose order never happened.
   */
  append(vintage: ForecastVintage): Result<ForecastVintage>;
  /** The chain from the first vintage to this one, oldest first. */
  lineage(id: string): Result<readonly ForecastVintage[]>;
}

export interface CreateLedgerOptions {
  /** Vintages to seed with, oldest first. Validated as a chain on entry. */
  readonly initial?: readonly ForecastVintage[];
}

/** Deep-freezes a vintage so "immutable" is enforced, not just documented. */
function freeze(vintage: ForecastVintage): ForecastVintage {
  Object.freeze(vintage.drivers);
  for (const driver of vintage.drivers) Object.freeze(driver);
  Object.freeze(vintage.amounts);
  for (const amount of vintage.amounts) Object.freeze(amount);
  return Object.freeze(vintage);
}

export function createForecastLedger(options: CreateLedgerOptions = {}): ForecastLedger {
  const chain: ForecastVintage[] = [];
  const byId = new Map<string, ForecastVintage>();

  const headOf = (): ForecastVintage | null => chain[chain.length - 1] ?? null;

  const push = (vintage: ForecastVintage): Result<ForecastVintage> => {
    if (byId.has(vintage.id)) {
      return err(
        nexusError('ALREADY_EXISTS', `vintage '${vintage.id}' is already in the ledger`, {
          details: { vintageId: vintage.id },
        }),
      );
    }

    const head = headOf();
    const expectedSupersedes = head === null ? null : head.id;
    if (vintage.supersedes !== expectedSupersedes) {
      // A vintage that claims to supersede something other than the current
      // head was computed against a position that has since moved on.
      return err(
        nexusError(
          'INVALID_INPUT',
          `vintage '${vintage.id}' supersedes '${vintage.supersedes ?? 'nothing'}' but the head is '${expectedSupersedes ?? 'nothing'}'`,
          { details: { supersedes: vintage.supersedes, head: expectedSupersedes } },
        ),
      );
    }

    const expectedVersion = (head?.version ?? 0) + 1;
    if (vintage.version !== expectedVersion) {
      return err(
        nexusError(
          'INVALID_INPUT',
          `vintage '${vintage.id}' is version ${vintage.version}, expected ${expectedVersion}`,
          { details: { version: vintage.version, expected: expectedVersion } },
        ),
      );
    }

    if (!Number.isFinite(vintage.confidence) || vintage.confidence < 0 || vintage.confidence > 1) {
      return err(nexusError('INVALID_INPUT', 'vintage confidence must be between 0 and 1'));
    }
    if (vintage.reason.trim() === '') {
      return err(nexusError('INVALID_INPUT', 'a vintage must say why it exists'));
    }

    const frozen = freeze(vintage);
    chain.push(frozen);
    byId.set(frozen.id, frozen);
    return ok(frozen);
  };

  for (const seed of options.initial ?? []) {
    const seeded = push(seed);
    // A malformed seed is a programming error at construction, not a runtime
    // condition a caller can handle, so it fails loudly and immediately.
    if (!seeded.ok) throw new Error(`invalid initial ledger: ${seeded.error.message}`);
  }

  return {
    all: () => [...chain],
    head: headOf,
    get: (id) => byId.get(id) ?? null,
    append: push,

    lineage(id) {
      const index = chain.findIndex((v) => v.id === id);
      if (index === -1) {
        return err(nexusError('NOT_FOUND', `vintage '${id}' is not in this ledger`));
      }
      return ok(chain.slice(0, index + 1));
    },
  };
}

/**
 * Builds the next vintage from the current head.
 *
 * The only supported way to move a forecast forward: it derives `version` and
 * `supersedes` from the ledger rather than trusting a caller to get them right,
 * which is what keeps the chain honest without relying on discipline.
 */
export function nextVintage(
  ledger: ForecastLedger,
  fields: Omit<ForecastVintage, 'version' | 'supersedes'>,
): ForecastVintage {
  const head = ledger.head();
  return {
    ...fields,
    version: (head?.version ?? 0) + 1,
    supersedes: head?.id ?? null,
  };
}

/**
 * Forecast accuracy for one line item, measured against what was actually
 * believed at the time (§4.2).
 *
 * Returns null when the vintage never forecast that line item and period —
 * absence of a forecast is not a forecast of zero.
 */
export function accuracyOf(
  vintage: ForecastVintage,
  lineItem: string,
  period: string,
  actual: number,
): { readonly forecast: number; readonly error: number; readonly absPercent: number | null } | null {
  const forecast = vintage.amounts.find((a) => a.lineItem === lineItem && a.period === period);
  if (forecast === undefined) return null;
  const error = actual - forecast.value;
  return {
    forecast: forecast.value,
    error,
    absPercent: actual === 0 ? null : Math.abs(error / actual),
  };
}
