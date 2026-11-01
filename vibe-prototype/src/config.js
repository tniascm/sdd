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

// Express reads a numeric string as an IP address, so turn "1" into the hop count 1.
function parseTrustProxy(raw) {
  if (!raw) return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === 'true') return true;
  return raw;
}

// All times are in the server's local time zone. Set TZ (e.g. TZ=Europe/Berlin) to pin it.
export function loadConfig(overrides = {}) {
  const config = {
    port: int('PORT', 3000),
    dbPath: process.env.DB_PATH || path.join(root, 'data', 'roombook.db'),
    roomsFile: process.env.ROOMS_FILE || path.join(root, 'rooms.json'),
    // Only addresses at exactly this domain can sign up.
    emailDomain: (process.env.EMAIL_DOMAIN || 'uni.example').trim().toLowerCase().replace(/^@/, ''),
    openHour: int('OPEN_HOUR', 8),
    closeHour: int('CLOSE_HOUR', 22),
    slotMinutes: int('SLOT_MINUTES', 30),
    maxBookingMinutes: int('MAX_BOOKING_MINUTES', 120),
    maxActiveBookings: int('MAX_ACTIVE_BOOKINGS', 3),
    bookingWindowDays: int('BOOKING_WINDOW_DAYS', 14),
    sessionDays: int('SESSION_DAYS', 7),
    // Set SECURE_COOKIES=1 when serving over HTTPS.
    secureCookies: process.env.SECURE_COOKIES === '1',
    // Failed logins allowed per email within the lock window (an IP gets 4x this many).
    loginMaxAttempts: int('LOGIN_MAX_ATTEMPTS', 5),
    loginLockMinutes: int('LOGIN_LOCK_MINUTES', 15),
    // Set when running behind a reverse proxy so client IPs are read correctly,
    // e.g. TRUST_PROXY=1 (one proxy hop) or TRUST_PROXY=loopback. See Express "trust proxy".
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    ...overrides,
  };

  if (config.openHour < 0 || config.closeHour > 24 || config.openHour >= config.closeHour) {
    throw new Error('OPEN_HOUR must be before CLOSE_HOUR, both within 0-24');
  }
  if (config.slotMinutes <= 0 || 60 % config.slotMinutes !== 0) {
    throw new Error('SLOT_MINUTES must divide 60 evenly (e.g. 15, 30, 60)');
  }
  if (!config.emailDomain) throw new Error('EMAIL_DOMAIN must not be empty');
  if (config.loginMaxAttempts < 1 || config.loginLockMinutes < 1) {
    throw new Error('LOGIN_MAX_ATTEMPTS and LOGIN_LOCK_MINUTES must be at least 1');
  }
  if (config.maxBookingMinutes < config.slotMinutes) {
    throw new Error('MAX_BOOKING_MINUTES must be at least SLOT_MINUTES');
  }
  return config;
}
