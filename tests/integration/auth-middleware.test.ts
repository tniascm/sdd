// T018 — bearer session → req.actor; 401 UNAUTHENTICATED / 403 FORBIDDEN (FR-002, FR-003, NFR-003).
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Repositories } from '../../src/application/ports.ts';
import { buildContainer, type Container } from '../../src/container.ts';
import { actorOf, requireAdmin, requireAuth } from '../../src/http/auth-middleware.ts';
import { createErrorHandler } from '../../src/http/error-handler.ts';
import { CryptoTokenService } from '../../src/infrastructure/token-service.ts';

const H = 3_600_000;
const T0 = Date.parse('2026-11-02T06:00:00.000Z');
const USER_ID = '11111111-1111-4111-8111-111111111111';

let container: Container;
let repos: Repositories;
let now: number;
let app: express.Express;
const tokens = new CryptoTokenService();

function session(token: string, over: { expiresAt?: number; revokedAt?: number | null } = {}) {
  repos.sessions.insert({
    tokenHash: tokens.hash(token), userId: USER_ID, createdAt: T0,
    expiresAt: over.expiresAt ?? T0 + 8 * H, revokedAt: over.revokedAt ?? null,
  });
}

beforeEach(() => {
  now = T0;
  container = buildContainer({
    dbFile: ':memory:',
    clock: { now: () => now },
    config: {
      port: 0, dbFile: ':memory:', timeZone: 'Europe/Helsinki', opensAt: '08:00', closesAt: '22:00',
      allowedEmailDomains: ['uni.example'], rateLimitPerMinute: 1000, sessionTtlMs: 8 * H, admin: null,
    },
    hasherParams: { N: 1024, r: 8, p: 1 },
  });
  repos = container.repos;
  repos.users.insert({ id: USER_ID, email: 'alice@uni.example', displayName: 'Alice', role: 'student', createdAt: T0 }, 'scrypt$x');
  const auth = container.auth;
  app = express();
  app.get('/me', requireAuth(auth), (req, res) => {
    res.json(actorOf(req));
  });
  app.get('/admin', requireAuth(auth), requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/admin-unguarded', requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });
  app.use(createErrorHandler());
});
afterEach(() => container.close());

const get = (path: string, authorization?: string) => {
  const r = request(app).get(path);
  return authorization === undefined ? r : r.set('authorization', authorization);
};

describe('requireAuth', () => {
  it('accepts a valid session and exposes { userId, role }', async () => {
    const token = tokens.generate();
    session(token);
    const r = await get('/me', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ userId: USER_ID, role: 'student' });
    expect((await get('/me', `bearer  ${token}`)).status).toBe(200);
  });

  it.each([
    ['no header', undefined],
    ['another scheme', 'Basic YWxpY2U6cHc='],
    ['empty token', 'Bearer '],
    ['token with spaces', 'Bearer abc def'],
    ['unknown token', `Bearer ${'x'.repeat(43)}`],
    ['oversized header', `Bearer ${'a'.repeat(2000)}`],
  ])('refuses %s with 401 UNAUTHENTICATED', async (_label, header) => {
    const r = await get('/me', header);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: expect.any(String) } });
  });

  it('refuses a revoked session (FR-003)', async () => {
    const token = tokens.generate();
    session(token);
    repos.sessions.revoke(tokens.hash(token), T0 + 1);
    expect((await get('/me', `Bearer ${token}`)).status).toBe(401);
  });

  it('accepts a session until 8 h after sign-in and refuses it from then on (FR-002)', async () => {
    const token = tokens.generate();
    session(token);
    now = T0 + 8 * H - 1;
    expect((await get('/me', `Bearer ${token}`)).status).toBe(200);
    now = T0 + 8 * H;
    expect((await get('/me', `Bearer ${token}`)).status).toBe(401);
  });

  it('refuses the session once the user is deleted', async () => {
    const token = tokens.generate();
    session(token);
    repos.users.delete(USER_ID);
    expect((await get('/me', `Bearer ${token}`)).status).toBe(401);
  });
});

describe('requireAdmin', () => {
  it('refuses a non-administrator with 403 FORBIDDEN', async () => {
    const token = tokens.generate();
    session(token);
    const r = await get('/admin', `Bearer ${token}`);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });

  it('uses the current role, so a promotion applies to the next request', async () => {
    const token = tokens.generate();
    session(token);
    repos.users.updateRole(USER_ID, 'admin');
    expect((await get('/admin', `Bearer ${token}`)).status).toBe(200);
  });

  it('refuses with 401 when no actor was established', async () => {
    expect((await get('/admin-unguarded')).status).toBe(401);
  });
});
