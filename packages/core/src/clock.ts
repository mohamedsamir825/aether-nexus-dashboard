/** Time is injected, never read from a global, so execution is testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Test double: advances only when told to. */
export function fixedClock(start: Date): Clock & { advance(ms: number): void } {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}
