// R-1 / R-7 (FR-004, FR-019 amended): a concurrent burst of password attempts for one account gets
// at most 5 password checks per lock window — at service level, with a hasher that counts checks.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountService } from '../../src/application/account-service.ts';
import { AuthService } from '../../src/application/auth-service.ts';
import type { PasswordHasher } from '../../src/application/ports.ts';
import { buildContainer, type Container } from '../../src/container.ts';
import { DomainError } from '../../src/domain/errors.ts';

const NOW = Date.parse('2026-11-02T06:00:00.000Z');
const PASSWORD = 'correct horse battery';
const EMAIL = 'alice@uni.example';

let c: Container;
let checks: number;
let auth: AuthService;
let accounts: AccountService;

beforeEach(async () => {
  c = buildContainer({
    dbFile: ':memory:',
    clock: { now: () => NOW },
    config: {
      port: 0, dbFile: ':memory:', timeZone: 'Europe/Helsinki', opensAt: '08:00', closesAt: '22:00',
      allowedEmailDomains: ['uni.example'], rateLimitPerMinute: 1000, sessionTtlMs: 8 * 3_600_000, admin: null,
    },
    hasherParams: { N: 1024, r: 8, p: 1 },
  });
  await c.auth.register({ email: EMAIL, displayName: 'Alice', password: PASSWORD });
  checks = 0;
  const counting: PasswordHasher = {
    hash: (pw) => c.hasher.hash(pw),
    verify: (pw, stored) => {
      checks += 1;
      return c.hasher.verify(pw, stored);
    },
  };
  const shared = { users: c.repos.users, attempts: c.attempts, tokens: c.tokens, hasher: counting, clock: c.clock, uow: c.uow, audit: c.audit };
  auth = new AuthService({ ...shared, sessions: c.repos.sessions, config: c.config });
  accounts = new AccountService({ ...shared, bookings: c.repos.bookings, storage: { flush: () => undefined } });
});
afterEach(() => c.close());

/** Settles every promise and returns the outcome codes. */
async function outcomes(calls: Promise<unknown>[]): Promise<string[]> {
  const settled = await Promise.allSettled(calls);
  return settled.map((s) => (s.status === 'fulfilled' ? 'OK' : (s.reason as DomainError).code));
}
const count = (codes: string[], code: string) => codes.filter((x) => x === code).length;
const sessions = () => (c.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;

describe('sign-in under concurrency (FR-004, R-1)', () => {
  it('20 simultaneous wrong passwords: exactly 5 are checked, 15 are refused as locked', async () => {
    const codes = await outcomes(Array.from({ length: 20 }, () => auth.login(EMAIL, 'wrong password!')));
    expect(checks).toBe(5);
    expect(count(codes, 'INVALID_CREDENTIALS')).toBe(5);
    expect(count(codes, 'TOO_MANY_ATTEMPTS')).toBe(15);
  });

  it('the right password at the end of a burst is never checked and no session is issued', async () => {
    const burst = Array.from({ length: 20 }, (_, i) => auth.login(EMAIL, i === 19 ? PASSWORD : `guess-${i}-guess`));
    const codes = await outcomes(burst);
    expect(checks).toBe(5);
    expect(codes[19]).toBe('TOO_MANY_ATTEMPTS');
    expect(sessions()).toBe(0);
  });

  it('the right password within the first 5 attempts signs in and clears the failures', async () => {
    const codes = await outcomes([auth.login(EMAIL, 'wrong-1-wrong'), auth.login(EMAIL, PASSWORD), auth.login(EMAIL, 'wrong-2-wrong')]);
    expect(codes).toEqual(['INVALID_CREDENTIALS', 'OK', 'INVALID_CREDENTIALS']);
    expect(sessions()).toBe(1);
  });

  it('unknown emails are limited the same way', async () => {
    const codes = await outcomes(Array.from({ length: 12 }, () => auth.login('ghost@uni.example', 'whatever-123')));
    expect(checks).toBe(5);
    expect(count(codes, 'TOO_MANY_ATTEMPTS')).toBe(7);
  });

  it('a refused attempt is audited as auth.locked; failed sign-ins carry no email-derived value (R-3)', async () => {
    await outcomes(Array.from({ length: 6 }, () => auth.login(EMAIL, 'wrong password!')));
    const events = c.audit.list({ limit: 50 });
    expect(events.filter((e) => e.action === 'auth.login.failed')).toHaveLength(5);
    expect(events.filter((e) => e.action === 'auth.locked')).toHaveLength(1);
    for (const e of events.filter((x) => x.action.startsWith('auth.'))) expect(e.details).toEqual({});
  });
});

describe('account deletion under concurrency (FR-019, R-7)', () => {
  it('a burst of wrong deletion passwords gets at most 5 checks and the account survives', async () => {
    const actor = { userId: c.repos.users.findByEmail(EMAIL)!.id, role: 'student' as const };
    const codes = await outcomes(Array.from({ length: 10 }, () => accounts.erase(actor, 'wrong password!')));
    expect(checks).toBe(5);
    expect(count(codes, 'PASSWORD_INCORRECT')).toBe(5);
    expect(count(codes, 'TOO_MANY_ATTEMPTS')).toBe(5);
    expect(c.repos.users.findByEmail(EMAIL)).not.toBeNull();
    // and sign-in is locked too: the failures belong to the account (FR-004)
    await expect(auth.login(EMAIL, PASSWORD)).rejects.toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
  });
});
