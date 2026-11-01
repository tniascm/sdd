/**
 * FR-004 lockout, safe under concurrency (R-1): the lock check and the recording of the attempt
 * as a failure happen in one synchronous step *before* the password is verified, so however many
 * requests arrive at once, at most 5 passwords per account are checked within a lock window.
 * A correct password removes the account's failures again. Used by sign-in and by the password
 * re-entry for account deletion (FR-019, R-7).
 */
import { DomainError } from '../domain/errors.ts';
import { LOCKOUT, lockedUntil } from '../domain/lockout.ts';
import type { AuditService, AuditTarget } from './audit-service.ts';
import type { Clock, LoginFailureRepository, TokenService, UnitOfWork } from './ports.ts';

export type PasswordAttemptsDeps = {
  loginFailures: LoginFailureRepository;
  tokens: TokenService;
  clock: Clock;
  uow: UnitOfWork;
  audit: AuditService;
};

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class PasswordAttempts {
  private readonly deps: PasswordAttemptsDeps;

  constructor(deps: PasswordAttemptsDeps) {
    this.deps = deps;
  }

  /**
   * Call before verifying a password for `email`. Throws TOO_MANY_ATTEMPTS (and audits
   * `auth.locked`) when the account is locked; otherwise records this attempt as a failure.
   * Must stay synchronous: no `await` between the check and the insert.
   */
  begin(email: string, target: AuditTarget | null): void {
    const { loginFailures, clock, uow, audit } = this.deps;
    const key = this.key(email);
    const now = clock.now();
    const until = uow.transaction(() => {
      const last = loginFailures.lastAt(key);
      const failures = last === null ? 0 : loginFailures.countSince(key, last - LOCKOUT.windowMs);
      const lockEnd = lockedUntil(last, failures, now);
      if (lockEnd === null) loginFailures.record(key, now);
      return lockEnd;
    });
    if (until === null) return;
    audit.record('auth.locked', null, target);
    const retryAfterSeconds = Math.max(1, Math.ceil((until - now) / 1000));
    throw new DomainError(
      'TOO_MANY_ATTEMPTS',
      `Too many failed sign-in attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
      undefined,
      { retryAfterSeconds },
    );
  }

  /** The password was correct: the account's failures (including this attempt) are removed. */
  clear(email: string): void {
    this.deps.loginFailures.clear(this.key(email));
  }

  /** SHA-256 of the normalised email, the only form in which `login_failures` stores it (R-3). */
  private key(email: string): string {
    return this.deps.tokens.hash(normaliseEmail(email));
  }
}
