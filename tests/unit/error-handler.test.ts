// T016 — plan.md "Error Mapping"; NFR-004: validated input, no internal details in errors.
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DomainError, ERROR_CODES, type ErrorCode } from '../../src/domain/errors.ts';
import { apiNotFound, createErrorHandler, HTTP_STATUS } from '../../src/http/error-handler.ts';

function appThrowing(err: unknown, log = vi.fn()) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.post('/echo', (req, res) => {
    res.json(req.body);
  });
  app.get('/boom', () => {
    throw err;
  });
  app.use('/api', apiNotFound);
  app.use(createErrorHandler(log));
  return { app, log };
}

describe('DomainError → HTTP status', () => {
  it.each([
    ['VALIDATION_FAILED', 400],
    ['UNAUTHENTICATED', 401],
    ['INVALID_CREDENTIALS', 401],
    ['FORBIDDEN', 403],
    ['PASSWORD_INCORRECT', 403],
    ['NOT_FOUND', 404],
    ['EMAIL_TAKEN', 409],
    ['ROOM_NAME_TAKEN', 409],
    ['SLOT_UNAVAILABLE', 409],
    ['LAST_ADMIN', 409],
    ['EMAIL_DOMAIN_NOT_ALLOWED', 422],
    ['REASON_REQUIRED', 422],
    ['QUOTA_REACHED', 422],
    ['TOO_MANY_ATTEMPTS', 429],
    ['RATE_LIMITED', 429],
  ] as [ErrorCode, number][])('%s → %i', async (code, status) => {
    const { app } = appThrowing(new DomainError(code, `message for ${code}`));
    const r = await request(app).get('/boom');
    expect(r.status).toBe(status);
    expect(r.body).toEqual({ error: { code, message: `message for ${code}` } });
  });

  it('maps every rule code between EMAIL_DOMAIN_NOT_ALLOWED and REASON_REQUIRED to 422', () => {
    const from = ERROR_CODES.indexOf('EMAIL_DOMAIN_NOT_ALLOWED');
    const to = ERROR_CODES.indexOf('REASON_REQUIRED');
    for (const code of ERROR_CODES.slice(from, to + 1)) expect(HTTP_STATUS[code]).toBe(422);
    expect(to - from + 1).toBe(15);
  });

  it('includes field details and Retry-After when present', async () => {
    const { app } = appThrowing(
      new DomainError('TOO_MANY_ATTEMPTS', 'Too many attempts.', [{ field: 'email', message: 'locked' }], { retryAfterSeconds: 899.2 }),
    );
    const r = await request(app).get('/boom');
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('900');
    expect(r.body).toEqual({ error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts.', details: [{ field: 'email', message: 'locked' }] } });
  });
});

describe('validation errors', () => {
  const schema = z.strictObject({ email: z.string().max(5), nested: z.strictObject({ n: z.number() }).optional() });

  it('zod errors → 400 VALIDATION_FAILED naming each field, unknown fields included', async () => {
    let caught: unknown;
    try {
      schema.parse({ email: 'too long', extra: 1, nested: { n: 'x', more: true } });
    } catch (e) {
      caught = e;
    }
    const { app } = appThrowing(caught);
    const r = await request(app).get('/boom');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
    const fields = r.body.error.details.map((d: { field: string }) => d.field).sort();
    expect(fields).toEqual(['email', 'extra', 'nested.more', 'nested.n']);
    for (const d of r.body.error.details) expect(typeof d.message).toBe('string');
  });

  it('a root-level zod error names the body', async () => {
    const result = schema.safeParse(undefined);
    const { app } = appThrowing(result.error);
    const r = await request(app).get('/boom');
    expect(r.body.error.details[0].field).toBe('body');
  });

  it('malformed JSON → 400 VALIDATION_FAILED without parser internals', async () => {
    const { app, log } = appThrowing(null);
    const r = await request(app).post('/echo').set('content-type', 'application/json').send('{"email": ');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
    expect(r.text).not.toMatch(/SyntaxError|stack|at .*:\d+:\d+|node_modules/i);
    expect(log).not.toHaveBeenCalled();
  });

  it('a body larger than 10 kB → 400 VALIDATION_FAILED', async () => {
    const { app } = appThrowing(null);
    const r = await request(app).post('/echo').send({ text: 'x'.repeat(11_000) });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: 'VALIDATION_FAILED', message: 'The request body must not exceed 10 kB.' });
  });

  it('other unreadable bodies (e.g. unsupported charset) → 400 VALIDATION_FAILED', async () => {
    const { app } = appThrowing(null);
    const r = await request(app).post('/echo').set('content-type', 'application/json; charset=klingon').send('{}');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('unexpected errors', () => {
  it('→ 500 INTERNAL with a generic message; the details go to the server log only', async () => {
    const err = new Error('SQLITE_ERROR: no such table: secret_table');
    const { app, log } = appThrowing(err);
    const r = await request(app).get('/boom');
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: { code: 'INTERNAL', message: 'An unexpected error occurred.' } });
    expect(r.text).not.toContain('secret_table');
    expect(log).toHaveBeenCalledWith(err);
  });

  it('a DomainError with code INTERNAL is also reported generically', async () => {
    const { app } = appThrowing(new DomainError('INTERNAL', 'db file corrupt at /var/x'));
    const r = await request(app).get('/boom');
    expect(r.status).toBe(500);
    expect(r.body.error.message).toBe('An unexpected error occurred.');
  });
});

describe('apiNotFound', () => {
  it('answers unmatched /api paths with JSON 404 NOT_FOUND', async () => {
    const { app } = appThrowing(null);
    const r = await request(app).get('/api/v1/nope');
    expect(r.status).toBe(404);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });
});
