// T019 — composition root and HTTP app: health, JSON 404, security headers, limits, admin bootstrap.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { Config } from '../../src/config.ts';
import { buildContainer, type Container } from '../../src/container.ts';
import { createApp } from '../../src/http/app.ts';

const NOW = Date.parse('2026-11-02T06:00:00.000Z');
const FAST = { N: 1024, r: 8, p: 1 };
const ADMIN = { email: 'admin@uni.example', password: 'admin-password-123', displayName: 'Facilities Admin' };

function config(over: Partial<Config> = {}): Config {
  return {
    port: 0, dbFile: ':memory:', timeZone: 'Europe/Helsinki', opensAt: '08:00', closesAt: '22:00',
    allowedEmailDomains: ['uni.example'], rateLimitPerMinute: 1000, sessionTtlMs: 8 * 3_600_000, admin: ADMIN, ...over,
  };
}

const open: Container[] = [];
function container(over: Partial<Config> = {}, dbFile = ':memory:'): Container {
  const c = buildContainer({ dbFile, clock: { now: () => NOW }, config: config(over), hasherParams: FAST });
  open.push(c);
  return c;
}
afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

describe('createApp', () => {
  it('GET /api/v1/health → 200 { status: "ok" }', async () => {
    const r = await request(createApp(container())).get('/api/v1/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('sends the research R9 CSP and anti-sniffing / anti-framing headers (NFR-005)', async () => {
    const r = await request(createApp(container())).get('/api/v1/health');
    expect(r.headers['content-security-policy']).toBe(
      "default-src 'self';script-src 'self';style-src 'self';object-src 'none';frame-ancestors 'none'",
    );
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it.each([
    ['GET', '/api/v1/does-not-exist'],
    ['POST', '/api/v1/health'],
    ['GET', '/api/v2/health'],
    ['GET', '/api'],
  ])('%s %s → JSON 404 NOT_FOUND', async (method, path) => {
    const app = createApp(container());
    const r = method === 'GET' ? await request(app).get(path) : await request(app).post(path);
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it('refuses malformed JSON and bodies over 10 kB with 400 VALIDATION_FAILED', async () => {
    const app = createApp(container());
    const bad = await request(app).post('/api/v1/health').set('content-type', 'application/json').send('{"a":');
    expect([bad.status, bad.body.error.code]).toEqual([400, 'VALIDATION_FAILED']);
    const big = await request(app).post('/api/v1/health').send({ a: 'x'.repeat(10_300) });
    expect([big.status, big.body.error.code]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('applies the configured per-client rate limit to every request (NFR-010)', async () => {
    const app = createApp(container({ rateLimitPerMinute: 2 }));
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
    const r = await request(app).get('/api/v1/health');
    expect([r.status, r.body.error.code, r.headers['retry-after']]).toEqual([429, 'RATE_LIMITED', '60']);
    expect(r.headers['content-security-policy']).toBeDefined();
  });
});

describe('buildContainer', () => {
  const adminRow = (c: Container) =>
    c.db.prepare('SELECT email, display_name, role, password_hash FROM users WHERE email = ?').get(ADMIN.email) as
      | { email: string; display_name: string; role: string; password_hash: string }
      | undefined;

  it('bootstrapAdmin creates the configured administrator with a hashed password', async () => {
    const c = container();
    await c.bootstrapAdmin();
    const row = adminRow(c);
    expect(row).toMatchObject({ email: ADMIN.email, display_name: 'Facilities Admin', role: 'admin' });
    expect(row?.password_hash).toMatch(/^scrypt\$1024\$8\$1\$/);
    expect(await c.hasher.verify(ADMIN.password, row!.password_hash)).toBe(true);
    expect(c.repos.users.findByEmail(ADMIN.email)?.createdAt).toBe(NOW);
  });

  it('bootstrapAdmin is idempotent and never changes an existing account', async () => {
    const c = container();
    await c.bootstrapAdmin();
    c.repos.users.updateRole(c.repos.users.findByEmail(ADMIN.email)!.id, 'staff');
    const before = adminRow(c);
    await c.bootstrapAdmin();
    expect(adminRow(c)).toEqual(before);
    expect((c.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(1);
  });

  it('bootstrapAdmin does nothing without an admin in the configuration', async () => {
    const c = container({ admin: null });
    await c.bootstrapAdmin();
    expect((c.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(0);
  });

  it('exposes config, clock and services; close() is idempotent', () => {
    const c = container();
    expect(c.config.timeZone).toBe('Europe/Helsinki');
    expect(c.clock.now()).toBe(NOW);
    expect(c.auth.authenticate('no-such-token')).toBeNull();
    expect(c.audit.list({ limit: 10 })).toEqual([]);
    c.close();
    expect(c.db.isOpen).toBe(false);
    expect(() => c.close()).not.toThrow();
  });

  it('creates the database file and its directory, and keeps data across restarts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'roombook-'));
    try {
      const file = join(dir, 'nested', 'roombook.db');
      const first = container({}, file);
      await first.bootstrapAdmin();
      first.close();
      expect(existsSync(file)).toBe(true);
      const second = container({}, file);
      expect(second.repos.users.findByEmail(ADMIN.email)?.role).toBe('admin');
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
