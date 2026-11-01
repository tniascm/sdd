// FR-004 + data-model.md LoginFailure: locked ⇔ ≥ 5 failures within 15 min; the lock lasts until
// 15 min after the most recent failure (refused attempts are not failures).
import { describe, expect, it } from 'vitest';
import { LOCKOUT, lockedUntil } from '../../src/domain/lockout.ts';

const MIN = 60_000;
const T = Date.parse('2026-11-02T06:00:00.000Z');

describe('lockedUntil', () => {
  it('uses the FR-004 numbers', () => {
    expect(LOCKOUT).toEqual({ maxFailures: 5, windowMs: 15 * MIN, durationMs: 15 * MIN });
  });

  it('is not locked without failures or with fewer than 5 in the window', () => {
    expect(lockedUntil(null, 0, T)).toBeNull();
    expect(lockedUntil(T, 4, T)).toBeNull();
  });

  it('is locked from the 5th failure until 15 min after the last failure', () => {
    const last = T + 4 * MIN;
    expect(lockedUntil(last, 5, last)).toBe(last + 15 * MIN);
    expect(lockedUntil(last, 5, last + 15 * MIN - 1)).toBe(last + 15 * MIN);
    expect(lockedUntil(last, 5, last + 15 * MIN)).toBeNull();
    expect(lockedUntil(last, 7, last + MIN)).toBe(last + 15 * MIN);
  });
});
