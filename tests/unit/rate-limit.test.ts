// T017 — NFR-010: 300 requests per minute per client address; excess → 429 RATE_LIMITED + Retry-After.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Clock } from '../../src/application/ports.ts';
import { createErrorHandler } from '../../src/http/error-handler.ts';
import { createRateLimit, FixedWindowRateLimiter } from '../../src/http/rate-limit.ts';

const T0 = Date.parse('2026-11-02T06:00:00.000Z');
const S = 1000;

describe('FixedWindowRateLimiter', () => {
  it('allows `limit` hits per 60-second window, then refuses with the seconds left', () => {
    const limiter = new FixedWindowRateLimiter({ limit: 3 });
    expect(limiter.hit('a', T0)).toEqual({ allowed: true });
    expect(limiter.hit('a', T0 + 10 * S)).toEqual({ allowed: true });
    expect(limiter.hit('a', T0 + 20 * S)).toEqual({ allowed: true });
    expect(limiter.hit('a', T0 + 20 * S)).toEqual({ allowed: false, retryAfterSeconds: 40 });
    expect(limiter.hit('a', T0 + 59_500)).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('starts a fresh window once the old one has passed', () => {
    const limiter = new FixedWindowRateLimiter({ limit: 1 });
    expect(limiter.hit('a', T0).allowed).toBe(true);
    expect(limiter.hit('a', T0 + 59_999).allowed).toBe(false);
    expect(limiter.hit('a', T0 + 60 * S).allowed).toBe(true);
    expect(limiter.hit('a', T0 + 61 * S).allowed).toBe(false);
  });

  it('counts each client address separately', () => {
    const limiter = new FixedWindowRateLimiter({ limit: 1 });
    expect(limiter.hit('10.0.0.1', T0).allowed).toBe(true);
    expect(limiter.hit('10.0.0.2', T0).allowed).toBe(true);
    expect(limiter.hit('10.0.0.1', T0).allowed).toBe(false);
  });

  it('forgets expired windows so memory does not grow without bound', () => {
    const limiter = new FixedWindowRateLimiter({ limit: 5 });
    for (let i = 0; i < 1000; i++) limiter.hit(`client-${i}`, T0);
    expect(limiter.size).toBe(1000);
    limiter.hit('late', T0 + 61 * S);
    expect(limiter.size).toBe(1);
  });
});

describe('createRateLimit middleware', () => {
  function app(clock: Clock, limit: number) {
    const a = express();
    a.use(createRateLimit({ clock, limitPerMinute: limit }));
    a.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });
    a.use(createErrorHandler());
    return a;
  }

  it('refuses the request after the limit with 429 RATE_LIMITED and Retry-After, allows it again after a minute', async () => {
    let now = T0;
    const clock = { now: () => now };
    const a = app(clock, 2);
    expect((await request(a).get('/ping')).status).toBe(200);
    expect((await request(a).get('/ping')).status).toBe(200);
    const refused = await request(a).get('/ping');
    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toBe('60');
    expect(refused.body).toEqual({ error: { code: 'RATE_LIMITED', message: expect.stringContaining('60 seconds') } });

    now += 45 * S;
    const later = await request(a).get('/ping');
    expect([later.status, later.headers['retry-after']]).toEqual([429, '15']);

    now += 15 * S;
    expect((await request(a).get('/ping')).status).toBe(200);
  });

  it('allows exactly the configured number of requests (300 → the 301st is refused)', async () => {
    const a = app({ now: () => T0 }, 300);
    for (let i = 1; i <= 300; i++) {
      const r = await request(a).get('/ping');
      if (r.status !== 200) throw new Error(`request ${i} refused`);
    }
    expect((await request(a).get('/ping')).status).toBe(429);
  });
});
