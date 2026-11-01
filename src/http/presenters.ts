/**
 * Domain objects → contract response bodies (contracts/openapi.yaml). Each presenter emits
 * exactly the documented properties, so nothing else (e.g. password hashes, user ids of other
 * people) can leak into a response. Times become ISO 8601 UTC strings.
 */
import type { SignedInSession } from '../application/auth-service.ts';
import type { AdminBookingView, BookingView } from '../application/ports.ts';
import type { AuditEvent, Room, User } from '../domain/types.ts';

export const iso = (ms: number): string => new Date(ms).toISOString();

export function userDto(u: User) {
  return { id: u.id, email: u.email, displayName: u.displayName, role: u.role, createdAt: iso(u.createdAt) };
}

export function sessionDto(s: SignedInSession) {
  return { token: s.token, expiresAt: iso(s.expiresAt), user: userDto(s.user) };
}

export function roomDto(r: Room) {
  return { id: r.id, name: r.name, building: r.building, capacity: r.capacity, equipment: [...r.equipment], inService: r.inService };
}

export function bookingDto(b: BookingView) {
  return {
    id: b.id,
    roomId: b.roomId,
    roomName: b.roomName,
    start: iso(b.start),
    end: iso(b.end),
    partySize: b.partySize,
    purpose: b.purpose,
    status: b.status,
    cancelledAt: b.cancelledAt === null ? null : iso(b.cancelledAt),
    cancelledBy: b.cancelledBy,
    cancelReason: b.cancelReason,
    createdAt: iso(b.createdAt),
  };
}

export function adminBookingDto(b: AdminBookingView) {
  return {
    ...bookingDto(b),
    booker: b.booker && { userId: b.booker.userId, displayName: b.booker.displayName, email: b.booker.email },
  };
}

export function auditEventDto(e: AuditEvent) {
  return {
    id: e.id,
    at: iso(e.at),
    actorUserId: e.actorUserId,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    details: e.details,
  };
}

export function intervalDto(i: { start: number; end: number }) {
  return { start: iso(i.start), end: iso(i.end) };
}
