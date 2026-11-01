// T015 — FR-020 audit events; Principle V: no passwords, tokens or email addresses in details.
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/application/audit-service.ts';
import type { AuditEventRepository, NewAuditEvent } from '../../src/application/ports.ts';
import type { AuditEvent } from '../../src/domain/types.ts';

class InMemoryAuditEvents implements AuditEventRepository {
  events: AuditEvent[] = [];
  insert(e: NewAuditEvent): AuditEvent {
    const event = { id: this.events.length + 1, ...e };
    this.events.push(event);
    return event;
  }
  list(opts: { limit: number; beforeId?: number }): AuditEvent[] {
    return [...this.events]
      .reverse()
      .filter((e) => opts.beforeId === undefined || e.id < opts.beforeId)
      .slice(0, opts.limit);
  }
  deleteBefore(): number {
    return 0;
  }
}

const NOW = Date.parse('2026-11-02T06:00:00.000Z');
let repo: InMemoryAuditEvents;
let audit: AuditService;
beforeEach(() => {
  repo = new InMemoryAuditEvents();
  audit = new AuditService(repo, { now: () => NOW });
});

describe('AuditService.record', () => {
  it('stores action, actor, target and details with the clock time', () => {
    const e = audit.record('user.role_changed', 'admin-1', { type: 'user', id: 'u-2' }, { from: 'student', to: 'staff' });
    expect(e).toEqual({
      id: 1, at: NOW, actorUserId: 'admin-1', action: 'user.role_changed',
      targetType: 'user', targetId: 'u-2', details: { from: 'student', to: 'staff' },
    });
  });

  it('defaults to no target and empty details', () => {
    expect(audit.record('auth.logout', 'u-1')).toMatchObject({ targetType: null, targetId: null, details: {} });
    expect(audit.record('auth.login.failed', null, null, { emailHash: 'ab12' })).toMatchObject({
      actorUserId: null, details: { emailHash: 'ab12' },
    });
  });

  it.each([
    [{ email: 'alice@uni.example' }],
    [{ password: 'secret' }],
    [{ token: 'abc' }],
    [{ Email: 'x' }],
    [{ nested: { token: 'abc' } }],
    [{ list: [{ password: 'x' }] }],
  ])('refuses forbidden detail keys: %o', (details) => {
    expect(() => audit.record('auth.login.failed', null, null, details)).toThrow(/must not contain/);
    expect(repo.events).toHaveLength(0);
  });
});

describe('AuditService.list', () => {
  it('returns events newest first with paging', () => {
    audit.record('room.created', 'a', { type: 'room', id: 'r1' });
    audit.record('room.updated', 'a', { type: 'room', id: 'r1' });
    audit.record('room.out_of_service', 'a', { type: 'room', id: 'r1' });
    expect(audit.list({ limit: 2 }).map((e) => e.action)).toEqual(['room.out_of_service', 'room.updated']);
    expect(audit.list({ limit: 10, beforeId: 2 }).map((e) => e.action)).toEqual(['room.created']);
  });
});
