import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
export const SESSION_COOKIE = 'sid';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

// Used when the email is unknown, so login takes the same time either way.
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(KEY_LENGTH * 2)}`;

export async function verifyPassword(password, stored = DUMMY_HASH) {
  const [scheme, salt, hex] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await scrypt(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function validateSignup({ name, email, password }, config) {
  name = String(name ?? '').trim();
  email = String(email ?? '').trim().toLowerCase();
  password = String(password ?? '');

  if (!name || name.length > 80) return { error: 'Please enter your name (up to 80 characters).' };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Please enter a valid email address.' };
  }
  if (email.split('@')[1] !== config.emailDomain) {
    return { error: `Please use your university email address (@${config.emailDomain}).` };
  }
  if (password.length < 8 || password.length > 200) {
    return { error: 'Your password must be at least 8 characters long.' };
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower) || lower === email || lower === email.split('@')[0]) {
    return { error: 'That password is too easy to guess. Please choose a different one.' };
  }
  return { value: { name, email, password } };
}

// Passwords attackers try first. Not exhaustive, but it stops the most obvious choices.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234',
  'qwertyui', 'qwerty123', 'qwertyuiop', '1q2w3e4r', '1qaz2wsx', 'asdfghjk', 'zxcvbnm1',
  'iloveyou', 'letmein1', 'welcome1', 'welcome123', 'sunshine', 'princess', 'football',
  'baseball', 'superman', 'trustno1', 'abc12345', 'abcd1234', 'aa123456', 'changeme',
  'student1', 'student123', 'university', 'roombook', 'studyroom', 'library1',
]);

export function createSession(db, config, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + config.sessionDays * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    csrf,
    expiresAt
  );
  return { token, maxAge: expiresAt - Date.now() };
}

export function findSession(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.csrf, s.expires_at, u.id, u.name, u.email, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(db, token);
    return null;
  }
  return {
    user: { id: row.id, name: row.name, email: row.email, isAdmin: row.is_admin === 1 },
    csrf: row.csrf,
  };
}

export function destroySession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

// --- Slowing down password guessing ---
// Each failed login is recorded with the email tried and the client IP. Once an email
// (or an IP) has too many recent failures, further attempts are refused until the
// oldest failure is older than the lock window. Unknown emails are tracked the same
// way, so the response does not reveal whether an account exists.

/** Minutes until another attempt is allowed, or 0 if the attempt may go ahead. */
export function loginLockMinutes(db, config, email, ip, nowMs) {
  const windowMs = config.loginLockMinutes * 60 * 1000;
  const since = nowMs - windowMs;
  const limits = [
    ['email', email, config.loginMaxAttempts],
    ['ip', ip, config.loginMaxAttempts * 4],
  ];
  let waitMs = 0;
  for (const [column, value, max] of limits) {
    const row = db
      .prepare(`SELECT COUNT(*) AS n, MIN(at) AS first FROM login_failures WHERE ${column} = ? AND at > ?`)
      .get(value, since);
    if (row.n >= max) waitMs = Math.max(waitMs, row.first + windowMs - nowMs);
  }
  return waitMs > 0 ? Math.max(1, Math.ceil(waitMs / 60000)) : 0;
}

export function recordLoginFailure(db, config, email, ip, nowMs) {
  db.prepare('INSERT INTO login_failures (email, ip, at) VALUES (?, ?, ?)').run(email, ip, nowMs);
  db.prepare('DELETE FROM login_failures WHERE at <= ?').run(nowMs - config.loginLockMinutes * 60 * 1000);
}

export function clearLoginFailures(db, email) {
  db.prepare('DELETE FROM login_failures WHERE email = ?').run(email);
}
