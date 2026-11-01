/**
 * NFR-010 / research R8: fixed 60-second window per client address, driven by the injected
 * Clock so tests control time. Excess requests get 429 RATE_LIMITED with `Retry-After`.
 */
import type { RequestHandler } from 'express';
import type { Clock } from '../application/ports.ts';
import { DomainError } from '../domain/errors.ts';

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Windows are kept in a Map in the order they started (insertion order). Before every hit the
 * expired ones are removed from the front, so the map only ever holds clients seen within the
 * last window (R-6); the work is amortised O(1) per request.
 */
export class FixedWindowRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(opts: { limit: number; windowMs?: number }) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs ?? 60_000;
  }

  /** Number of clients currently tracked. */
  get size(): number {
    return this.windows.size;
  }

  hit(key: string, now: number): RateLimitDecision {
    this.evictExpired(now);
    let w = this.windows.get(key);
    if (!w) {
      w = { start: now, count: 0 };
      this.windows.set(key, w);
    }
    if (w.count >= this.limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + this.windowMs - now) / 1000)) };
    }
    w.count += 1;
    return { allowed: true };
  }

  private evictExpired(now: number): void {
    for (const [key, w] of this.windows) {
      if (now < w.start + this.windowMs) break;
      this.windows.delete(key);
    }
  }
}

export function createRateLimit(opts: { clock: Clock; limitPerMinute: number }): RequestHandler {
  const limiter = new FixedWindowRateLimiter({ limit: opts.limitPerMinute, windowMs: 60_000 });
  return (req, _res, next) => {
    // The socket address: X-Forwarded-For is not trusted (Express "trust proxy" stays off).
    const decision = limiter.hit(req.ip ?? req.socket.remoteAddress ?? 'unknown', opts.clock.now());
    if (decision.allowed) return next();
    const s = decision.retryAfterSeconds;
    next(
      new DomainError('RATE_LIMITED', `Too many requests. Try again in ${s} second${s === 1 ? '' : 's'}.`, undefined, {
        retryAfterSeconds: s,
      }),
    );
  };
}
