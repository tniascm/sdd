/**
 * SQLite adapters for the repository ports. Every statement is prepared once with `?`
 * placeholders — values are always bound, never concatenated into SQL (Principle IV).
 */
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type {
  AdminBookingView,
  AuditEventRepository,
  BookingRepository,
  BookingView,
  Cancellation,
  LoginFailureRepository,
  NewAuditEvent,
  Repositories,
  RoomRepository,
  SessionRepository,
  UserRepository,
} from '../../application/ports.ts';
import { DomainError } from '../../domain/errors.ts';
import type {
  AuditAction,
  AuditEvent,
  Booking,
  BookingStatus,
  CancelledBy,
  Equipment,
  Role,
  Room,
  Session,
  User,
} from '../../domain/types.ts';

type Row = Record<string, unknown>;

function isConstraintError(err: unknown, needle: string): boolean {
  return err instanceof Error && (err as { code?: unknown }).code === 'ERR_SQLITE_ERROR' && err.message.includes(needle);
}

const changes = (result: { changes: number | bigint }) => Number(result.changes);

// ---------------------------------------------------------------- users

const USER_COLUMNS = 'id, email, display_name, role, created_at';

function toUser(row: Row): User {
  return {
    id: row.id as string,
    email: row.email as string,
    displayName: row.display_name as string,
    role: row.role as Role,
    createdAt: row.created_at as number,
  };
}

export class SqliteUserRepository implements UserRepository {
  private readonly stmts: Record<string, StatementSync>;

  constructor(db: DatabaseSync) {
    this.stmts = {
      insert: db.prepare(
        'INSERT INTO users (id, email, display_name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ),
      byId: db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`),
      byEmail: db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`),
      credentials: db.prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`),
      hash: db.prepare('SELECT password_hash FROM users WHERE id = ?'),
      updateRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
      countByRole: db.prepare('SELECT COUNT(*) AS n FROM users WHERE role = ?'),
      search: db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE instr(lower(email), lower(?)) > 0 ORDER BY email LIMIT ?`),
      delete: db.prepare('DELETE FROM users WHERE id = ?'),
    };
  }

  insert(user: User, passwordHash: string): void {
    try {
      this.stmts.insert.run(user.id, user.email, user.displayName, user.role, passwordHash, user.createdAt);
    } catch (err) {
      if (isConstraintError(err, 'UNIQUE constraint failed: users.email')) {
        throw new DomainError('EMAIL_TAKEN', 'An account with this email address already exists.', [
          { field: 'email', message: 'An account with this email address already exists.' },
        ]);
      }
      throw err;
    }
  }

  findById(id: string): User | null {
    const row = this.stmts.byId.get(id);
    return row ? toUser(row) : null;
  }

  findByEmail(email: string): User | null {
    const row = this.stmts.byEmail.get(email);
    return row ? toUser(row) : null;
  }

  findCredentialsByEmail(email: string): { user: User; passwordHash: string } | null {
    const row = this.stmts.credentials.get(email);
    return row ? { user: toUser(row), passwordHash: row.password_hash as string } : null;
  }

  findPasswordHash(id: string): string | null {
    const row = this.stmts.hash.get(id);
    return row ? (row.password_hash as string) : null;
  }

  updateRole(id: string, role: Role): void {
    this.stmts.updateRole.run(role, id);
  }

  countByRole(role: Role): number {
    return (this.stmts.countByRole.get(role) as Row).n as number;
  }

  searchByEmail(fragment: string, limit: number): User[] {
    return this.stmts.search.all(fragment, limit).map(toUser);
  }

  delete(id: string): void {
    this.stmts.delete.run(id);
  }
}

// ---------------------------------------------------------------- sessions

function toSession(row: Row): Session {
  return {
    tokenHash: row.token_hash as string,
    userId: row.user_id as string,
    createdAt: row.created_at as number,
    expiresAt: row.expires_at as number,
    revokedAt: (row.revoked_at as number | null) ?? null,
  };
}

export class SqliteSessionRepository implements SessionRepository {
  private readonly stmts: Record<string, StatementSync>;

  constructor(db: DatabaseSync) {
    this.stmts = {
      insert: db.prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?)',
      ),
      byHash: db.prepare('SELECT token_hash, user_id, created_at, expires_at, revoked_at FROM sessions WHERE token_hash = ?'),
      revoke: db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL'),
      deleteEnded: db.prepare('DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)'),
    };
  }

  insert(s: Session): void {
    this.stmts.insert.run(s.tokenHash, s.userId, s.createdAt, s.expiresAt, s.revokedAt);
  }

  findByTokenHash(tokenHash: string): Session | null {
    const row = this.stmts.byHash.get(tokenHash);
    return row ? toSession(row) : null;
  }

  revoke(tokenHash: string, at: number): void {
    this.stmts.revoke.run(at, tokenHash);
  }

  deleteEndedBefore(cutoff: number): number {
    return changes(this.stmts.deleteEnded.run(cutoff, cutoff));
  }
}

// ---------------------------------------------------------------- login failures

export class SqliteLoginFailureRepository implements LoginFailureRepository {
  private readonly stmts: Record<string, StatementSync>;

  constructor(db: DatabaseSync) {
    this.stmts = {
      insert: db.prepare('INSERT INTO login_failures (email_hash, at) VALUES (?, ?)'),
      countSince: db.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE email_hash = ? AND at > ?'),
      lastAt: db.prepare('SELECT MAX(at) AS at FROM login_failures WHERE email_hash = ?'),
      clear: db.prepare('DELETE FROM login_failures WHERE email_hash = ?'),
      deleteBefore: db.prepare('DELETE FROM login_failures WHERE at < ?'),
    };
  }

  record(emailHash: string, at: number): void {
    this.stmts.insert.run(emailHash, at);
  }

  countSince(emailHash: string, since: number): number {
    return (this.stmts.countSince.get(emailHash, since) as Row).n as number;
  }

  lastAt(emailHash: string): number | null {
    return ((this.stmts.lastAt.get(emailHash) as Row).at as number | null) ?? null;
  }

  clear(emailHash: string): void {
    this.stmts.clear.run(emailHash);
  }

  deleteBefore(cutoff: number): number {
    return changes(this.stmts.deleteBefore.run(cutoff));
  }
}

// ---------------------------------------------------------------- rooms

const ROOM_COLUMNS = 'id, name, building, capacity, equipment, in_service, created_at, updated_at';

function toRoom(row: Row): Room {
  return {
    id: row.id as string,
    name: row.name as string,
    building: row.building as string,
    capacity: row.capacity as number,
    equipment: JSON.parse(row.equipment as string) as Equipment[],
    inService: row.in_service === 1,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

function roomNameTaken(err: unknown): never {
  if (isConstraintError(err, 'UNIQUE constraint failed: rooms.name')) {
    throw new DomainError('ROOM_NAME_TAKEN', 'A room with this name already exists.', [
      { field: 'name', message: 'A room with this name already exists.' },
    ]);
  }
  throw err;
}

export class SqliteRoomRepository implements RoomRepository {
  private readonly stmts: Record<string, StatementSync>;

  constructor(db: DatabaseSync) {
    this.stmts = {
      insert: db.prepare(`INSERT INTO rooms (${ROOM_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      update: db.prepare(
        'UPDATE rooms SET name = ?, building = ?, capacity = ?, equipment = ?, in_service = ?, updated_at = ? WHERE id = ?',
      ),
      byId: db.prepare(`SELECT ${ROOM_COLUMNS} FROM rooms WHERE id = ?`),
      byName: db.prepare(`SELECT ${ROOM_COLUMNS} FROM rooms WHERE name = ?`),
      listAll: db.prepare(`SELECT ${ROOM_COLUMNS} FROM rooms ORDER BY name, id`),
      listInService: db.prepare(`SELECT ${ROOM_COLUMNS} FROM rooms WHERE in_service = 1 ORDER BY name, id`),
    };
  }

  insert(r: Room): void {
    try {
      this.stmts.insert.run(r.id, r.name, r.building, r.capacity, JSON.stringify(r.equipment), r.inService ? 1 : 0, r.createdAt, r.updatedAt);
    } catch (err) {
      roomNameTaken(err);
    }
  }

  update(r: Room): void {
    try {
      this.stmts.update.run(r.name, r.building, r.capacity, JSON.stringify(r.equipment), r.inService ? 1 : 0, r.updatedAt, r.id);
    } catch (err) {
      roomNameTaken(err);
    }
  }

  findById(id: string): Room | null {
    const row = this.stmts.byId.get(id);
    return row ? toRoom(row) : null;
  }

  findByName(name: string): Room | null {
    const row = this.stmts.byName.get(name);
    return row ? toRoom(row) : null;
  }

  list(opts: { includeOutOfService: boolean }): Room[] {
    return (opts.includeOutOfService ? this.stmts.listAll : this.stmts.listInService).all().map(toRoom);
  }
}

// ---------------------------------------------------------------- bookings

const BOOKING_COLUMNS =
  'b.id, b.room_id, b.user_id, b.start_at, b.end_at, b.party_size, b.purpose, b.status, ' +
  'b.cancelled_at, b.cancelled_by, b.cancel_reason, b.created_at';

function toBooking(row: Row): Booking {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    userId: (row.user_id as string | null) ?? null,
    start: row.start_at as number,
    end: row.end_at as number,
    partySize: row.party_size as number,
    purpose: (row.purpose as string | null) ?? null,
    status: row.status as BookingStatus,
    cancelledAt: (row.cancelled_at as number | null) ?? null,
    cancelledBy: (row.cancelled_by as CancelledBy | null) ?? null,
    cancelReason: (row.cancel_reason as string | null) ?? null,
    createdAt: row.created_at as number,
  };
}

const toBookingView = (row: Row): BookingView => ({ ...toBooking(row), roomName: row.room_name as string });

function toAdminBookingView(row: Row): AdminBookingView {
  const booker =
    row.booker_id === null
      ? null
      : { userId: row.booker_id as string, displayName: row.booker_name as string, email: row.booker_email as string };
  return { ...toBookingView(row), booker };
}

export class SqliteBookingRepository implements BookingRepository {
  private readonly stmts: Record<string, StatementSync>;

  constructor(db: DatabaseSync) {
    const view = `SELECT ${BOOKING_COLUMNS}, r.name AS room_name FROM bookings b JOIN rooms r ON r.id = b.room_id`;
    const cancelSet = "SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?";
    this.stmts = {
      insert: db.prepare(
        `INSERT INTO bookings (id, room_id, user_id, start_at, end_at, party_size, purpose, status,
           cancelled_at, cancelled_by, cancel_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      byId: db.prepare(`${view} WHERE b.id = ?`),
      confirmedForRoom: db.prepare(
        `SELECT ${BOOKING_COLUMNS} FROM bookings b
         WHERE b.room_id = ? AND b.status = 'confirmed' AND b.start_at < ? AND b.end_at > ?
         ORDER BY b.start_at`,
      ),
      byUserAll: db.prepare(`${view} WHERE b.user_id = ? ORDER BY b.start_at, b.id`),
      byUserUpcoming: db.prepare(
        `${view} WHERE b.user_id = ? AND b.status = 'confirmed' AND b.end_at > ? ORDER BY b.start_at, b.id`,
      ),
      startingBetween: db.prepare(
        `SELECT ${BOOKING_COLUMNS}, r.name AS room_name,
                u.id AS booker_id, u.display_name AS booker_name, u.email AS booker_email
         FROM bookings b JOIN rooms r ON r.id = b.room_id LEFT JOIN users u ON u.id = b.user_id
         WHERE b.start_at >= ? AND b.start_at < ?
         ORDER BY b.start_at, r.name, b.id`,
      ),
      countUpcoming: db.prepare(
        "SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND status = 'confirmed' AND end_at > ?",
      ),
      cancel: db.prepare(`UPDATE bookings ${cancelSet} WHERE id = ? AND status = 'confirmed'`),
      cancelFutureForRoom: db.prepare(
        `UPDATE bookings ${cancelSet} WHERE room_id = ? AND status = 'confirmed' AND start_at > ?`,
      ),
      cancelUpcomingForUser: db.prepare(
        `UPDATE bookings ${cancelSet} WHERE user_id = ? AND status = 'confirmed' AND end_at > ?`,
      ),
      erasePersonalText: db.prepare('UPDATE bookings SET purpose = NULL, cancel_reason = NULL WHERE user_id = ?'),
      deleteEndedBefore: db.prepare('DELETE FROM bookings WHERE end_at < ?'),
    };
  }

  insert(b: Booking): void {
    try {
      this.stmts.insert.run(
        b.id, b.roomId, b.userId, b.start, b.end, b.partySize, b.purpose, b.status,
        b.cancelledAt, b.cancelledBy, b.cancelReason, b.createdAt,
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('BOOKING_OVERLAP')) {
        throw new DomainError('SLOT_UNAVAILABLE', 'The room is already booked for part of this time.');
      }
      throw err;
    }
  }

  findById(id: string): BookingView | null {
    const row = this.stmts.byId.get(id);
    return row ? toBookingView(row) : null;
  }

  listConfirmedForRoom(roomId: string, from: number, to: number): Booking[] {
    return this.stmts.confirmedForRoom.all(roomId, to, from).map(toBooking);
  }

  listByUser(userId: string, opts: { upcomingOnly: boolean; now: number }): BookingView[] {
    const rows = opts.upcomingOnly
      ? this.stmts.byUserUpcoming.all(userId, opts.now)
      : this.stmts.byUserAll.all(userId);
    return rows.map(toBookingView);
  }

  listStartingBetween(from: number, to: number): AdminBookingView[] {
    return this.stmts.startingBetween.all(from, to).map(toAdminBookingView);
  }

  countUpcomingByUser(userId: string, now: number): number {
    return (this.stmts.countUpcoming.get(userId, now) as Row).n as number;
  }

  cancel(id: string, c: Cancellation): boolean {
    return changes(this.stmts.cancel.run(c.at, c.by, c.reason, id)) > 0;
  }

  cancelFutureForRoom(roomId: string, now: number, c: Cancellation): number {
    return changes(this.stmts.cancelFutureForRoom.run(c.at, c.by, c.reason, roomId, now));
  }

  cancelUpcomingForUser(userId: string, now: number, c: Cancellation): number {
    return changes(this.stmts.cancelUpcomingForUser.run(c.at, c.by, c.reason, userId, now));
  }

  erasePersonalTextForUser(userId: string): void {
    this.stmts.erasePersonalText.run(userId);
  }

  deleteEndedBefore(cutoff: number): number {
    return changes(this.stmts.deleteEndedBefore.run(cutoff));
  }
}

// ---------------------------------------------------------------- audit events

function toAuditEvent(row: Row): AuditEvent {
  return {
    id: row.id as number,
    at: row.at as number,
    actorUserId: (row.actor_user_id as string | null) ?? null,
    action: row.action as AuditAction,
    targetType: (row.target_type as string | null) ?? null,
    targetId: (row.target_id as string | null) ?? null,
    details: JSON.parse(row.details as string) as Record<string, unknown>,
  };
}

export class SqliteAuditEventRepository implements AuditEventRepository {
  private readonly stmts: Record<string, StatementSync>;

  constructor(db: DatabaseSync) {
    const columns = 'id, at, actor_user_id, action, target_type, target_id, details';
    this.stmts = {
      insert: db.prepare(
        'INSERT INTO audit_events (at, actor_user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      ),
      list: db.prepare(`SELECT ${columns} FROM audit_events ORDER BY id DESC LIMIT ?`),
      listBefore: db.prepare(`SELECT ${columns} FROM audit_events WHERE id < ? ORDER BY id DESC LIMIT ?`),
      deleteBefore: db.prepare('DELETE FROM audit_events WHERE at < ?'),
    };
  }

  insert(e: NewAuditEvent): AuditEvent {
    const result = this.stmts.insert.run(e.at, e.actorUserId, e.action, e.targetType, e.targetId, JSON.stringify(e.details));
    return { id: Number(result.lastInsertRowid), ...e };
  }

  list(opts: { limit: number; beforeId?: number }): AuditEvent[] {
    const rows =
      opts.beforeId === undefined
        ? this.stmts.list.all(opts.limit)
        : this.stmts.listBefore.all(opts.beforeId, opts.limit);
    return rows.map(toAuditEvent);
  }

  deleteBefore(cutoff: number): number {
    return changes(this.stmts.deleteBefore.run(cutoff));
  }
}

export function createSqliteRepositories(db: DatabaseSync): Repositories {
  return {
    users: new SqliteUserRepository(db),
    sessions: new SqliteSessionRepository(db),
    loginFailures: new SqliteLoginFailureRepository(db),
    rooms: new SqliteRoomRepository(db),
    bookings: new SqliteBookingRepository(db),
    auditEvents: new SqliteAuditEventRepository(db),
  };
}
