/**
 * NFR-002 / research R4: scrypt password hashes stored as `scrypt$N$r$p$salt$hash`
 * (salt and hash base64), 16-byte random salt, 64-byte key, compared in constant time.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { PasswordHasher } from '../application/ports.ts';

export type ScryptParams = { N: number; r: number; p: number };

/** OWASP Password Storage Cheat Sheet parameter set (research R4). */
export const PRODUCTION_SCRYPT_PARAMS: Readonly<ScryptParams> = Object.freeze({ N: 2 ** 15, r: 8, p: 3 });

const SALT_BYTES = 16;
const KEY_BYTES = 64;
/** The default (32 MiB) equals 128·N·r for the production parameters and would reject them. */
const MAXMEM = 64 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const INTEGER = /^[1-9]\d{0,9}$/;

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { ...params, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function parse(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, n, r, p, salt64, key64] = parts;
  if (!INTEGER.test(n) || !INTEGER.test(r) || !INTEGER.test(p)) return null;
  if (!BASE64.test(salt64) || !BASE64.test(key64)) return null;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (params.N < 2 || (params.N & (params.N - 1)) !== 0 || params.p > 16 || params.r > 32) return null;
  const salt = Buffer.from(salt64, 'base64');
  const key = Buffer.from(key64, 'base64');
  if (salt.length !== SALT_BYTES || key.length !== KEY_BYTES) return null;
  return { params, salt, key };
}

export class ScryptHasher implements PasswordHasher {
  private readonly params: ScryptParams;

  /** Tests inject cheaper parameters (research R4); production uses the defaults. */
  constructor(params: ScryptParams = PRODUCTION_SCRYPT_PARAMS) {
    this.params = { ...params };
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt, this.params);
    const { N, r, p } = this.params;
    return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parse(stored);
    if (!parsed) return false;
    try {
      const key = await derive(password, parsed.salt, parsed.params);
      return timingSafeEqual(key, parsed.key);
    } catch {
      return false;
    }
  }
}
