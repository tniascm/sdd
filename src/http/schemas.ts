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

// ------------------------------------------------------------------ rooms and bookings (US1, US4)

const EQUIPMENT_VALUES = ['whiteboard', 'projector', 'display-screen', 'video-conferencing'] as const;
const uuid = (label: string) => z.uuid(`${label} must be a valid id.`);
/** Contract `Timestamp`: ISO 8601 date-time in UTC (`…Z`). */
const timestamp = (label: string) => z.iso.datetime(`${label} must be an ISO 8601 UTC time such as 2026-11-03T08:00:00Z.`);
const isoDate = z.iso.date('date must be a calendar date in the form YYYY-MM-DD.');

const roomName = z.string().trim().min(1, 'Name is required.').max(60, 'Name must be at most 60 characters.');
const building = z.string().trim().min(1, 'Building is required.').max(60, 'Building must be at most 60 characters.');
const capacity = z.int('Capacity must be a whole number.').min(1, 'Capacity must be at least 1.').max(50, 'Capacity must be at most 50.');
const equipment = z
  .array(z.enum(EQUIPMENT_VALUES, `Equipment must be one of: ${EQUIPMENT_VALUES.join(', ')}.`))
  .refine((list) => new Set(list).size === list.length, 'Equipment must not contain duplicates.');

export const RoomIdParams = z.strictObject({ roomId: uuid('roomId') });
export const BookingIdParams = z.strictObject({ bookingId: uuid('bookingId') });
export const UserIdParams = z.strictObject({ userId: uuid('userId') });

export const RoomListQuery = z.strictObject({
  minCapacity: queryInt('minCapacity', 1, 50).optional(),
  building: z.string().min(1, 'building must not be empty.').max(60, 'building must be at most 60 characters.').optional(),
  equipment: z
    .string()
    .regex(/^[a-z-]+(,[a-z-]+)*$/, 'equipment must be a comma-separated list such as whiteboard,projector.')
    .transform((s) => s.split(','))
    .optional(),
});

export const DateQuery = z.strictObject({ date: isoDate });

export const RoomCreateRequest = z.strictObject({ name: roomName, building, capacity, equipment: equipment.default([]) });
export type RoomCreateRequest = z.infer<typeof RoomCreateRequest>;

export const RoomUpdateRequest = z
  .strictObject({ name: roomName, building, capacity, equipment }).partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Give at least one of name, building, capacity or equipment.');
export type RoomUpdateRequest = z.infer<typeof RoomUpdateRequest>;

export const BookingCreateRequest = z.strictObject({
  roomId: uuid('roomId'),
  start: timestamp('start'),
  end: timestamp('end'),
  partySize: z.int('Party size must be a whole number.').min(1, 'Party size must be at least 1.').max(50, 'Party size must be at most 50.'),
  purpose: z.string().max(100, 'Purpose must be at most 100 characters.').optional(),
});

export const BookingsMineQuery = z.strictObject({
  include: z.enum(['upcoming', 'all'], 'include must be "upcoming" or "all".').default('upcoming'),
});

/** FR-015: an administrator's reason, 1–200 characters (required for other people's bookings — a rule). */
export const CancelRequest = z.strictObject({
  reason: z.string().trim().min(1, 'Reason must not be empty.').max(200, 'Reason must be at most 200 characters.').optional(),
});

// ------------------------------------------------------------------ administration (US4)

export const RoleChangeRequest = z.strictObject({
  role: z.enum(['student', 'staff', 'admin'], 'role must be student, staff or admin.'),
});

export const AdminUsersQuery = z.strictObject({
  email: z.string().min(1, 'email must not be empty.').max(254, 'email must be at most 254 characters.').optional(),
});

// ------------------------------------------------------------------ personal data (US5)

export const EraseRequest = z.strictObject({
  password: z.string().min(1, 'Enter your password to confirm.').max(128, 'Password must be at most 128 characters.'),
});
