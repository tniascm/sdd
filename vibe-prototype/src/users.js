// Account-level operations: admin role, notices, data export and account deletion.
import { transaction } from './db.js';
import { formatTime } from './time.js';

/** Grants or removes the admin role. Returns the user, or null if no such email. */
export function setAdmin(db, email, isAdmin) {
  const normalized = String(email ?? '').trim().toLowerCase();
  const result = db.prepare('UPDATE users SET is_admin = ? WHERE email = ?').run(isAdmin ? 1 : 0, normalized);
  if (result.changes === 0) return null;
  return db.prepare('SELECT id, name, email, is_admin FROM users WHERE email = ?').get(normalized);
}

export function listNotices(db, userId) {
  return db.prepare('SELECT id, message, created_at FROM notices WHERE user_id = ? ORDER BY id').all(userId);
}

export function dismissNotice(db, userId, noticeId) {
  db.prepare('DELETE FROM notices WHERE id = ? AND user_id = ?').run(Number(noticeId), userId);
}

// SQLite's datetime('now') is UTC without a zone marker.
const utc = (sqliteTime) => (sqliteTime ? `${sqliteTime.replace(' ', 'T')}Z` : null);

/** Everything stored about a user, for the "download my data" button. */
export function exportUserData(db, userId) {
  const user = db.prepare('SELECT name, email, is_admin, created_at FROM users WHERE id = ?').get(userId);
  if (!user) return null;

  const bookings = db
    .prepare(
      `SELECT r.name AS room, r.location, b.date, b.start_min, b.end_min, b.created_at
       FROM bookings b JOIN rooms r ON r.id = b.room_id
       WHERE b.user_id = ? ORDER BY b.date, b.start_min`
    )
    .all(userId);
  const notices = listNotices(db, userId);
  const failures = db.prepare('SELECT at, ip FROM login_failures WHERE email = ? ORDER BY at').all(user.email);
  const sessions = db.prepare('SELECT expires_at FROM sessions WHERE user_id = ? ORDER BY expires_at').all(userId);

  return {
    exported_at: new Date().toISOString(),
    account: {
      name: user.name,
      email: user.email,
      role: user.is_admin ? 'admin' : 'student',
      created_at: utc(user.created_at),
    },
    bookings: bookings.map((b) => ({
      room: b.room,
      location: b.location,
      date: b.date,
      start: formatTime(b.start_min),
      end: formatTime(b.end_min),
      booked_at: utc(b.created_at),
    })),
    notices: notices.map((n) => ({ message: n.message, created_at: utc(n.created_at) })),
    active_sessions: sessions.map((s) => ({ expires_at: new Date(s.expires_at).toISOString() })),
    recent_failed_logins: failures.map((f) => ({ at: new Date(f.at).toISOString(), ip: f.ip })),
  };
}

/** Permanently deletes a user and everything linked to them. */
export function deleteUser(db, userId) {
  transaction(db, () => {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    if (!user) return;
    db.prepare('DELETE FROM login_failures WHERE email = ?').run(user.email);
    // Sessions, bookings and notices are removed by ON DELETE CASCADE.
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
}
