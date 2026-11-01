/**
 * Strict zod request schemas mirroring contracts/openapi.yaml (research R6, NFR-004):
 * unknown fields are rejected; every error names its field (NFR-007).
 */
import { z } from 'zod';

const NO_CONTROL_CHARS = /^[^\p{Cc}]*$/u;

/** FR-001: "display name (1–60 characters)" — after trimming, without control characters. */
const displayName = z
  .string()
  .trim()
  .min(1, 'Display name is required.')
  .max(60, 'Display name must be at most 60 characters.')
  .regex(NO_CONTROL_CHARS, 'Display name must not contain control characters.');

export const RegisterRequest = z.strictObject({
  email: z.email('Enter a valid email address.').max(254, 'Email must be at most 254 characters.'),
  displayName,
  /** FR-001: "password (12–128 characters, not equal to the email address)" — the latter is a rule (422). */
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters.')
    .max(128, 'Password must be at most 128 characters.'),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.strictObject({
  email: z.string().min(1, 'Email is required.').max(254, 'Email must be at most 254 characters.'),
  password: z.string().min(1, 'Password is required.').max(128, 'Password must be at most 128 characters.'),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** Query integers arrive as strings: digits only, then range-checked. */
const queryInt = (field: string, min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, `${field} must be a whole number.`)
    .transform(Number)
    .pipe(z.int().min(min, `${field} must be at least ${min}.`).max(max, `${field} must be at most ${max}.`));

export const AuditEventsQuery = z.strictObject({
  limit: queryInt('limit', 1, 200).default(50),
  beforeId: queryInt('beforeId', 1, Number.MAX_SAFE_INTEGER).optional(),
});
