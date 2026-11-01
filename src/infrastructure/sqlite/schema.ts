/**
 * SQLite DDL for data-model.md. Times are INTEGER epoch milliseconds (UTC).
 * The enumerations embedded below are compile-time constants, never user input.
 */
import type { DatabaseSync } from 'node:sqlite';
import { AUDIT_ACTIONS, BOOKING_STATUSES, CANCELLED_BY, ROLES } from '../../domain/types.ts';

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(email) <= 254),
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN (${list(ROLES)})),
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS login_failures (
  id         INTEGER PRIMARY KEY,
  email_hash TEXT NOT NULL,
  at         INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS login_failures_email_at ON login_failures (email_hash, at);

CREATE TABLE IF NOT EXISTS rooms (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL COLLATE NOCASE UNIQUE,
  building   TEXT NOT NULL,
  capacity   INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 50),
  equipment  TEXT NOT NULL DEFAULT '[]',
  in_service INTEGER NOT NULL DEFAULT 1 CHECK (in_service IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS bookings (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES rooms (id),
  user_id       TEXT REFERENCES users (id) ON DELETE SET NULL,
  start_at      INTEGER NOT NULL,
  end_at        INTEGER NOT NULL,
  party_size    INTEGER NOT NULL CHECK (party_size >= 1),
  purpose       TEXT CHECK (purpose IS NULL OR length(purpose) <= 100),
  status        TEXT NOT NULL CHECK (status IN (${list(BOOKING_STATUSES)})),
  cancelled_at  INTEGER,
  cancelled_by  TEXT CHECK (cancelled_by IS NULL OR cancelled_by IN (${list(CANCELLED_BY)})),
  cancel_reason TEXT,
  created_at    INTEGER NOT NULL,
  CHECK (end_at > start_at)
) STRICT;
CREATE INDEX IF NOT EXISTS bookings_room_start ON bookings (room_id, start_at);
CREATE INDEX IF NOT EXISTS bookings_user_start ON bookings (user_id, start_at);
CREATE INDEX IF NOT EXISTS bookings_start ON bookings (start_at);

-- FR-011: second, independent guard against overlapping confirmed bookings of one room
-- (half-open intervals: a.start < b.end AND b.start < a.end, so back-to-back is allowed).
CREATE TRIGGER IF NOT EXISTS bookings_no_overlap
BEFORE INSERT ON bookings
WHEN NEW.status = 'confirmed'
BEGIN
  SELECT RAISE(ABORT, 'BOOKING_OVERLAP')
  WHERE EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.room_id = NEW.room_id
      AND b.status = 'confirmed'
      AND b.start_at < NEW.end_at
      AND NEW.start_at < b.end_at
  );
END;

CREATE TABLE IF NOT EXISTS audit_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            INTEGER NOT NULL,
  actor_user_id TEXT,
  action        TEXT NOT NULL CHECK (action IN (${list(AUDIT_ACTIONS)})),
  target_type   TEXT,
  target_id     TEXT,
  details       TEXT NOT NULL DEFAULT '{}'
) STRICT;
CREATE INDEX IF NOT EXISTS audit_events_at ON audit_events (at);
`;

export function applySchema(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
}
