/**
 * Health aggregation. The worst component status becomes the system status, so
 * a single unavailable dependency is never hidden behind healthy neighbours.
 */
import { type Clock, systemClock } from '../clock.ts';
import type {
  HealthCheck,
  HealthReport,
  HealthStatus,
  SystemHealth,
} from '../contracts/health.ts';

const SEVERITY: Record<HealthStatus, number> = {
  healthy: 0,
  degraded: 1,
  unavailable: 2,
};

export function worstStatus(statuses: readonly HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>(
    (worst, status) => (SEVERITY[status] > SEVERITY[worst] ? status : worst),
    'healthy',
  );
}

export interface HealthRegistry {
  register(check: HealthCheck): void;
  report(): Promise<SystemHealth>;
}

export function createHealthRegistry(clock: Clock = systemClock): HealthRegistry {
  const checks: HealthCheck[] = [];

  return {
    register(check) {
      checks.push(check);
    },

    async report(): Promise<SystemHealth> {
      const components = await Promise.all(
        checks.map(async (check): Promise<HealthReport> => {
          try {
            return await check.check();
          } catch (cause) {
            // A check that throws is itself evidence of an unhealthy component.
            return {
              component: check.name,
              status: 'unavailable',
              checkedAt: clock.now().toISOString(),
              detail: `health check threw: ${cause instanceof Error ? cause.message : String(cause)}`,
            };
          }
        }),
      );

      return {
        status: worstStatus(components.map((component) => component.status)),
        checkedAt: clock.now().toISOString(),
        components,
      };
    },
  };
}

/** Wraps anything implementing health() into a named HealthCheck. */
export function healthCheck(name: string, probe: () => Promise<HealthReport>): HealthCheck {
  return { name, check: probe };
}
