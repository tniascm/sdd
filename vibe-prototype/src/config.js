import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  return n;
}

// All times are in the server's local time zone. Set TZ (e.g. TZ=Europe/Berlin) to pin it.
export function loadConfig(overrides = {}) {
  const config = {
    port: int('PORT', 3000),
    dbPath: process.env.DB_PATH || path.join(root, 'data', 'roombook.db'),
    roomsFile: process.env.ROOMS_FILE || path.join(root, 'rooms.json'),
    // Only allow sign-ups from this email domain (e.g. "myuni.edu"). Empty = any domain.
    emailDomain: (process.env.EMAIL_DOMAIN || '').trim().toLowerCase().replace(/^@/, ''),
    openHour: int('OPEN_HOUR', 8),
    closeHour: int('CLOSE_HOUR', 22),
    slotMinutes: int('SLOT_MINUTES', 30),
    maxBookingMinutes: int('MAX_BOOKING_MINUTES', 120),
    maxActiveBookings: int('MAX_ACTIVE_BOOKINGS', 3),
    bookingWindowDays: int('BOOKING_WINDOW_DAYS', 14),
    sessionDays: int('SESSION_DAYS', 7),
    // Set SECURE_COOKIES=1 when serving over HTTPS.
    secureCookies: process.env.SECURE_COOKIES === '1',
    ...overrides,
  };

  if (config.openHour < 0 || config.closeHour > 24 || config.openHour >= config.closeHour) {
    throw new Error('OPEN_HOUR must be before CLOSE_HOUR, both within 0-24');
  }
  if (config.slotMinutes <= 0 || 60 % config.slotMinutes !== 0) {
    throw new Error('SLOT_MINUTES must divide 60 evenly (e.g. 15, 30, 60)');
  }
  if (config.maxBookingMinutes < config.slotMinutes) {
    throw new Error('MAX_BOOKING_MINUTES must be at least SLOT_MINUTES');
  }
  return config;
}
