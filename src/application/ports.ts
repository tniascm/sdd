/**
 * Ports (Principle III): everything the application needs from the outside world.
 * Production adapters live in src/infrastructure; tests may substitute doubles.
 *
 * Repositories are synchronous by design (research R3): a booking's check-and-insert runs
 * inside one `UnitOfWork.transaction` with no `await` in between (NFR-006).
 */
import type {
  AuditEvent,
  Booking,
  CancelledBy,
  Role,
  Room,
  Session,
  User,
} from '../domain/types.ts';

/** Source of "now" as UTC epoch milliseconds (research R7). */
export interface Clock {
  now(): number;
}

/** Salted, memory-hard password hashing (NFR-002). */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
}

/** Opaque session tokens; only `hash(token)` is ever stored (research R5). */
export interface TokenService {
  generate(): string;
  hash(token: string): string;
}

/** Runs `fn` atomically. `fn` must be synchronous — no `await` inside a transaction. */
export interface UnitOfWork {
  transaction<T>(fn: () => T): T;
}

export interface UserRepository {
  /** Throws DomainError EMAIL_TAKEN if the email (case-insensitive) already exists. */
  insert(user: User, passwordHash: string): void;
  findById(id: string): User | null;
  findByEmail(email: string): User | null;
  findCredentialsByEmail(email: string): { user: User; passwordHash: string } | null;
  findPasswordHash(id: string): string | null;
  updateRole(id: string, role: Role): void;
  countByRole(role: Role): number;
  /** Users whose email contains `fragment` (case-insensitive), ordered by email. */
  searchByEmail(fragment: string, limit: number): User[];
  /** Deletes the user; sessions cascade, bookings keep `userId = null`. */
  delete(id: string): void;
}

export interface SessionRepository {
  insert(session: Session): void;
  findByTokenHash(tokenHash: string): Session | null;
  revoke(tokenHash: string, at: number): void;
}

/** Failed sign-ins keyed by SHA-256 of the normalised email (FR-004, research R8). */
export interface LoginFailureRepository {
  record(emailHash: string, at: number): void;
  /** Number of failures with `at > since`. */
  countSince(emailHash: string, since: number): number;
  lastAt(emailHash: string): number | null;
  clear(emailHash: string): void;
}

export interface RoomRepository {
  /** Throws DomainError ROOM_NAME_TAKEN if the name (case-insensitive) already exists. */
  insert(room: Room): void;
  /** Throws DomainError ROOM_NAME_TAKEN if the new name collides with another room. */
  update(room: Room): void;
  findById(id: string): Room | null;
  /** Case-insensitive lookup by name. */
  findByName(name: string): Room | null;
  /** Rooms ordered by name; only rooms in service unless `includeOutOfService`. */
  list(opts: { includeOutOfService: boolean }): Room[];
}

/** A booking together with its room's name, as the API returns it. */
export type BookingView = Booking & { roomName: string };

/** Admin view (FR-015): the booker, or null once the account has been erased. */
export type AdminBookingView = BookingView & {
  booker: { userId: string; displayName: string; email: string } | null;
};

export type Cancellation = { at: number; by: CancelledBy; reason: string | null };

export interface BookingRepository {
  /** Throws DomainError SLOT_UNAVAILABLE if it overlaps a confirmed booking of the room (FR-011). */
  insert(booking: Booking): void;
  findById(id: string): BookingView | null;
  /** Confirmed bookings of a room that overlap [from, to), ordered by start. */
  listConfirmedForRoom(roomId: string, from: number, to: number): Booking[];
  /** A user's bookings ordered by start; with `upcomingOnly`, only confirmed ones with end > now (FR-013). */
  listByUser(userId: string, opts: { upcomingOnly: boolean; now: number }): BookingView[];
  /** All bookings (any status) starting in [from, to), ordered by start then room name (FR-015). */
  listStartingBetween(from: number, to: number): AdminBookingView[];
  /** Confirmed bookings of the user with end > now (FR-012 "upcoming"). */
  countUpcomingByUser(userId: string, now: number): number;
  /** Cancels one confirmed booking; returns false if it was not confirmed. */
  cancel(id: string, cancellation: Cancellation): boolean;
  /** Cancels a room's confirmed bookings with start > now (FR-016); returns how many. */
  cancelFutureForRoom(roomId: string, now: number, cancellation: Cancellation): number;
  /** Cancels a user's confirmed bookings with end > now (FR-019); returns how many. */
  cancelUpcomingForUser(userId: string, now: number, cancellation: Cancellation): number;
  /** Sets purpose = null on all of a user's bookings (FR-019). */
  clearPurposeForUser(userId: string): void;
  /** Deletes bookings with end < cutoff (FR-021); returns how many. */
  deleteEndedBefore(cutoff: number): number;
}

export type NewAuditEvent = Omit<AuditEvent, 'id'>;

export interface AuditEventRepository {
  insert(event: NewAuditEvent): AuditEvent;
  /** Newest first (descending id); only ids below `beforeId` when given. */
  list(opts: { limit: number; beforeId?: number }): AuditEvent[];
  /** Deletes events with at < cutoff (FR-021); returns how many. */
  deleteBefore(cutoff: number): number;
}

export type Repositories = {
  users: UserRepository;
  sessions: SessionRepository;
  loginFailures: LoginFailureRepository;
  rooms: RoomRepository;
  bookings: BookingRepository;
  auditEvents: AuditEventRepository;
};
