/**
 * Regenerates the contract baseline.
 *
 * Run this ONLY when a contract change is deliberate and carries an ADR:
 *     bun run contracts:baseline
 *
 * The baseline exists so that changing a Core contract is a conscious act. If
 * you are running this to make a failing test go away, stop and write the ADR
 * first -- that is the whole point of the tripwire.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const contractsDir = join(import.meta.dir, '..', 'src', 'contracts');
const baselinePath = join(import.meta.dir, '..', 'tests', 'contract-baseline.json');

const hashes: Record<string, string> = {};
for (const file of readdirSync(contractsDir).filter((f) => f.endsWith('.ts')).sort()) {
  hashes[file] = createHash('sha256').update(readFileSync(join(contractsDir, file))).digest('hex');
}

writeFileSync(baselinePath, `${JSON.stringify({ contracts: hashes }, null, 2)}\n`);
console.log(`baseline written: ${Object.keys(hashes).length} contracts`);
