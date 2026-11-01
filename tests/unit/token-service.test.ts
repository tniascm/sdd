// T013 — NFR-002 / research R5: random opaque tokens, stored only as SHA-256.
import { describe, expect, it } from 'vitest';
import { CryptoTokenService } from '../../src/infrastructure/token-service.ts';
import { systemClock } from '../../src/infrastructure/system-clock.ts';

describe('CryptoTokenService', () => {
  const tokens = new CryptoTokenService();

  it('generates 256-bit base64url tokens that never repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const t = tokens.generate();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(t, 'base64url')).toHaveLength(32);
      seen.add(t);
    }
    expect(seen.size).toBe(100);
  });

  it('hashes with SHA-256 (hex)', () => {
    expect(tokens.hash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const t = tokens.generate();
    expect(tokens.hash(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.hash(t)).not.toContain(t);
  });
});

describe('systemClock', () => {
  it('returns the current epoch milliseconds', () => {
    const before = Date.now();
    const now = systemClock.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
