// Verifier (T049) — cross-cutting security requirements: NFR-002, NFR-004, NFR-005, NFR-010.
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { startHarness, PASSWORD, type Harness } from '../support/harness.ts';
import { MINUTE } from '../support/fixed-clock.ts';

let h: Harness;
afterEach(() => h?.close());

describe('NFR-005 — browser security headers', () => {
  it('API and UI responses carry a strict CSP and anti-sniffing/anti-framing headers', async () => {
    h = await startHarness();
    for (const path of ['/', '/api/v1/health']) {
      const r = await request(h.app).get(path);
      expect(r.status).toBe(200);
      const csp = r.headers['content-security-policy'];
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      const scriptSrc = csp.split(';').find((d: string) => d.trim().startsWith('script-src')) ?? '';
      expect(scriptSrc).not.toContain('unsafe-inline');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('the UI page contains no inline scripts', async () => {
    h = await startHarness();
    const r = await request(h.app).get('/');
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(r.text).not.toMatch(/\son[a-z]+\s*=/i); // no inline event handlers
  });
});

describe('NFR-004 — input validation and error hygiene', () => {
  it('malformed JSON gives a contract-shaped 400 without internal details', async () => {
    h = await startHarness();
    const r = await h.anon.send('POST', '/auth/login', '{"email": "a@uni.example", "password": ', { contentType: 'application/json' });
    expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(r.text).not.toMatch(/SyntaxError|at .*\(.*:\d+:\d+\)|node_modules|stack/i);
  });

  it('a body larger than 10 kB is refused', async () => {
    h = await startHarness();
    const r = await h.anon.post('/auth/register', { email: 'big@uni.example', displayName: 'x'.repeat(11_000), password: PASSWORD });
    expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('SQL metacharacters in parameters are treated as data', async () => {
    h = await startHarness();
    const u = await h.newUser();
    await h.createRoom({ name: 'Juniper' });
    const r = await u.api.get(`/rooms?building=${encodeURIComponent("' OR '1'='1")}`);
    expect(r.status).toBe(200);
    expect(r.body.rooms).toEqual([]);
  });

  it('unknown API paths answer with a JSON 404', async () => {
    h = await startHarness();
    const r = await h.anon.get('/does-not-exist');
    expect([r.status, r.body.error.code]).toEqual([404, 'NOT_FOUND']);
  });
});

describe('NFR-010 — request rate limit per client', () => {
  it('the 301st request within a minute is refused with Retry-After; the next minute is allowed again', async () => {
    h = await startHarness({ config: { rateLimitPerMinute: 300 } });
    // startHarness() itself sends requests (admin sign-in, GET /me) from the same client address;
    // move to a fresh one-minute window so this test counts exactly 300 of its own requests.
    // (Bug in the first version of this test, reported by the Implementer — VF-4.)
    h.clock.advance(MINUTE);
    for (let i = 0; i < 300; i++) {
      const r = await h.anon.get('/health');
      if (r.status !== 200) throw new Error(`request ${i + 1} was refused early: ${r.status}`);
    }
    const refused = await h.anon.get('/health');
    expect([refused.status, refused.body.error.code]).toEqual([429, 'RATE_LIMITED']);
    const retry = Number(refused.headers['retry-after']);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    h.clock.advance(MINUTE);
    expect((await h.anon.get('/health')).status).toBe(200);
  });
});

describe('NFR-002 — credentials at rest', () => {
  it('neither passwords nor session tokens are stored in clear text', async () => {
    h = await startHarness();
    const u = await h.newUser();
    const db = h.container.db;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    const dump = tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t.name}"`).all())).join('\n');
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain(u.token);
    expect(dump).toMatch(/scrypt\$/);
  });
});
