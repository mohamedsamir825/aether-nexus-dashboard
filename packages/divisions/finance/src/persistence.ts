/**
 * Forecast vintages that survive a restart.
 *
 * A `ForecastVintage` and a `VersionedRecord` turned out to mean the same
 * thing: immutable, ordered, superseded rather than overwritten, and carrying
 * a reason. So a vintage is stored as a *version* of one key rather than as an
 * unrelated record per forecast. That is a fit, not a forcing -- and it is why
 * `asOf` works across runs without any new machinery.
 *
 * ## What this fixes
 *
 * §4.2's first KPI is forecast accuracy against subsequent actuals, tracked per
 * horizon. Until now the ledger died with the process, so "per horizon" meant
 * "within one run" -- which is the horizon nobody cares about. A forecast made
 * in January can now be scored against April's actuals because January's
 * numbers are still there.
 *
 * ## Everything goes through the scoped view
 *
 * Never the raw store. The agent holds a view narrowed to Finance's own scope
 * with a capability checked on every access, so persistence cannot become a
 * path to another division's memory.
 */
import { type MemoryScope, type Result, err, nexusError, ok } from '@nexus/core';
import type { ScopedVersionedMemory } from '@nexus/core';
import { createForecastLedger, type ForecastLedger } from './ledger.ts';
import type { ForecastVintage } from './types.ts';

/** Finance's own division scope (§12.1, "Owning division"). */
export const FINANCE_MEMORY_SCOPE: MemoryScope = { kind: 'division', id: 'finance' };

/**
 * One forecast line per key, so different forecasts do not share a chain.
 *
 * A deployment forecasting several entities needs them kept apart; sharing one
 * key would interleave their vintages and make every `asOf` answer wrong.
 */
export const forecastKey = (ledgerName: string): string => `forecast:${ledgerName}`;

/** Persists one vintage as the next version of the forecast. */
export async function rememberVintage(params: {
  readonly memory: ScopedVersionedMemory;
  readonly ledgerName: string;
  readonly vintage: ForecastVintage;
}): Promise<Result<void>> {
  const written = await params.memory.remember({
    scope: FINANCE_MEMORY_SCOPE,
    kind: 'artifact',
    content: `forecast v${params.vintage.version}: ${params.vintage.reason}`,
    key: forecastKey(params.ledgerName),
    reason: params.vintage.reason,
    tags: ['finance:vintage', `vintage:${params.vintage.id}`],
    sourceRunId: String(params.vintage.runId),
    confidence: params.vintage.confidence,
    // `validFrom` is when the forecast came into force, which is when it was
    // created. The store's own createdAt records when it was written down --
    // the two coincide here, and keeping them separate still matters for a
    // vintage backfilled from an export.
    validFrom: params.vintage.createdAt,
    metadata: { vintage: params.vintage },
  });
  if (!written.ok) return written;
  return ok(undefined);
}

/**
 * Rebuilds a ledger from memory.
 *
 * Returns an empty ledger when nothing is stored -- a first run is not an
 * error. A record whose payload will not parse is refused rather than skipped:
 * a ledger silently missing a vintage would renumber the ones after it, and
 * every horizon measured against it would be wrong by an amount nobody could
 * see.
 */
export async function restoreLedger(params: {
  readonly memory: ScopedVersionedMemory;
  readonly ledgerName: string;
}): Promise<Result<ForecastLedger>> {
  const history = await params.memory.history(FINANCE_MEMORY_SCOPE, forecastKey(params.ledgerName));
  if (!history.ok) return history;

  const vintages: ForecastVintage[] = [];
  for (const window of history.value) {
    const stored = window.record.metadata?.['vintage'];
    if (!isVintage(stored)) {
      return err(
        nexusError('INTERNAL', `stored vintage '${window.record.id}' is unreadable`, {
          details: { recordId: window.record.id, ledger: params.ledgerName },
        }),
      );
    }
    vintages.push(stored);
  }

  if (vintages.length === 0) return ok(createForecastLedger());

  try {
    // The ledger validates the chain on construction: contiguous versions and
    // matching supersedes pointers. Anything else throws, which is right --
    // a corrupted chain is not something a caller can sensibly continue from.
    return ok(createForecastLedger({ initial: vintages }));
  } catch (cause) {
    return err(
      nexusError('INTERNAL', `stored forecast chain for '${params.ledgerName}' is inconsistent`, {
        cause,
        details: { ledger: params.ledgerName, vintages: vintages.length },
      }),
    );
  }
}

/**
 * The vintage in force at a point in time, across every run that ever wrote
 * one. This is the question that was unanswerable before Phase 10.
 */
export async function vintageAsOf(params: {
  readonly memory: ScopedVersionedMemory;
  readonly ledgerName: string;
  readonly at: string;
}): Promise<Result<ForecastVintage | null>> {
  const found = await params.memory.asOf(
    FINANCE_MEMORY_SCOPE,
    forecastKey(params.ledgerName),
    params.at,
  );
  if (!found.ok) return found;
  if (found.value === null) return ok(null);

  const stored = found.value.metadata?.['vintage'];
  if (!isVintage(stored)) {
    return err(nexusError('INTERNAL', `stored vintage '${found.value.id}' is unreadable`));
  }
  return ok(stored);
}

function isVintage(value: unknown): value is ForecastVintage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<ForecastVintage>;
  return (
    typeof v.id === 'string' &&
    typeof v.version === 'number' &&
    typeof v.reason === 'string' &&
    typeof v.createdAt === 'string' &&
    Array.isArray(v.drivers) &&
    Array.isArray(v.amounts) &&
    (v.supersedes === null || typeof v.supersedes === 'string')
  );
}
