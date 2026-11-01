import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
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
`;

export function openDatabase(config) {
  if (config.dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  }
  const db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  seedRooms(db, config.roomsFile);
  return db;
}

// Rooms are seeded from rooms.json the first time the database is created.
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
