/**
 * Maps errors to the contract `Error` body (plan.md "Error Mapping"). Unknown errors become a
 * generic 500 INTERNAL — no stack traces, SQL or other internals reach the client (NFR-004).
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import { DomainError, type ErrorCode, type ErrorDetail } from '../domain/errors.ts';

export const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  PASSWORD_INCORRECT: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  ROOM_NAME_TAKEN: 409,
  SLOT_UNAVAILABLE: 409,
  LAST_ADMIN: 409,
  EMAIL_DOMAIN_NOT_ALLOWED: 422,
  PASSWORD_EQUALS_EMAIL: 422,
  IN_PAST: 422,
  NOT_ON_SLOT_BOUNDARY: 422,
  TOO_SHORT: 422,
  TOO_LONG: 422,
  OUTSIDE_OPENING_HOURS: 422,
  TOO_FAR_AHEAD: 422,
  QUOTA_REACHED: 422,
  PARTY_TOO_LARGE: 422,
  ROOM_OUT_OF_SERVICE: 422,
  ALREADY_STARTED: 422,
  ALREADY_ENDED: 422,
  ALREADY_CANCELLED: 422,
  REASON_REQUIRED: 422,
  TOO_MANY_ATTEMPTS: 429,
  RATE_LIMITED: 429,
  INTERNAL: 500,
});

export type ErrorBody = { error: { code: ErrorCode; message: string; details?: ErrorDetail[] } };

export function errorBody(code: ErrorCode, message: string, details?: ErrorDetail[]): ErrorBody {
  return { error: details && details.length > 0 ? { code, message, details } : { code, message } };
}

const INTERNAL_MESSAGE = 'An unexpected error occurred.';

/** zod issues → `[{ field, message }]`; unknown keys get one entry each (NFR-004, NFR-007). */
export function zodDetails(error: z.ZodError): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  for (const issue of error.issues) {
    const path = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) details.push({ field: [...path, key].join('.'), message: 'Unknown field.' });
    } else {
      details.push({ field: path.length > 0 ? path.join('.') : 'body', message: issue.message });
    }
  }
  return details;
}

/** Errors raised by express.json() (body-parser) carry a string `type` and a 4xx `status`. */
function bodyParserError(err: unknown): { type: string } | null {
  if (typeof err !== 'object' || err === null) return null;
  const { type, status } = err as { type?: unknown; status?: unknown };
  return typeof type === 'string' && typeof status === 'number' && status >= 400 && status < 500 ? { type } : null;
}

export function createErrorHandler(log: (err: unknown) => void = (err) => console.error(err)): ErrorRequestHandler {
  return (err, _req, res, next) => {
    if (res.headersSent) return next(err);

    if (err instanceof DomainError && err.code !== 'INTERNAL') {
      if (err.retryAfterSeconds !== undefined) {
        res.set('Retry-After', String(Math.max(1, Math.ceil(err.retryAfterSeconds))));
      }
      res.status(HTTP_STATUS[err.code]).json(errorBody(err.code, err.message, err.details));
      return;
    }

    if (err instanceof z.ZodError) {
      res.status(400).json(errorBody('VALIDATION_FAILED', 'The request is invalid.', zodDetails(err)));
      return;
    }

    const bp = bodyParserError(err);
    if (bp) {
      const message =
        bp.type === 'entity.parse.failed'
          ? 'The request body is not valid JSON.'
          : bp.type === 'entity.too.large'
            ? 'The request body must not exceed 10 kB.'
            : 'The request body could not be read.';
      res.status(400).json(errorBody('VALIDATION_FAILED', message, [{ field: 'body', message }]));
      return;
    }

    log(err);
    res.status(500).json(errorBody('INTERNAL', INTERNAL_MESSAGE));
  };
}

/** Final handler for unmatched `/api` paths: JSON 404 in the contract `Error` shape. */
export const apiNotFound: RequestHandler = (_req, _res, next) => {
  next(new DomainError('NOT_FOUND', 'The requested resource does not exist.'));
};
