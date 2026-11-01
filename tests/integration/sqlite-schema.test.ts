// T010 — SQLite schema (data-model.md), foreign keys and the FR-011 overlap trigger.
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/infrastructure/sqlite/database.ts';

let db: DatabaseSync;
beforeEach(() => {
  db = openDatabase(':memory:');
});
afterEach(() => db.close());

const H = 3_600_000;
const T0 = Date.parse('2026-11-03T08:00:00.000Z');

function addUser(id = 'u1', email = `${id}@uni.example`) {
  db.prepare(
    `INSERT INTO users (id, email, display_name, role, password_hash, created_at)
     VALUES (?, ?, ?, 'student', 'scrypt$x', 0)`,
  ).run(id, email, `User ${id}`);
}
function addRoom(id = 'r1', name = `Room ${id}`) {
  db.prepare(
    `INSERT INTO rooms (id, name, building, capacity, equipment, in_service, created_at, updated_at)
     VALUES (?, ?, 'Main', 6, '[]', 1, 0, 0)`,
  ).run(id, name);
}
function addBooking(id: string, start: number, end: number, opts: { room?: string; user?: string | null; status?: string } = {}) {
  db.prepare(
    `INSERT INTO bookings (id, room_id, user_id, start_at, end_at, party_size, purpose, status, created_at)
     VALUES (?, ?, ?, ?, ?, 2, NULL, ?, 0)`,
  ).run(id, opts.room ?? 'r1', opts.user === undefined ? 'u1' : opts.user, start, end, opts.status ?? 'confirmed');
}
const count = (sql: string, ...params: (string | number)[]) =>
  (db.prepare(sql).get(...params) as { n: number }).n;

describe('tables and pragmas', () => {
  it('creates every table of the data model', () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(['audit_events', 'bookings', 'login_failures', 'rooms', 'sessions', 'users']);
  });

  it('enforces foreign keys', () => {
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    addUser();
    expect(() => addBooking('b1', T0, T0 + H, { room: 'no-such-room' })).toThrow(/FOREIGN KEY/);
  });

  it('applying the schema twice is harmless (idempotent start-up)', async () => {
    const { applySchema } = await import('../../src/infrastructure/sqlite/schema.ts');
    expect(() => applySchema(db)).not.toThrow();
  });
});

describe('uniqueness and checks', () => {
  it('email is unique case-insensitively', () => {
    addUser('u1', 'alice@uni.example');
    expect(() => addUser('u2', 'ALICE@uni.example')).toThrow(/UNIQUE/);
  });

  it('room name is unique case-insensitively', () => {
    addRoom('r1', 'Juniper');
    expect(() => addRoom('r2', 'juniper')).toThrow(/UNIQUE/);
  });

  it('rejects an unknown role, capacity outside 1–50 and end not after start', () => {
    expect(() =>
      db.prepare(`INSERT INTO users (id, email, display_name, role, password_hash, created_at) VALUES ('x', 'x@uni.example', 'X', 'root', 'h', 0)`).run(),
    ).toThrow(/CHECK/);
    expect(() =>
      db.prepare(`INSERT INTO rooms (id, name, building, capacity, equipment, in_service, created_at, updated_at) VALUES ('r9', 'Big', 'B', 51, '[]', 1, 0, 0)`).run(),
    ).toThrow(/CHECK/);
    addUser();
    addRoom();
    expect(() => addBooking('b1', T0, T0)).toThrow(/CHECK/);
  });
});

describe('cascades (FR-019)', () => {
  beforeEach(() => {
    addUser();
    addRoom();
  });

  it('deleting a user deletes their sessions', () => {
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at, revoked_at) VALUES ('h1', 'u1', 0, 1, NULL)`).run();
    db.prepare(`DELETE FROM users WHERE id = 'u1'`).run();
    expect(count('SELECT COUNT(*) AS n FROM sessions')).toBe(0);
  });

  it('deleting a user keeps their bookings with user_id = NULL', () => {
    addBooking('b1', T0, T0 + H);
    db.prepare(`DELETE FROM users WHERE id = 'u1'`).run();
    expect(db.prepare(`SELECT user_id FROM bookings WHERE id = 'b1'`).get()).toEqual({ user_id: null });
  });
});

describe('FR-011 overlap trigger (half-open intervals, confirmed bookings only)', () => {
  beforeEach(() => {
    addUser();
    addRoom('r1');
    addRoom('r2');
    addBooking('existing', T0 + 2 * H, T0 + 3 * H); // 10:00–11:00 local
  });

  it.each([
    ['partial overlap at the end', T0 + 2.5 * H, T0 + 3.5 * H],
    ['partial overlap at the start', T0 + 1.5 * H, T0 + 2.5 * H],
    ['identical interval', T0 + 2 * H, T0 + 3 * H],
    ['inside the existing booking', T0 + 2 * H, T0 + 2.5 * H],
    ['enclosing the existing booking', T0 + H, T0 + 4 * H],
  ])('rejects a confirmed booking with %s', (_label, start, end) => {
    expect(() => addBooking('new', start, end)).toThrow('BOOKING_OVERLAP');
    expect(count('SELECT COUNT(*) AS n FROM bookings')).toBe(1);
  });

  it('allows back-to-back bookings on both sides', () => {
    addBooking('after', T0 + 3 * H, T0 + 4 * H);
    addBooking('before', T0 + H, T0 + 2 * H);
    expect(count('SELECT COUNT(*) AS n FROM bookings')).toBe(3);
  });

  it('ignores cancelled bookings', () => {
    db.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = 1, cancelled_by = 'owner' WHERE id = 'existing'`).run();
    addBooking('new', T0 + 2 * H, T0 + 3 * H);
    expect(count(`SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed'`)).toBe(1);
  });

  it('only compares bookings of the same room', () => {
    addBooking('other-room', T0 + 2 * H, T0 + 3 * H, { room: 'r2' });
    expect(count('SELECT COUNT(*) AS n FROM bookings')).toBe(2);
  });

  it('still guards rows whose owner was erased (user_id NULL)', () => {
    db.prepare(`UPDATE bookings SET user_id = NULL WHERE id = 'existing'`).run();
    expect(() => addBooking('new', T0 + 2.5 * H, T0 + 3.5 * H)).toThrow('BOOKING_OVERLAP');
  });
});
