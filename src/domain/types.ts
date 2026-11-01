/** Core domain types (data-model.md). Times are UTC epoch milliseconds. */

export const ROLES = ['student', 'staff', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** FR-007: the only equipment values a room may have. */
export const EQUIPMENT = ['whiteboard', 'projector', 'display-screen', 'video-conferencing'] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const BOOKING_STATUSES = ['confirmed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const CANCELLED_BY = ['owner', 'admin', 'system'] as const;
export type CancelledBy = (typeof CANCELLED_BY)[number];

/** FR-020: every audit action recorded by the system. */
export const AUDIT_ACTIONS = [
  'user.registered',
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.locked',
  'auth.logout',
  'user.erased',
  'user.role_changed',
  'room.created',
  'room.updated',
  'room.out_of_service',
  'room.in_service',
  'booking.cancelled_by_admin',
  'maintenance.purged',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** A university member. The password hash is deliberately not part of this type (NFR-002). */
export type User = {
  id: string;
  /** lower-cased, unique */
  email: string;
  displayName: string;
  role: Role;
  createdAt: number;
};

export type Session = {
  /** SHA-256 hex of the bearer token; the token itself is never stored. */
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
};

export type Room = {
  id: string;
  name: string;
  building: string;
  capacity: number;
  equipment: Equipment[];
  inService: boolean;
  createdAt: number;
  updatedAt: number;
};

export type Booking = {
  id: string;
  roomId: string;
  /** null once the owner's account has been erased (FR-019). */
  userId: string | null;
  start: number;
  end: number;
  partySize: number;
  purpose: string | null;
  status: BookingStatus;
  cancelledAt: number | null;
  cancelledBy: CancelledBy | null;
  cancelReason: string | null;
  createdAt: number;
};

export type AuditEvent = {
  id: number;
  at: number;
  /** pseudonymous user id only — never email, password or token */
  actorUserId: string | null;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
};

/** The authenticated caller of an operation (NFR-003). */
export type Actor = { userId: string; role: Role };

export type RoleLimits = {
  maxDurationMin: number;
  maxAheadDays: number;
  maxUpcoming: number;
};

/** FR-012 role limits. */
export const ROLE_LIMITS: Readonly<Record<Role, Readonly<RoleLimits>>> = Object.freeze({
  student: Object.freeze({ maxDurationMin: 120, maxAheadDays: 7, maxUpcoming: 3 }),
  staff: Object.freeze({ maxDurationMin: 240, maxAheadDays: 30, maxUpcoming: 10 }),
  admin: Object.freeze({ maxDurationMin: 240, maxAheadDays: 30, maxUpcoming: 10 }),
});
