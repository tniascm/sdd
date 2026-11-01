import { transaction } from './db.js';
import { closureOn, closuresOn } from './rooms.js';
import { addDays, formatDuration, formatTime, isValidDate, minutesOfDay, parseTime, toDateStr } from './time.js';

export class BookingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Start minute of every bookable slot in a day, e.g. [480, 510, ...]. */
export function slotStarts(config) {
  const starts = [];
  for (let m = config.openHour * 60; m < config.closeHour * 60; m += config.slotMinutes) starts.push(m);
  return starts;
}

/** Allowed booking lengths, e.g. [30, 60, 90, 120]. */
export function durations(config) {
  const list = [];
  for (let m = config.slotMinutes; m <= config.maxBookingMinutes; m += config.slotMinutes) list.push(m);
  return list;
}

export function bookingWindow(config, now) {
  const today = toDateStr(now);
  return { today, lastDay: addDays(today, config.bookingWindowDays) };
}

/** Start of the slot that is in progress right now (it can still be booked). */
function currentSlotStart(config, now) {
  const m = minutesOfDay(now);
  return m - (m % config.slotMinutes);
}

export function listRooms(db) {
  return db.prepare('SELECT * FROM rooms ORDER BY id').all();
}

/**
 * Availability for one day: one row per slot, one cell per room.
 * Consecutive slots covered by the same booking are merged (span > 1).
 */
export function dayGrid(db, config, date, userId, now) {
  const rooms = listRooms(db);
  const starts = slotStarts(config);
  const bookings = db
    .prepare('SELECT id, room_id, user_id, start_min, end_min FROM bookings WHERE date = ?')
    .all(date);
  const { today } = bookingWindow(config, now);
  const nowMin = minutesOfDay(now);
  const closed = closuresOn(db, date);

  const columns = rooms.map((room) => {
    const closure = closed.get(room.id);
    if (closure) {
      // One tall cell covering the whole day.
      return starts.map((_, i) =>
        i === 0 ? { state: 'closed', label: closure.reason, span: starts.length } : { state: 'closed', hidden: true }
      );
    }
    const roomBookings = bookings.filter((b) => b.room_id === room.id);
    const cells = starts.map((start) => {
      const end = start + config.slotMinutes;
      const b = roomBookings.find((x) => x.start_min < end && x.end_min > start);
      if (b) {
        return {
          state: b.user_id === userId ? 'mine' : 'booked',
          bookingId: b.id,
          label: `${formatTime(b.start_min)}–${formatTime(b.end_min)}`,
          span: 1,
        };
      }
      const past = date < today || (date === today && end <= nowMin);
      return { state: past ? 'past' : 'free', start, span: 1 };
    });
    // Merge runs of the same booking into one tall cell.
    for (let i = cells.length - 1; i > 0; i--) {
      const cur = cells[i];
      const prev = cells[i - 1];
      if (cur.bookingId && cur.bookingId === prev.bookingId) {
        prev.span += cur.span;
        cur.hidden = true;
      }
    }
    return cells;
  });

  return {
    rooms,
    rows: starts.map((start, i) => ({ start, cells: columns.map((col) => col[i]) })),
  };
}

const UPCOMING = '(b.date > ? OR (b.date = ? AND b.end_min > ?))';

export function userBookings(db, userId, now) {
  const today = toDateStr(now);
  const nowMin = minutesOfDay(now);
  const base = `SELECT b.*, r.name AS room_name, r.location AS room_location
                FROM bookings b JOIN rooms r ON r.id = b.room_id
                WHERE b.user_id = ?`;
  const upcoming = db
    .prepare(`${base} AND ${UPCOMING} ORDER BY b.date, b.start_min`)
    .all(userId, today, today, nowMin);
  const past = db
    .prepare(`${base} AND NOT ${UPCOMING} ORDER BY b.date DESC, b.start_min DESC LIMIT 10`)
    .all(userId, today, today, nowMin);
  return { upcoming, past };
}

/** Validates and stores a booking. Throws BookingError with a user-facing message. */
export function createBooking(db, config, input, now) {
  const roomId = Number(input.roomId);
  const room = Number.isInteger(roomId) ? db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) : null;
  if (!room) throw new BookingError('Please choose a room.');

  const { date } = input;
  if (!isValidDate(date)) throw new BookingError('Please choose a valid date.');

  const start = parseTime(input.start);
  if (start === null || start % config.slotMinutes !== 0) {
    throw new BookingError('Please choose a valid start time.');
  }

  const duration = Number(input.duration);
  if (!Number.isInteger(duration) || duration <= 0 || duration % config.slotMinutes !== 0) {
    throw new BookingError('Please choose a valid duration.');
  }
  if (duration > config.maxBookingMinutes) {
    throw new BookingError(`Bookings can be at most ${formatDuration(config.maxBookingMinutes)} long.`);
  }

  const end = start + duration;
  if (start < config.openHour * 60 || end > config.closeHour * 60) {
    throw new BookingError(
      `Rooms can only be booked between ${formatTime(config.openHour * 60)} and ${formatTime(config.closeHour * 60)}.`
    );
  }

  const { today, lastDay } = bookingWindow(config, now);
  if (date < today || (date === today && start < currentSlotStart(config, now))) {
    throw new BookingError('That time has already passed.');
  }
  if (date > lastDay) {
    throw new BookingError(`You can book at most ${config.bookingWindowDays} days ahead.`);
  }

  return transaction(db, () => {
    const closure = closureOn(db, room.id, date);
    if (closure) {
      throw new BookingError(`${room.name} is closed on that day (${closure.reason}). Please pick another room.`, 409);
    }

    const roomClash = db
      .prepare('SELECT 1 FROM bookings WHERE room_id = ? AND date = ? AND start_min < ? AND end_min > ?')
      .get(room.id, date, end, start);
    if (roomClash) {
      throw new BookingError('Sorry, that room is already booked for part of that time.', 409);
    }

    const userClash = db
      .prepare('SELECT 1 FROM bookings WHERE user_id = ? AND date = ? AND start_min < ? AND end_min > ?')
      .get(input.userId, date, end, start);
    if (userClash) {
      throw new BookingError('You already have another booking that overlaps this time.', 409);
    }

    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM bookings b WHERE b.user_id = ? AND ${UPCOMING}`)
      .get(input.userId, today, today, minutesOfDay(now));
    if (n >= config.maxActiveBookings) {
      throw new BookingError(
        `You can hold at most ${config.maxActiveBookings} upcoming bookings. Cancel one to book another.`,
        409
      );
    }

    const result = db
      .prepare('INSERT INTO bookings (room_id, user_id, date, start_min, end_min) VALUES (?, ?, ?, ?, ?)')
      .run(room.id, input.userId, date, start, end);
    return { id: Number(result.lastInsertRowid), room, date, start, end };
  });
}

/** Cancels one of the user's own bookings that has not ended yet. Returns true on success. */
export function cancelBooking(db, userId, bookingId, now) {
  const id = Number(bookingId);
  if (!Number.isInteger(id)) return false;
  const today = toDateStr(now);
  const result = db
    .prepare(`DELETE FROM bookings AS b WHERE b.id = ? AND b.user_id = ? AND ${UPCOMING}`)
    .run(id, userId, today, today, minutesOfDay(now));
  return result.changes > 0;
}
