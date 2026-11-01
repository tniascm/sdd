// Verifier — regression tests for the independent review (docs/evidence/review-findings.md) and the
// usability walkthrough (docs/evidence/usability/walkthrough.md). Written red, before the fixes.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import { startHarness, at, TOMORROW, PASSWORD, type Harness } from '../support/harness.ts';
import { DAY, HOUR } from '../support/fixed-clock.ts';

let h: Harness | undefined;
const tmpDirs: string[] = [];
afterEach(() => {
  h?.close();
  h = undefined;
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('R-1 (High) — FR-004 lockout cannot be bypassed by concurrent attempts', () => {
  it('10 simultaneous wrong-password attempts: at most 5 passwords are checked, the rest are refused', async () => {
    h = await startHarness();
    const u = await h.newUser();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => h!.anon.post('/auth/login', { email: u.email, password: 'wrong password!' })),
    );
    const checked = results.filter((r) => r.status === 401).length;
    const refused = results.filter((r) => r.status === 429).length;
    expect(checked).toBeLessThanOrEqual(5);
    expect(checked + refused).toBe(10);
    const after = await h.anon.post('/auth/login', { email: u.email, password: PASSWORD });
    expect([after.status, after.body.error?.code]).toEqual([429, 'TOO_MANY_ATTEMPTS']);
  });

  it('a correct password hidden among a burst of guesses does not get through once 5 guesses have failed', async () => {
    h = await startHarness();
    const u = await h.newUser();
    const burst = Array.from({ length: 30 }, (_, i) => (i === 29 ? PASSWORD : `guess-${i}-guess`));
    const results = await Promise.all(burst.map((password) => h!.anon.post('/auth/login', { email: u.email, password })));
    expect(results.filter((r) => r.status === 401).length).toBeLessThanOrEqual(5);
  });
});

describe('R-2 / R-10 — FR-019, SC-006: erasure leaves no personal data in the database files', () => {
  it('after erasure and shutdown, neither the email nor the display name is in the .db or -wal file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'roombook-erase-'));
    tmpDirs.push(dir);
    const dbFile = join(dir, 'test.db');
    h = await startHarness({ dbFile });
    const room = await h.createRoom();
    const zelda = await h.newUser({ email: 'zelda.ondisk@uni.example', displayName: 'Zelda Ondiskname' });
    const b = await h.book(zelda, { roomId: room.id, start: at(TOMORROW, '10:00'), end: at(TOMORROW, '11:00'), purpose: 'Zelda Ondiskname group' });
    await h.admin.api.post(`/bookings/${b.body.id}/cancel`, { reason: 'Zelda Ondiskname asked by phone' });
    expect((await zelda.api.post('/me/erase', { password: PASSWORD })).status).toBe(204);
    h.close();
    h = undefined;
    for (const f of [dbFile, `${dbFile}-wal`]) {
      if (!existsSync(f)) continue;
      const bytes = readFileSync(f);
      expect(bytes.includes(Buffer.from('zelda.ondisk@uni.example')), `${f} contains the email`).toBe(false);
      expect(bytes.includes(Buffer.from('Zelda Ondiskname')), `${f} contains the name`).toBe(false);
    }
  });
});

describe('R-3 — FR-020: failed sign-in audit events contain no email-derived value', () => {
  it('no SHA-256 of the attempted email appears in the audit log', async () => {
    h = await startHarness();
    const u = await h.newUser();
    await h.anon.post('/auth/login', { email: u.email, password: 'wrong password!' });
    await h.anon.post('/auth/login', { email: 'nobody@uni.example', password: 'wrong password!' });
    const audit = await h.admin.api.get('/admin/audit-events?limit=200');
    for (const email of [u.email, 'nobody@uni.example']) {
      expect(audit.text).not.toContain(createHash('sha256').update(email).digest('hex'));
    }
    const failed = audit.body.events.find((e: any) => e.action === 'auth.login.failed' && e.targetId === u.id);
    expect(failed).toBeDefined();
  });
});

describe('R-4 — the example administrator password is never accepted', () => {
  it('loadConfig rejects an empty ADMIN_PASSWORD and the old placeholder', () => {
    const base = { ADMIN_EMAIL: 'admin@uni.example' };
    expect(() => loadConfig({ ...base, ADMIN_PASSWORD: '' })).toThrow();
    expect(() => loadConfig({ ...base, ADMIN_PASSWORD: 'replace-with-a-long-secret' })).toThrow();
    const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    const line = example.split('\n').find((l) => l.startsWith('ADMIN_PASSWORD='));
    expect(line === undefined || line === 'ADMIN_PASSWORD=').toBe(true);
  });
});

describe('R-5 — NFR-002: API responses are not cacheable', () => {
  it('sign-in and data export carry Cache-Control: no-store', async () => {
    h = await startHarness();
    const u = await h.newUser();
    const login = await h.anon.post('/auth/login', { email: u.email, password: PASSWORD });
    expect(login.headers['cache-control']).toContain('no-store');
    expect((await u.api.get('/me/export')).headers['cache-control']).toContain('no-store');
  });
});

describe('R-7 — FR-019: wrong passwords on account deletion count towards the lock', () => {
  it('the 6th wrong password on /me/erase is refused with 429', async () => {
    h = await startHarness();
    const u = await h.newUser();
    for (let i = 0; i < 5; i++) {
      expect((await u.api.post('/me/erase', { password: `wrong-${i}-wrong` })).status).toBe(403);
    }
    const r = await u.api.post('/me/erase', { password: PASSWORD });
    expect([r.status, r.body.error?.code]).toEqual([429, 'TOO_MANY_ATTEMPTS']);
    expect((await u.api.get('/me')).status).toBe(200);
  });
});

describe('R-8 — NFR-004: out-of-range dates are invalid input, never a 500', () => {
  it('years outside 2000–2099 give 400', async () => {
    h = await startHarness();
    const u = await h.newUser();
    const room = await h.createRoom();
    expect((await u.api.get(`/rooms/${room.id}/availability?date=0050-01-01`)).status).toBe(400);
    expect((await h.admin.api.get('/admin/bookings?date=0099-12-31')).status).toBe(400);
    expect((await u.api.get(`/rooms/${room.id}/availability?date=2100-01-01`)).status).toBe(400);
  });
});

describe('R-9 — FR-021: the maintenance task also purges login failures and ended sessions', () => {
  it('failures older than 24 h and sessions ended more than 24 h ago are deleted', async () => {
    h = await startHarness();
    const u = await h.newUser();
    await h.anon.post('/auth/login', { email: u.email, password: 'wrong password!' });
    await u.api.post('/auth/logout');
    const count = (t: string) => (h!.container.db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect(count('login_failures')).toBeGreaterThan(0);
    h.clock.advance(8 * HOUR + DAY + 1);
    h.container.maintenance.purge();
    expect(count('login_failures')).toBe(0);
    expect(count('sessions')).toBe(0);
  });
});

describe('R-11, R-12, U-3, U-4 — UI support', () => {
  it('health reports the campus time zone (R-11)', async () => {
    h = await startHarness();
    const r = await h.anon.get('/health');
    expect(r.body).toEqual({ status: 'ok', timeZone: 'Europe/Helsinki' });
  });

  it('CSP restricts base URI and form targets (R-12)', async () => {
    h = await startHarness();
    const csp = (await request(h.app).get('/')).headers['content-security-policy'];
    expect(csp).toMatch(/base-uri '(none|self)'/);
    expect(csp).toContain("form-action 'self'");
  });

  it('the page declares an icon that exists (U-3) and the deletion form names the account (U-4)', async () => {
    h = await startHarness();
    const page = await request(h.app).get('/');
    const icon = page.text.match(/<link[^>]+rel="icon"[^>]+href="([^"]+)"/);
    expect(icon).not.toBeNull();
    expect((await request(h.app).get(`/${icon![1].replace(/^\//, '')}`)).status).toBe(200);
    const eraseForm = page.text.slice(page.text.indexOf('id="erase-form"'), page.text.indexOf('</form>', page.text.indexOf('id="erase-form"')));
    expect(eraseForm).toContain('autocomplete="username"');
  });
});
