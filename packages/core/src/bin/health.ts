/**
 * `bun run health` -- the minimum viable operational check.
 *
 * Prints a JSON health report and exits non-zero when the system is
 * unavailable, so it is usable as a container healthcheck or a CI smoke test.
 * It reads real configuration and reports the real state: with no provider
 * adapters registered it will say so, and that is the correct answer today.
 */
import { loadConfig, describeConfig } from '../config/config.ts';
import { createNexusSystem } from '../system.ts';
import { nullLogger } from '../logger.ts';

const config = loadConfig(process.env);
if (!config.ok) {
  console.error(JSON.stringify({ status: 'unavailable', error: config.error }, null, 2));
  process.exit(2);
}

const system = createNexusSystem({ config: config.value, logger: nullLogger });
const report = await system.reportHealth();

console.log(
  JSON.stringify(
    { ...report, configuration: describeConfig(config.value) },
    null,
    2,
  ),
);

process.exit(report.status === 'unavailable' ? 1 : 0);
