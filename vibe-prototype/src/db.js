import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Schema changes are applied in order; PRAGMA user_version records how many have run,
// so existing databases are upgraded in place without losing data.
export const MIGRATIONS = [
  // 1: initial schema
  `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf       TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL UNIQUE,
    location TEXT NOT NULL DEFAULT '',
    capacity INTEGER NOT NULL DEFAULT 1,
    features TEXT NOT NULL DEFAULT ''
  );

  -- date is local YYYY-MM-DD; start_min/end_min are minutes after local midnight.
  CREATE TABLE IF NOT EXISTS bookings (
    id         INTEGER PRIMARY KEY,
    room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    start_min  INTEGER NOT NULL,
    end_min    INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (end_min > start_min)
  );

  CREATE INDEX IF NOT EXISTS bookings_room_date ON bookings(room_id, date);
  CREATE INDEX IF NOT EXISTS bookings_user_date ON bookings(user_id, date);
  `,

  // 2: admins, room closures, notices to students, failed-login tracking
  `
  ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

  -- A room is closed on every day from start_date to end_date (inclusive).
  -- end_date NULL means "until further notice".
  CREATE TABLE closures (
    id         INTEGER PRIMARY KEY,
    room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    end_date   TEXT,
    reason     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX closures_room ON closures(room_id);

  -- Messages shown to a student until they dismiss them (e.g. "your booking was cancelled").
  CREATE TABLE notices (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX notices_user ON notices(user_id);

  -- Recent failed logins, used to slow down password guessing. Old rows are pruned.
  CREATE TABLE login_failures (
    id    INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    ip    TEXT NOT NULL,
    at    INTEGER NOT NULL
  );
  CREATE INDEX login_failures_email ON login_failures(email, at);
  CREATE INDEX login_failures_ip ON login_failures(ip, at);
  `,
];

export function openDatabase(config) {
  if (config.dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  }
  const db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  seedRooms(db, config.roomsFile);
  return db;
}

export function migrate(db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let v = version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

// Rooms are seeded from rooms.json only when the database has no rooms yet.
// After that, rooms are managed on the admin page.
function seedRooms(db, roomsFile) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM rooms').get();
  if (n > 0 || !roomsFile || !fs.existsSync(roomsFile)) return;

  const rooms = JSON.parse(fs.readFileSync(roomsFile, 'utf8'));
  const insert = db.prepare(
    'INSERT INTO rooms (name, location, capacity, features) VALUES (?, ?, ?, ?)'
  );
  transaction(db, () => {
    for (const r of rooms) {
      insert.run(String(r.name), String(r.location ?? ''), Number(r.capacity) || 1, String(r.features ?? ''));
    }
  });
}

// Runs fn inside a write transaction. BEGIN IMMEDIATE takes the write lock up front,
// so check-then-insert logic cannot race with another writer.
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
