/**
 * FR-020: security-relevant events. Details are small structured facts; keys that would hold
 * secrets or personal data (email, password, token) are refused (Principle V, NFR-002).
 */
import type { AuditAction, AuditEvent } from '../domain/types.ts';
import type { AuditEventRepository, Clock } from './ports.ts';

export type AuditTarget = { type: string; id: string };

const FORBIDDEN_DETAIL_KEYS = new Set(['email', 'password', 'token']);

function assertNoForbiddenKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoForbiddenKeys(v, `${path}[${i}]`));
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, v] of Object.entries(value)) {
      if (FORBIDDEN_DETAIL_KEYS.has(key.toLowerCase())) {
        throw new Error(`audit details must not contain "${key}" (at ${path}.${key})`);
      }
      assertNoForbiddenKeys(v, `${path}.${key}`);
    }
  }
}

export class AuditService {
  private readonly events: AuditEventRepository;
  private readonly clock: Clock;

  constructor(events: AuditEventRepository, clock: Clock) {
    this.events = events;
    this.clock = clock;
  }

  record(
    action: AuditAction,
    actorUserId: string | null,
    target?: AuditTarget | null,
    details: Record<string, unknown> = {},
  ): AuditEvent {
    assertNoForbiddenKeys(details, 'details');
    return this.events.insert({
      at: this.clock.now(),
      actorUserId,
      action,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      details,
    });
  }

  /** Newest first (FR-020). */
  list(opts: { limit: number; beforeId?: number }): AuditEvent[] {
    return this.events.list(opts);
  }
}
