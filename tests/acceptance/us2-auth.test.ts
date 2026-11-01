// Verifier (T021) — User Story 2: register, sign in and sign out securely. Spec: FR-001…FR-004.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, PASSWORD, type Harness } from '../support/harness.ts';
import { HOUR, MINUTE } from '../support/fixed-clock.ts';

let h: Harness;
beforeEach(async () => { h = await startHarness(); });
afterEach(() => h.close());

describe('US2 — Register, sign in and sign out securely', () => {
  it('US2-1 (FR-001): registering with a university email creates a student account and never returns the password', async () => {
    const r = await h.anon.post('/auth/register', { email: 'alice@uni.example', displayName: 'Alice', password: PASSWORD });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ email: 'alice@uni.example', displayName: 'Alice', role: 'student' });
    expect(r.text).not.toContain(PASSWORD);
    expect(r.text.toLowerCase()).not.toContain('hash');
  });

  it('US2-2 (FR-001): an email outside the allowed domain is rejected', async () => {
    const r = await h.anon.post('/auth/register', { email: 'bob@gmail.com', displayName: 'Bob', password: PASSWORD });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
  });

  it('US2-3 (FR-002, FR-004): correct password gives an 8-hour session; wrong password and unknown email give the same generic error', async () => {
    await h.anon.post('/auth/register', { email: 'carol@uni.example', displayName: 'Carol', password: PASSWORD });
    const ok = await h.anon.post('/auth/login', { email: 'carol@uni.example', password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(Date.parse(ok.body.expiresAt)).toBe(h.clock.now() + 8 * HOUR);
    expect(ok.body.user.email).toBe('carol@uni.example');

    const wrong = await h.anon.post('/auth/login', { email: 'carol@uni.example', password: 'not the password' });
    const unknown = await h.anon.post('/auth/login', { email: 'nobody@uni.example', password: 'not the password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('US2-4 (FR-004): after 5 failures within 15 minutes even the correct password is refused for 15 minutes, and the lockout is audit-logged', async () => {
    await h.anon.post('/auth/register', { email: 'dave@uni.example', displayName: 'Dave', password: PASSWORD });
    for (let i = 0; i < 5; i++) {
      const r = await h.anon.post('/auth/login', { email: 'dave@uni.example', password: `wrong-${i}` });
      expect(r.status).toBe(401);
      h.clock.advance(MINUTE);
    }
    const locked = await h.anon.post('/auth/login', { email: 'dave@uni.example', password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThanOrEqual(1);

    // last failure happened 1 minute ago → still locked just before 15 minutes after it
    h.clock.advance(13 * MINUTE + 59_000);
    expect((await h.anon.post('/auth/login', { email: 'dave@uni.example', password: PASSWORD })).status).toBe(429);
    h.clock.advance(1_000);
    expect((await h.anon.post('/auth/login', { email: 'dave@uni.example', password: PASSWORD })).status).toBe(200);

    const audit = await h.admin.api.get('/admin/audit-events?limit=200');
    const actions = audit.body.events.map((e: any) => e.action);
    expect(actions).toContain('auth.locked');
    expect(actions).toContain('auth.login.failed');
  });

  it('US2-5 (FR-003): after sign-out the session is no longer accepted', async () => {
    const u = await h.newUser();
    expect((await u.api.get('/me')).status).toBe(200);
    expect((await u.api.post('/auth/logout')).status).toBe(204);
    const after = await u.api.get('/me');
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('US2 — edge cases', () => {
  it('FR-002: a session expires exactly 8 hours after sign-in', async () => {
    const u = await h.newUser();
    h.clock.advance(8 * HOUR - 1);
    expect((await u.api.get('/me')).status).toBe(200);
    h.clock.advance(1);
    expect((await u.api.get('/me')).status).toBe(401);
  });

  it('FR-001: password equal to the email is rejected', async () => {
    const r = await h.anon.post('/auth/register', { email: 'eve.long.name@uni.example', displayName: 'Eve', password: 'EVE.LONG.NAME@uni.example' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('PASSWORD_EQUALS_EMAIL');
  });

  it('FR-001: password shorter than 12 characters is rejected and the error names the field (NFR-007)', async () => {
    const r = await h.anon.post('/auth/register', { email: 'frank@uni.example', displayName: 'Frank', password: 'short-11chr' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
    expect(r.body.error.details.map((d: any) => d.field)).toContain('password');
  });

  it('FR-001: a second account for the same email (any letter case) is rejected', async () => {
    await h.anon.post('/auth/register', { email: 'gina@uni.example', displayName: 'Gina', password: PASSWORD });
    const r = await h.anon.post('/auth/register', { email: 'GINA@uni.example', displayName: 'Gina 2', password: PASSWORD });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('NFR-004: unknown fields in the request are rejected', async () => {
    const r = await h.anon.post('/auth/register', { email: 'hal@uni.example', displayName: 'Hal', password: PASSWORD, role: 'admin' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('missing or forged tokens are refused', async () => {
    expect((await h.anon.get('/me')).status).toBe(401);
    expect((await h.as('forged-token-forged-token-forged-token').get('/me')).status).toBe(401);
  });

  it('FR-004: lockout also applies to unknown emails, so it does not reveal which accounts exist', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await h.anon.post('/auth/login', { email: 'ghost@uni.example', password: 'x' })).status).toBe(401);
    }
    const r = await h.anon.post('/auth/login', { email: 'ghost@uni.example', password: 'x' });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('FR-004: a successful sign-in resets the failure counter', async () => {
    const u = await h.newUser();
    for (let i = 0; i < 4; i++) await h.anon.post('/auth/login', { email: u.email, password: 'wrong' });
    expect((await h.anon.post('/auth/login', { email: u.email, password: PASSWORD })).status).toBe(200);
    for (let i = 0; i < 4; i++) await h.anon.post('/auth/login', { email: u.email, password: 'wrong' });
    expect((await h.anon.post('/auth/login', { email: u.email, password: PASSWORD })).status).toBe(200);
  });
});
