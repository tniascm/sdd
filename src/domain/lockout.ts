/**
 * FR-004 sign-in lockout (data-model.md "LoginFailure"): after 5 failed attempts within
 * 15 minutes, sign-in is refused until 15 minutes after the most recent failure.
 */
export const LOCKOUT = Object.freeze({ maxFailures: 5, windowMs: 15 * 60_000, durationMs: 15 * 60_000 });

/**
 * @param lastFailureAt     time of the most recent recorded failure, or null
 * @param failuresInWindow  failures with `at > lastFailureAt − windowMs` (the window ending at the last failure)
 * @returns the instant the lock ends, or null when sign-in is not locked at `now`
 */
export function lockedUntil(lastFailureAt: number | null, failuresInWindow: number, now: number): number | null {
  if (lastFailureAt === null || failuresInWindow < LOCKOUT.maxFailures) return null;
  const until = lastFailureAt + LOCKOUT.durationMs;
  return now < until ? until : null;
}
