// T011 — SQLite repositories and unit of work against a real (in-memory) database.
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Repositories } from '../../src/application/ports.ts';
import { DomainError } from '../../src/domain/errors.ts';
import type { Booking, Room, User } from '../../src/domain/types.ts';
import { openDatabase } from '../../src/infrastructure/sqlite/database.ts';
import { createSqliteRepositories } from '../../src/infrastructure/sqlite/repositories.ts';
import { SqliteUnitOfWork } from '../../src/infrastructure/sqlite/unit-of-work.ts';

const H = 3_600_000;
const NOW = Date.parse('2026-11-02T06:00:00.000Z');

let db: DatabaseSync;
let repos: Repositories;
beforeEach(() => {
  db = openDatabase(':memory:');
  repos = createSqliteRepositories(db);
});
afterEach(() => db.close());

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function user(over: Partial<User> = {}): User {
  const id = over.id ?? uuid();
  return { id, email: `${id.slice(-4)}@uni.example`, displayName: `User ${id.slice(-4)}`, role: 'student', createdAt: NOW, ...over };
}
function room(over: Partial<Room> = {}): Room {
  const id = over.id ?? uuid();
  return { id, name: `Room ${id.slice(-4)}`, building: 'Main', capacity: 6, equipment: ['whiteboard'], inService: true, createdAt: NOW, updatedAt: NOW, ...over };
}
function booking(roomId: string, userId: string | null, start: number, end: number, over: Partial<Booking> = {}): Booking {
  return {
    id: uuid(), roomId, userId, start, end, partySize: 2, purpose: null, status: 'confirmed',
    cancelledAt: null, cancelledBy: null, cancelReason: null, createdAt: NOW, ...over,
  };
}
const expectDomainError = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected DomainError ${code}`);
};

describe('UserRepository', () => {
  it('stores and finds users; the hash is only available through the credential lookups', () => {
    const u = user({ email: 'alice@uni.example' });
    repos.users.insert(u, 'scrypt$hash');
    expect(repos.users.findById(u.id)).toEqual(u);
    expect(repos.users.findByEmail('ALICE@uni.example')).toEqual(u);
    expect(repos.users.findCredentialsByEmail('alice@uni.example')).toEqual({ user: u, passwordHash: 'scrypt$hash' });
    expect(repos.users.findPasswordHash(u.id)).toBe('scrypt$hash');
    expect(repos.users.findById('missing')).toBeNull();
    expect(repos.users.findByEmail('bob@uni.example')).toBeNull();
    expect(repos.users.findCredentialsByEmail('bob@uni.example')).toBeNull();
    expect(repos.users.findPasswordHash('missing')).toBeNull();
  });

  it('maps a duplicate email to EMAIL_TAKEN', () => {
    repos.users.insert(user({ email: 'alice@uni.example' }), 'h');
    expectDomainError(() => repos.users.insert(user({ email: 'Alice@uni.example' }), 'h'), 'EMAIL_TAKEN');
  });

  it('updates roles and counts users per role', () => {
    const a = user();
    const b = user();
    repos.users.insert(a, 'h');
    repos.users.insert(b, 'h');
    repos.users.updateRole(b.id, 'admin');
    expect(repos.users.findById(b.id)?.role).toBe('admin');
    expect(repos.users.countByRole('admin')).toBe(1);
    expect(repos.users.countByRole('student')).toBe(1);
  });

  it('searches by email fragment case-insensitively, treating % and _ literally', () => {
    repos.users.insert(user({ email: 'carol@uni.example' }), 'h');
    repos.users.insert(user({ email: 'caroline@uni.example' }), 'h');
    repos.users.insert(user({ email: 'dave@uni.example' }), 'h');
    expect(repos.users.searchByEmail('CAROL', 100).map((u) => u.email)).toEqual(['carol@uni.example', 'caroline@uni.example']);
    expect(repos.users.searchByEmail('carol', 1)).toHaveLength(1);
    expect(repos.users.searchByEmail('%', 100)).toEqual([]);
    expect(repos.users.searchByEmail('_', 100)).toEqual([]);
  });

  it('delete cascades sessions and anonymises bookings', () => {
    const u = user();
    const r = room();
    repos.users.insert(u, 'h');
    repos.rooms.insert(r);
    repos.sessions.insert({ tokenHash: 't1', userId: u.id, createdAt: NOW, expiresAt: NOW + 8 * H, revokedAt: null });
    const b = booking(r.id, u.id, NOW + 2 * H, NOW + 3 * H);
    repos.bookings.insert(b);
    repos.users.delete(u.id);
    expect(repos.users.findById(u.id)).toBeNull();
    expect(repos.sessions.findByTokenHash('t1')).toBeNull();
    expect(repos.bookings.findById(b.id)?.userId).toBeNull();
  });
});

describe('SessionRepository', () => {
  it('inserts, finds and revokes sessions (revocation keeps the first timestamp)', () => {
    const u = user();
    repos.users.insert(u, 'h');
    const s = { tokenHash: 'abc', userId: u.id, createdAt: NOW, expiresAt: NOW + 8 * H, revokedAt: null };
    repos.sessions.insert(s);
    expect(repos.sessions.findByTokenHash('abc')).toEqual(s);
    repos.sessions.revoke('abc', NOW + 1000);
    repos.sessions.revoke('abc', NOW + 2000);
    expect(repos.sessions.findByTokenHash('abc')?.revokedAt).toBe(NOW + 1000);
    expect(repos.sessions.findByTokenHash('nope')).toBeNull();
  });
});

describe('LoginFailureRepository', () => {
  it('records, counts within a window, reports the latest and clears per email hash', () => {
    const f = repos.loginFailures;
    f.record('e1', NOW - 20 * 60_000);
    f.record('e1', NOW - 10 * 60_000);
    f.record('e1', NOW - 60_000);
    f.record('e2', NOW);
    expect(f.countSince('e1', NOW - 15 * 60_000)).toBe(2);
    expect(f.lastAt('e1')).toBe(NOW - 60_000);
    expect(f.lastAt('none')).toBeNull();
    f.clear('e1');
    expect(f.countSince('e1', 0)).toBe(0);
    expect(f.countSince('e2', 0)).toBe(1);
  });
});

describe('RoomRepository', () => {
  it('inserts, finds (name case-insensitively), updates and lists rooms by name', () => {
    const a = room({ name: 'Birch', equipment: ['projector', 'whiteboard'] });
    const b = room({ name: 'aspen', equipment: [] });
    repos.rooms.insert(a);
    repos.rooms.insert(b);
    expect(repos.rooms.findById(a.id)).toEqual(a);
    expect(repos.rooms.findByName('BIRCH')).toEqual(a);
    expect(repos.rooms.findByName('Cedar')).toBeNull();
    expect(repos.rooms.findById('missing')).toBeNull();

    repos.rooms.update({ ...b, inService: false, capacity: 10, updatedAt: NOW + 1 });
    expect(repos.rooms.findById(b.id)).toMatchObject({ inService: false, capacity: 10, updatedAt: NOW + 1 });
    expect(repos.rooms.list({ includeOutOfService: false }).map((r) => r.name)).toEqual(['Birch']);
    expect(repos.rooms.list({ includeOutOfService: true }).map((r) => r.name)).toEqual(['aspen', 'Birch']);
  });

  it('maps duplicate names to ROOM_NAME_TAKEN on insert and update', () => {
    const a = room({ name: 'Juniper' });
    const b = room({ name: 'Linden' });
    repos.rooms.insert(a);
    repos.rooms.insert(b);
    expectDomainError(() => repos.rooms.insert(room({ name: 'JUNIPER' })), 'ROOM_NAME_TAKEN');
    expectDomainError(() => repos.rooms.update({ ...b, name: 'juniper' }), 'ROOM_NAME_TAKEN');
  });
});

describe('BookingRepository', () => {
  let u: User;
  let v: User;
  let r: Room;
  let r2: Room;
  beforeEach(() => {
    u = user({ displayName: 'Alice', email: 'alice@uni.example' });
    v = user();
    r = room({ name: 'Aspen' });
    r2 = room({ name: 'Birch' });
    repos.users.insert(u, 'h');
    repos.users.insert(v, 'h');
    repos.rooms.insert(r);
    repos.rooms.insert(r2);
  });

  it('inserts and finds a booking with its room name', () => {
    const b = booking(r.id, u.id, NOW + 2 * H, NOW + 3 * H, { purpose: '<script>x</script>' });
    repos.bookings.insert(b);
    expect(repos.bookings.findById(b.id)).toEqual({ ...b, roomName: 'Aspen' });
    expect(repos.bookings.findById('missing')).toBeNull();
  });

  it('maps an overlapping insert (trigger) to SLOT_UNAVAILABLE', () => {
    repos.bookings.insert(booking(r.id, u.id, NOW + 2 * H, NOW + 3 * H));
    expectDomainError(() => repos.bookings.insert(booking(r.id, v.id, NOW + 2.5 * H, NOW + 3.5 * H)), 'SLOT_UNAVAILABLE');
  });

  it('lists confirmed bookings of a room overlapping a window', () => {
    const inside = booking(r.id, u.id, NOW + 2 * H, NOW + 3 * H);
    const edge = booking(r.id, v.id, NOW + 5 * H, NOW + 6 * H);
    const cancelled = booking(r.id, u.id, NOW + 3 * H, NOW + 4 * H, { status: 'cancelled', cancelledAt: NOW, cancelledBy: 'owner' });
    const otherRoom = booking(r2.id, u.id, NOW + 2 * H, NOW + 3 * H);
    for (const b of [edge, inside, cancelled, otherRoom]) repos.bookings.insert(b);
    expect(repos.bookings.listConfirmedForRoom(r.id, NOW, NOW + 5 * H).map((b) => b.id)).toEqual([inside.id]);
    expect(repos.bookings.listConfirmedForRoom(r.id, NOW, NOW + 10 * H).map((b) => b.id)).toEqual([inside.id, edge.id]);
  });

  it('lists a user’s bookings in start order: upcoming only, or all', () => {
    const past = booking(r.id, u.id, NOW - 3 * H, NOW - 2 * H);
    const later = booking(r.id, u.id, NOW + 5 * H, NOW + 6 * H);
    const soon = booking(r2.id, u.id, NOW + 2 * H, NOW + 3 * H);
    const cancelled = booking(r.id, u.id, NOW + 3 * H, NOW + 4 * H, { status: 'cancelled', cancelledAt: NOW, cancelledBy: 'admin', cancelReason: 'Maintenance' });
    const running = booking(r2.id, u.id, NOW - H, NOW + H);
    const someoneElse = booking(r.id, v.id, NOW + 7 * H, NOW + 8 * H);
    for (const b of [later, past, soon, cancelled, running, someoneElse]) repos.bookings.insert(b);

    expect(repos.bookings.listByUser(u.id, { upcomingOnly: true, now: NOW }).map((b) => b.id)).toEqual([running.id, soon.id, later.id]);
    const all = repos.bookings.listByUser(u.id, { upcomingOnly: false, now: NOW });
    expect(all.map((b) => b.id)).toEqual([past.id, running.id, soon.id, cancelled.id, later.id]);
    expect(all.find((b) => b.id === cancelled.id)).toMatchObject({ roomName: 'Aspen', cancelledBy: 'admin', cancelReason: 'Maintenance' });
    expect(repos.bookings.countUpcomingByUser(u.id, NOW)).toBe(3);
  });

  it('lists all bookings starting in a window with booker identity (null once anonymised)', () => {
    const a = booking(r2.id, u.id, NOW + 2 * H, NOW + 3 * H);
    const b = booking(r.id, v.id, NOW + 2 * H, NOW + 3 * H, { status: 'cancelled', cancelledAt: NOW, cancelledBy: 'owner' });
    const outside = booking(r.id, u.id, NOW + 30 * H, NOW + 31 * H);
    for (const x of [a, b, outside]) repos.bookings.insert(x);
    repos.users.delete(v.id);
    const list = repos.bookings.listStartingBetween(NOW, NOW + 24 * H);
    expect(list.map((x) => [x.id, x.roomName])).toEqual([[b.id, 'Aspen'], [a.id, 'Birch']]);
    expect(list[1].booker).toEqual({ userId: u.id, displayName: 'Alice', email: 'alice@uni.example' });
    expect(list[0].booker).toBeNull();
  });

  it('cancels one confirmed booking once', () => {
    const b = booking(r.id, u.id, NOW + 2 * H, NOW + 3 * H);
    repos.bookings.insert(b);
    expect(repos.bookings.cancel(b.id, { at: NOW, by: 'owner', reason: null })).toBe(true);
    expect(repos.bookings.cancel(b.id, { at: NOW + 1, by: 'admin', reason: 'x' })).toBe(false);
    expect(repos.bookings.findById(b.id)).toMatchObject({ status: 'cancelled', cancelledAt: NOW, cancelledBy: 'owner', cancelReason: null });
  });

  it('FR-016: cancels only a room’s confirmed bookings that have not started', () => {
    const running = booking(r.id, u.id, NOW - H, NOW + H);
    const future = booking(r.id, u.id, NOW + 2 * H, NOW + 3 * H);
    const otherRoom = booking(r2.id, u.id, NOW + 2 * H, NOW + 3 * H);
    for (const b of [running, future, otherRoom]) repos.bookings.insert(b);
    const n = repos.bookings.cancelFutureForRoom(r.id, NOW, { at: NOW, by: 'system', reason: 'Room taken out of service' });
    expect(n).toBe(1);
    expect(repos.bookings.findById(future.id)).toMatchObject({ status: 'cancelled', cancelledBy: 'system', cancelReason: 'Room taken out of service' });
    expect(repos.bookings.findById(running.id)?.status).toBe('confirmed');
    expect(repos.bookings.findById(otherRoom.id)?.status).toBe('confirmed');
  });

  it('FR-019: cancels a user’s upcoming bookings and clears all their purposes', () => {
    const past = booking(r.id, u.id, NOW - 3 * H, NOW - 2 * H, { purpose: 'old' });
    const running = booking(r.id, u.id, NOW - H, NOW + H, { purpose: 'now' });
    const future = booking(r2.id, u.id, NOW + 2 * H, NOW + 3 * H, { purpose: 'next' });
    const other = booking(r2.id, v.id, NOW + 4 * H, NOW + 5 * H, { purpose: 'keep' });
    for (const b of [past, running, future, other]) repos.bookings.insert(b);
    expect(repos.bookings.cancelUpcomingForUser(u.id, NOW, { at: NOW, by: 'system', reason: 'Account deleted' })).toBe(2);
    repos.bookings.clearPurposeForUser(u.id);
    expect(repos.bookings.findById(past.id)).toMatchObject({ status: 'confirmed', purpose: null });
    expect(repos.bookings.findById(running.id)).toMatchObject({ status: 'cancelled', purpose: null, cancelReason: 'Account deleted' });
    expect(repos.bookings.findById(future.id)).toMatchObject({ status: 'cancelled', purpose: null });
    expect(repos.bookings.findById(other.id)).toMatchObject({ status: 'confirmed', purpose: 'keep' });
  });

  it('FR-021: deletes bookings that ended before a cutoff', () => {
    const old = booking(r.id, null, NOW - 400 * 24 * H, NOW - 400 * 24 * H + H);
    const recent = booking(r.id, u.id, NOW - 24 * H, NOW - 23 * H);
    repos.bookings.insert(old);
    repos.bookings.insert(recent);
    expect(repos.bookings.deleteEndedBefore(NOW - 365 * 24 * H)).toBe(1);
    expect(repos.bookings.findById(old.id)).toBeNull();
    expect(repos.bookings.findById(recent.id)).not.toBeNull();
  });
});

describe('AuditEventRepository', () => {
  it('inserts events with increasing ids and lists them newest first with paging', () => {
    const e1 = repos.auditEvents.insert({ at: NOW, actorUserId: null, action: 'auth.login.failed', targetType: null, targetId: null, details: { emailHash: 'abc' } });
    const e2 = repos.auditEvents.insert({ at: NOW + 1, actorUserId: 'u1', action: 'room.created', targetType: 'room', targetId: 'r1', details: {} });
    const e3 = repos.auditEvents.insert({ at: NOW + 2, actorUserId: 'u1', action: 'user.role_changed', targetType: 'user', targetId: 'u2', details: { from: 'student', to: 'staff' } });
    expect(e2.id).toBeGreaterThan(e1.id);
    expect(repos.auditEvents.list({ limit: 50 })).toEqual([e3, e2, e1]);
    expect(repos.auditEvents.list({ limit: 1 })).toEqual([e3]);
    expect(repos.auditEvents.list({ limit: 50, beforeId: e3.id })).toEqual([e2, e1]);
  });

  it('FR-021: deletes events recorded before a cutoff', () => {
    repos.auditEvents.insert({ at: NOW - 400 * 24 * H, actorUserId: null, action: 'auth.logout', targetType: null, targetId: null, details: {} });
    const kept = repos.auditEvents.insert({ at: NOW, actorUserId: null, action: 'auth.logout', targetType: null, targetId: null, details: {} });
    expect(repos.auditEvents.deleteBefore(NOW - 365 * 24 * H)).toBe(1);
    expect(repos.auditEvents.list({ limit: 10 })).toEqual([kept]);
  });
});

describe('SqliteUnitOfWork (BEGIN IMMEDIATE / COMMIT / ROLLBACK)', () => {
  it('commits the result of a successful callback', () => {
    const uow = new SqliteUnitOfWork(db);
    const r = room();
    expect(uow.transaction(() => { repos.rooms.insert(r); return 42; })).toBe(42);
    expect(repos.rooms.findById(r.id)).not.toBeNull();
    expect(db.isTransaction).toBe(false);
  });

  it('rolls back everything when the callback throws', () => {
    const uow = new SqliteUnitOfWork(db);
    const r = room();
    expect(() => uow.transaction(() => { repos.rooms.insert(r); throw new Error('boom'); })).toThrow('boom');
    expect(repos.rooms.findById(r.id)).toBeNull();
    expect(db.isTransaction).toBe(false);
  });

  it('nested transactions roll back only their own part', () => {
    const uow = new SqliteUnitOfWork(db);
    const outer = room();
    const inner = room();
    uow.transaction(() => {
      repos.rooms.insert(outer);
      expect(() => uow.transaction(() => { repos.rooms.insert(inner); throw new Error('inner'); })).toThrow('inner');
      const ok = room();
      uow.transaction(() => repos.rooms.insert(ok));
    });
    expect(repos.rooms.findById(outer.id)).not.toBeNull();
    expect(repos.rooms.findById(inner.id)).toBeNull();
    expect(repos.rooms.list({ includeOutOfService: true })).toHaveLength(2);
  });

  it('refuses an asynchronous callback and rolls back (NFR-006: no await inside a transaction)', () => {
    const uow = new SqliteUnitOfWork(db);
    const r = room();
    expect(() => uow.transaction(async () => { repos.rooms.insert(r); })).toThrow(/synchronous/);
    expect(repos.rooms.findById(r.id)).toBeNull();
    expect(db.isTransaction).toBe(false);
  });
});
