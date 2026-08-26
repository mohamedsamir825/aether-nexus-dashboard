/**
 * Health is how a subsystem reports that it is unavailable *before* an agent
 * depends on it. Every provider, store and bus implements it.
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unavailable';

export interface HealthReport {
  readonly component: string;
  readonly status: HealthStatus;
  readonly checkedAt: string;
  /** Human-readable, and never contains secrets. */
  readonly detail?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface HealthCheck {
  readonly name: string;
  /**
   * A check must not throw and must not hang indefinitely; it reports
   * 'unavailable' instead.
   */
  check(): Promise<HealthReport>;
}

export interface SystemHealth {
  readonly status: HealthStatus;
  readonly checkedAt: string;
  readonly components: readonly HealthReport[];
}

export interface HealthReporter {
  health(): Promise<HealthReport>;
}
