import type { Clock } from '../application/ports.ts';

/** Production Clock: the real system time (UTC epoch milliseconds). */
export const systemClock: Clock = {
  now: () => Date.now(),
};
