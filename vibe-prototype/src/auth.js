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
  if (config.emailDomain) {
    const domain = email.split('@')[1];
    if (domain !== config.emailDomain && !domain.endsWith(`.${config.emailDomain}`)) {
      return { error: `Please use your university email address (@${config.emailDomain}).` };
    }
  }
  if (password.length < 8 || password.length > 200) {
    return { error: 'Your password must be at least 8 characters long.' };
  }
  return { value: { name, email, password } };
}

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
      `SELECT s.csrf, s.expires_at, u.id, u.name, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(db, token);
    return null;
  }
  return { user: { id: row.id, name: row.name, email: row.email }, csrf: row.csrf };
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
