/**
 * Domain error codes — mirror the `code` values of the contract `Error` schema
 * (contracts/openapi.yaml) and plan.md "Error Mapping", plus INTERNAL.
 */
export const ERROR_CODES = [
  // 400
  'VALIDATION_FAILED',
  // 401
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  // 403
  'FORBIDDEN',
  'PASSWORD_INCORRECT',
  // 404
  'NOT_FOUND',
  // 409
  'EMAIL_TAKEN',
  'ROOM_NAME_TAKEN',
  'SLOT_UNAVAILABLE',
  'LAST_ADMIN',
  // 422 — business rule violations
  'EMAIL_DOMAIN_NOT_ALLOWED',
  'PASSWORD_EQUALS_EMAIL',
  'IN_PAST',
  'NOT_ON_SLOT_BOUNDARY',
  'TOO_SHORT',
  'TOO_LONG',
  'OUTSIDE_OPENING_HOURS',
  'TOO_FAR_AHEAD',
  'QUOTA_REACHED',
  'PARTY_TOO_LARGE',
  'ROOM_OUT_OF_SERVICE',
  'ALREADY_STARTED',
  'ALREADY_ENDED',
  'ALREADY_CANCELLED',
  'REASON_REQUIRED',
  // 429
  'TOO_MANY_ATTEMPTS',
  'RATE_LIMITED',
  // 500
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** One entry of `Error.error.details` — names the field or rule that failed (NFR-007). */
export type ErrorDetail = { field: string; message: string };

export type DomainErrorOptions = {
  /** For TOO_MANY_ATTEMPTS / RATE_LIMITED: seconds until the client may retry (`Retry-After`). */
  retryAfterSeconds?: number;
};

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetail[] | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ErrorCode, message: string, details?: ErrorDetail[], options: DomainErrorOptions = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
