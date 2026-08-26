export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

/** Discards everything. The default, so libraries are silent unless wired up. */
export const nullLogger: Logger = {
  log: () => {},
  child: () => nullLogger,
};

export function consoleLogger(minLevel: LogLevel = 'info', base: Record<string, unknown> = {}): Logger {
  return {
    log(level, message, fields) {
      if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
      const line = { level, message, ...base, ...fields };
      console[level === 'debug' ? 'log' : level](JSON.stringify(line));
    },
    child(fields) {
      return consoleLogger(minLevel, { ...base, ...fields });
    },
  };
}
