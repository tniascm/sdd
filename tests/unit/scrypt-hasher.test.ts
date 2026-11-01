// T012 — NFR-002: passwords stored only as salted, memory-hard hashes (research R4).
import { describe, expect, it } from 'vitest';
import { PRODUCTION_SCRYPT_PARAMS, ScryptHasher } from '../../src/infrastructure/scrypt-hasher.ts';

const FAST = { N: 1024, r: 8, p: 1 };
const PASSWORD = 'correct horse battery';

describe('ScryptHasher', () => {
  it('produces scrypt$N$r$p$salt$hash with a 16-byte salt and a 64-byte key', async () => {
    const stored = await new ScryptHasher(FAST).hash(PASSWORD);
    const parts = stored.split('$');
    expect(parts).toHaveLength(6);
    expect(parts.slice(0, 4)).toEqual(['scrypt', '1024', '8', '1']);
    expect(Buffer.from(parts[4], 'base64')).toHaveLength(16);
    expect(Buffer.from(parts[5], 'base64')).toHaveLength(64);
    expect(stored).not.toContain(PASSWORD);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hasher = new ScryptHasher(FAST);
    const stored = await hasher.hash(PASSWORD);
    expect(await hasher.verify(PASSWORD, stored)).toBe(true);
    expect(await hasher.verify('correct horse batterY', stored)).toBe(false);
    expect(await hasher.verify('', stored)).toBe(false);
  });

  it('salts every hash: the same password gives different stored values', async () => {
    const hasher = new ScryptHasher(FAST);
    const [a, b] = await Promise.all([hasher.hash(PASSWORD), hasher.hash(PASSWORD)]);
    expect(a).not.toBe(b);
  });

  it('verifies with the parameters stored in the hash, not its own', async () => {
    const stored = await new ScryptHasher({ N: 2048, r: 8, p: 2 }).hash(PASSWORD);
    expect(stored.startsWith('scrypt$2048$8$2$')).toBe(true);
    expect(await new ScryptHasher(FAST).verify(PASSWORD, stored)).toBe(true);
  });

  it('returns false (never throws) for malformed stored values', async () => {
    const hasher = new ScryptHasher(FAST);
    const good = await hasher.hash(PASSWORD);
    const [, , , , salt, key] = good.split('$');
    const malformed = [
      '',
      'plain-text-password',
      `bcrypt$1024$8$1$${salt}$${key}`,
      `scrypt$1024$8$${salt}$${key}`,
      `scrypt$abc$8$1$${salt}$${key}`,
      `scrypt$1000$8$1$${salt}$${key}`, // N not a power of two
      `scrypt$1024$8$1$${salt}$${Buffer.from('short').toString('base64')}`,
      `scrypt$1024$8$1$$${key}`,
      `scrypt$${2 ** 30}$8$1$${salt}$${key}`, // exceeds maxmem
    ];
    for (const stored of malformed) {
      expect(await hasher.verify(PASSWORD, stored), stored).toBe(false);
    }
  });

  it('uses the production parameters N = 2^15, r = 8, p = 3 by default (research R4)', async () => {
    expect(PRODUCTION_SCRYPT_PARAMS).toEqual({ N: 32768, r: 8, p: 3 });
    const hasher = new ScryptHasher();
    const stored = await hasher.hash(PASSWORD);
    expect(stored.startsWith('scrypt$32768$8$3$')).toBe(true);
    expect(await hasher.verify(PASSWORD, stored)).toBe(true);
  });
});
