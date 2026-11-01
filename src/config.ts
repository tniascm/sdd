/**
 * Runtime configuration from environment variables (quickstart.md "Configuration").
 * Invalid values fail fast at start-up with a message naming the variable.
 */
import { parseLocalTime } from './domain/campus-time.ts';

export type Config = {
  port: number;
  dbFile: string;
  timeZone: string;
  /** campus-local "HH:MM" */
  opensAt: string;
  /** campus-local "HH:MM" */
  closesAt: string;
  allowedEmailDomains: string[];
  rateLimitPerMinute: number;
  sessionTtlMs: number;
  admin: { email: string; password: string; displayName: string } | null;
};

/** FR-002: a session expires 8 hours after sign-in. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
/** Default display name of the administrator created from ADMIN_EMAIL / ADMIN_PASSWORD (research R12). */
export const DEFAULT_ADMIN_DISPLAY_NAME = 'Administrator';

export const DEFAULTS = Object.freeze({
  PORT: '3000',
  DB_FILE: 'data/roombook.db',
  CAMPUS_TIME_ZONE: 'Europe/Helsinki',
  OPENING_HOURS: '08:00-22:00',
  ALLOWED_EMAIL_DOMAINS: 'uni.example',
  RATE_LIMIT_PER_MINUTE: '300',
});

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const get = (name: keyof typeof DEFAULTS) => value(env, name) ?? DEFAULTS[name];

  const port = integer('PORT', get('PORT'), 0, 65_535);
  const dbFile = get('DB_FILE');
  const timeZone = get('CAMPUS_TIME_ZONE');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new ConfigError(`CAMPUS_TIME_ZONE must be an IANA time zone, got "${timeZone}"`);
  }

  const { opensAt, closesAt } = openingHours(get('OPENING_HOURS'));

  const allowedEmailDomains = get('ALLOWED_EMAIL_DOMAINS')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d !== '');
  if (allowedEmailDomains.length === 0 || allowedEmailDomains.some((d) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d))) {
    throw new ConfigError('ALLOWED_EMAIL_DOMAINS must be a comma-separated list of domains, e.g. "uni.example"');
  }

  const rateLimitPerMinute = integer('RATE_LIMIT_PER_MINUTE', get('RATE_LIMIT_PER_MINUTE'), 1, 1_000_000);

  return {
    port,
    dbFile,
    timeZone,
    opensAt,
    closesAt,
    allowedEmailDomains,
    rateLimitPerMinute,
    sessionTtlMs: SESSION_TTL_MS,
    admin: admin(env),
  };
}

function value(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name]?.trim();
  return v === undefined || v === '' ? undefined : v;
}

function integer(name: string, raw: string, min: number, max: number): number {
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return n;
}

function openingHours(raw: string): { opensAt: string; closesAt: string } {
  const fail = () => {
    throw new ConfigError(
      `OPENING_HOURS must be "HH:MM-HH:MM" on full or half hours with opening before closing, got "${raw}"`,
    );
  };
  const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(raw);
  if (!m) return fail();
  let opens: number;
  let closes: number;
  try {
    opens = parseLocalTime(m[1]);
    closes = parseLocalTime(m[2]);
  } catch {
    return fail();
  }
  if (opens >= closes || opens % 30 !== 0 || closes % 30 !== 0) return fail();
  return { opensAt: m[1], closesAt: m[2] };
}

/** Passwords published in earlier example files; never accepted (R-4). */
const KNOWN_EXAMPLE_PASSWORDS = new Set(['replace-with-a-long-secret']);

function admin(env: NodeJS.ProcessEnv): Config['admin'] {
  const email = value(env, 'ADMIN_EMAIL')?.toLowerCase();
  const password = env.ADMIN_PASSWORD ?? '';
  if (email === undefined && password === '') return null;
  if (email === undefined || password === '') {
    throw new ConfigError('ADMIN_EMAIL and ADMIN_PASSWORD must be set together (set ADMIN_PASSWORD in .env)');
  }
  if (KNOWN_EXAMPLE_PASSWORDS.has(password)) {
    throw new ConfigError('ADMIN_PASSWORD is the example value from .env.example; choose your own password');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ConfigError('ADMIN_EMAIL must be an email address');
  }
  // FR-001 password rule applies to the configured administrator as to any account.
  if (password.length < 12 || password.length > 128 || password.toLowerCase() === email) {
    throw new ConfigError('ADMIN_PASSWORD must be 12–128 characters and not equal to ADMIN_EMAIL');
  }
  // FR-001 display-name rule: 1–60 characters after trimming, no control characters.
  const displayName = value(env, 'ADMIN_DISPLAY_NAME') ?? DEFAULT_ADMIN_DISPLAY_NAME;
  if (displayName.length > 60 || /\p{Cc}/u.test(displayName)) {
    throw new ConfigError('ADMIN_DISPLAY_NAME must be 1–60 characters without control characters');
  }
  return { email, password, displayName };
}
