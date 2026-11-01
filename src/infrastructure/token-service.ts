/** Research R5 / NFR-002: opaque 256-bit session tokens; only their SHA-256 hash is stored. */
import { createHash, randomBytes } from 'node:crypto';
import type { TokenService } from '../application/ports.ts';

export class CryptoTokenService implements TokenService {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
