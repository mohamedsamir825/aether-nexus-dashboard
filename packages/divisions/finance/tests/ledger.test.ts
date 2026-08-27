import { test, expect, describe } from 'bun:test';
import { accuracyOf, createForecastLedger, nextVintage } from '../src/ledger.ts';
import type { ForecastVintage } from '../src/types.ts';
import { BASELINE } from './fixtures.ts';

const vintage = (over: Partial<ForecastVintage> = {}): ForecastVintage => ({
  ...BASELINE,
  id: 'fv_2',
  version: 2,
  supersedes: 'fv_base',
  reason: 'revised after Q1 actuals',
  ...over,
});

describe('forecast vintages are immutable and superseded, never overwritten', () => {
  test('the chain records history rather than replacing it', () => {
    const ledger = createForecastLedger({ initial: [BASELINE] });
    expect(ledger.append(vintage()).ok).toBe(true);

    // Both survive. This is the §4.3 requirement in one assertion: the number
    // that was believed in January still exists in April.
    expect(ledger.all().map((v) => v.id)).toEqual(['fv_base', 'fv_2']);
    expect(ledger.head()?.id).toBe('fv_2');
    expect(ledger.get('fv_base')?.confidence).toBe(0.8);
  });

  test('a vintage cannot be mutated after it is appended', () => {
    const ledger = createForecastLedger({ initial: [BASELINE] });
    const stored = ledger.get('fv_base');
    expect(stored).not.toBeNull();
    if (stored === null) return;

    // Frozen, not merely typed readonly: `readonly` is erased at runtime, and
    // an audit chain that depends on nobody trying is not an audit chain.
    expect(Object.isFrozen(stored)).toBe(true);
    expect(() => {
      (stored as { confidence: number }).confidence = 0.1;
    }).toThrow();
    expect(ledger.get('fv_base')?.confidence).toBe(0.8);
  });

  test('appending onto a stale head is refused, not silently rebased', () => {
    // Two revisions computed against the same baseline. The second was built
    // from a position that has moved on, and accepting it would produce a
    // chain whose stated order never happened.
    const ledger = createForecastLedger({ initial: [BASELINE] });
    expect(ledger.append(vintage({ id: 'fv_a' })).ok).toBe(true);

    const stale = ledger.append(vintage({ id: 'fv_b' }));
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('INVALID_INPUT');
    expect(ledger.all()).toHaveLength(2);
  });

  test('a correct version with a stale predecessor is still refused', () => {
    // Isolates the supersedes check from the version check. Without this the
    // version guard catches the stale-head case first and the supersedes guard
    // could be deleted with every test still green.
    const ledger = createForecastLedger({ initial: [BASELINE] });
    expect(ledger.append(vintage({ id: 'fv_a' })).ok).toBe(true);

    const stale = ledger.append(vintage({ id: 'fv_b', version: 3, supersedes: 'fv_base' }));
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.message).toContain('supersedes');
    expect(ledger.all()).toHaveLength(2);
  });

  test('version numbers must be contiguous', () => {
    const ledger = createForecastLedger({ initial: [BASELINE] });
    const skipped = ledger.append(vintage({ version: 7 }));
    expect(skipped.ok).toBe(false);
    if (!skipped.ok) expect(skipped.error.message).toContain('expected 2');
  });

  test('a duplicate id is refused', () => {
    const ledger = createForecastLedger({ initial: [BASELINE] });
    const dup = ledger.append(vintage({ id: 'fv_base', version: 2 }));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe('ALREADY_EXISTS');
  });

  test('a vintage must say why it exists', () => {
    const ledger = createForecastLedger({ initial: [BASELINE] });
    const silent = ledger.append(vintage({ reason: '   ' }));
    expect(silent.ok).toBe(false);
    if (!silent.ok) expect(silent.error.message).toContain('why it exists');
  });

  test('nextVintage derives version and supersedes from the ledger', () => {
    // Callers do not get to assert their own position in the chain.
    const ledger = createForecastLedger({ initial: [BASELINE] });
    const next = nextVintage(ledger, { ...BASELINE, id: 'fv_x', reason: 'r' });
    expect(next.version).toBe(2);
    expect(next.supersedes).toBe('fv_base');
    expect(ledger.append(next).ok).toBe(true);
  });

  test('lineage walks back to the first vintage', () => {
    const ledger = createForecastLedger({ initial: [BASELINE] });
    ledger.append(vintage({ id: 'fv_2' }));
    ledger.append(vintage({ id: 'fv_3', version: 3, supersedes: 'fv_2' }));

    const line = ledger.lineage('fv_3');
    expect(line.ok && line.value.map((v) => v.id)).toEqual(['fv_base', 'fv_2', 'fv_3']);

    const partial = ledger.lineage('fv_2');
    expect(partial.ok && partial.value.map((v) => v.id)).toEqual(['fv_base', 'fv_2']);
  });

  test('an unknown vintage has no lineage rather than an empty one', () => {
    const ledger = createForecastLedger({ initial: [BASELINE] });
    const missing = ledger.lineage('fv_nope');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND');
  });
});

describe('retrospective accuracy — the reason vintages are kept', () => {
  test('accuracy is measured against what was believed at the time', () => {
    // Baseline said 50,000; actual was 56,000.
    const measured = accuracyOf(BASELINE, 'revenue', '2026-Q1', 56_000);
    expect(measured).not.toBeNull();
    expect(measured?.forecast).toBe(50_000);
    expect(measured?.error).toBe(6_000);
    expect(measured?.absPercent).toBeCloseTo(6_000 / 56_000, 10);
  });

  test('a line item never forecast has no accuracy, not zero accuracy', () => {
    // Absence of a forecast is not a forecast of zero, and scoring it as one
    // would make a division look wrong about something it never claimed.
    expect(accuracyOf(BASELINE, 'headcount', '2026-Q1', 12)).toBeNull();
  });
});
