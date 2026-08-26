/**
 * The tripwire behind ADR 0004.
 *
 * That ADR says adding a model provider must not require editing
 * `contracts/model-provider.ts`, any agent, or any skill -- and that if it does,
 * the abstraction is wrong and needs a superseding ADR. Stated in prose, that is
 * an intention. This test makes it a guarantee: the Core contracts are hashed,
 * and any change fails until someone deliberately regenerates the baseline.
 *
 * It is not here to prevent change. It is here to make change conscious, because
 * a contract edit is the kind of decision that should cost a conversation rather
 * than a keystroke.
 */
import { test, expect, describe } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import baseline from './contract-baseline.json' with { type: 'json' };

const contractsDir = join(import.meta.dir, '..', 'src', 'contracts');
const recorded = baseline.contracts as Record<string, string>;

const hashOf = (file: string): string =>
  createHash('sha256').update(readFileSync(join(contractsDir, file))).digest('hex');

const currentFiles = (): string[] =>
  readdirSync(contractsDir).filter((f) => f.endsWith('.ts')).sort();

const GUIDANCE =
  'A Core contract changed. That is an ADR-level decision (see ADR 0004): if this ' +
  'came from adding a provider, the abstraction is wrong, not the test. If the ' +
  'change is deliberate and carries an ADR, accept it with `bun run contracts:baseline`.';

describe('Core contract stability', () => {
  test('no contract file has changed since the recorded baseline', () => {
    const drifted = currentFiles().filter(
      (file) => recorded[file] !== undefined && recorded[file] !== hashOf(file),
    );
    expect(drifted, `${GUIDANCE} Changed: ${drifted.join(', ')}`).toEqual([]);
  });

  test('no contract file has been added or removed without accepting the baseline', () => {
    expect(currentFiles(), GUIDANCE).toEqual(Object.keys(recorded).sort());
  });

  test('the baseline is not vacuous', () => {
    // A tripwire covering nothing is worse than none: it reports safety it does
    // not provide.
    expect(Object.keys(recorded).length).toBeGreaterThan(5);
  });
});
