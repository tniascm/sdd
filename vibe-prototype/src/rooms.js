// Room management for admins: adding rooms and closing them for maintenance.
import { transaction } from './db.js';
import { formatDate, formatTime, isValidDate, minutesOfDay, toDateStr } from './time.js';

export class AdminError extends Error {}

function text(value, { label, max, required = false }) {
  const v = String(value ?? '').trim();
  if (required && !v) throw new AdminError(`Please enter ${label}.`);
  if (v.length > max) throw new AdminError(`${label[0].toUpperCase()}${label.slice(1)} must be at most ${max} characters.`);
  return v;
}

export function addRoom(db, input) {
  const name = text(input.name, { label: 'a room name', max: 80, required: true });
  const location = text(input.location, { label: 'the location', max: 120 });
  const features = text(input.features, { label: 'the features', max: 200 });
  const capacity = Number(input.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
    throw new AdminError('Seats must be a whole number between 1 and 500.');
  }
  if (db.prepare('SELECT 1 FROM rooms WHERE name = ? COLLATE NOCASE').get(name)) {
    throw new AdminError(`There is already a room called "${name}".`);
  }
  const result = db
    .prepare('INSERT INTO rooms (name, location, capacity, features) VALUES (?, ?, ?, ?)')
    .run(name, location, capacity, features);
  return Number(result.lastInsertRowid);
}

const COVERS_DATE = 'start_date <= ? AND (end_date IS NULL OR end_date >= ?)';

/** The closure (if any) that makes a room unavailable on a date. */
export function closureOn(db, roomId, date) {
  return db.prepare(`SELECT * FROM closures WHERE room_id = ? AND ${COVERS_DATE} LIMIT 1`).get(roomId, date, date);
}

/** Map of roomId -> closure for every room closed on a date. */
export function closuresOn(db, date) {
  const rows = db.prepare(`SELECT * FROM closures WHERE ${COVERS_DATE} ORDER BY start_date`).all(date, date);
  const map = new Map();
  for (const c of rows) if (!map.has(c.room_id)) map.set(c.room_id, c);
  return map;
}

/** Rooms with their current/future closures and number of upcoming bookings. */
export function adminRooms(db, now) {
  const today = toDateStr(now);
  const nowMin = minutesOfDay(now);
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY name COLLATE NOCASE').all();
  const closures = db
    .prepare('SELECT * FROM closures WHERE end_date IS NULL OR end_date >= ? ORDER BY start_date')
    .all(today);
  const counts = db
    .prepare(
      `SELECT room_id, COUNT(*) AS n FROM bookings
       WHERE date > ? OR (date = ? AND end_min > ?) GROUP BY room_id`
    )
    .all(today, today, nowMin);
  const countByRoom = new Map(counts.map((c) => [c.room_id, c.n]));

  return rooms.map((room) => {
    const roomClosures = closures.filter((c) => c.room_id === room.id);
    return {
      ...room,
      closures: roomClosures,
      closedToday: roomClosures.some((c) => c.start_date <= today),
      upcomingBookings: countByRoom.get(room.id) ?? 0,
    };
  });
}

/**
 * Closes a room from `from` to `until` (inclusive; empty = until further notice).
 * Upcoming bookings in that period are cancelled and each student gets a notice.
 */
export function closeRoom(db, input, now) {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(input.roomId));
  if (!room) throw new AdminError('That room does not exist.');

  const today = toDateStr(now);
  const from = input.from;
  if (!isValidDate(from)) throw new AdminError('Please choose the first day of the closure.');
  if (from < today) throw new AdminError('A closure cannot start in the past.');

  const until = input.until ? input.until : null;
  if (until !== null && !isValidDate(until)) throw new AdminError('Please choose a valid last day, or leave it empty.');
  if (until !== null && until < from) throw new AdminError('The last day must be on or after the first day.');

  const reason = text(input.reason, { label: 'the reason', max: 200 }) || 'Maintenance';

  return transaction(db, () => {
    db.prepare('INSERT INTO closures (room_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)').run(
      room.id,
      from,
      until,
      reason
    );

    const affected = db
      .prepare(
        `SELECT * FROM bookings
         WHERE room_id = ? AND date >= ? AND (? IS NULL OR date <= ?)
           AND (date > ? OR (date = ? AND end_min > ?))`
      )
      .all(room.id, from, until, until, today, today, minutesOfDay(now));

    const notify = db.prepare('INSERT INTO notices (user_id, message) VALUES (?, ?)');
    const remove = db.prepare('DELETE FROM bookings WHERE id = ?');
    for (const b of affected) {
      notify.run(
        b.user_id,
        `Your booking of ${room.name} on ${formatDate(b.date)}, ${formatTime(b.start_min)}–${formatTime(b.end_min)} ` +
          `was cancelled because the room is closed (${reason}). Sorry for the inconvenience.`
      );
      remove.run(b.id);
    }
    return { room, cancelled: affected.length };
  });
}

/** Removes a closure, making the room bookable again for those days. */
export function reopenClosure(db, closureId) {
  return db.prepare('DELETE FROM closures WHERE id = ?').run(Number(closureId)).changes > 0;
}
