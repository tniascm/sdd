// T050 — FR-021: delete bookings that ended more than 12 months ago and audit events older than
// 12 months, plus (R-9) login failures older than 24 h and sessions that ended more than 24 h ago;
// record maintenance.purged. Test doubles only (no database).
import { describe, expect, it } from 'vitest';
import { AuditService } from '../../src/application/audit-service.ts';
import { MaintenanceService, RETENTION_MS, SHORT_RETENTION_MS } from '../../src/application/maintenance.ts';
import type {
  AuditEventRepository,
  BookingRepository,
  LoginFailureRepository,
  NewAuditEvent,
  SessionRepository,
  UnitOfWork,
} from '../../src/application/ports.ts';
import type { AuditEvent } from '../../src/domain/types.ts';

const NOW = Date.parse('2026-11-02T06:00:00.000Z');
const DAY = 86_400_000;

function setup() {
  const calls: string[] = [];
  const events: AuditEvent[] = [];
  const auditEvents: AuditEventRepository = {
    insert(e: NewAuditEvent) {
      calls.push(`insert ${e.action}`);
      const event = { id: events.length + 1, ...e };
      events.push(event);
      return event;
    },
    list: () => [...events].reverse(),
    deleteBefore(cutoff: number) {
      calls.push(`deleteEvents ${cutoff}`);
      return 7;
    },
  };
  const bookings = {
    deleteEndedBefore(cutoff: number) {
      calls.push(`deleteBookings ${cutoff}`);
      return 3;
    },
  } as unknown as BookingRepository;
  const loginFailures = {
    deleteBefore(cutoff: number) {
      calls.push(`deleteFailures ${cutoff}`);
      return 2;
    },
  } as unknown as LoginFailureRepository;
  const sessions = {
    deleteEndedBefore(cutoff: number) {
      calls.push(`deleteSessions ${cutoff}`);
      return 4;
    },
  } as unknown as SessionRepository;
  const uow: UnitOfWork = {
    transaction<T>(fn: () => T): T {
      calls.push('begin');
      const r = fn();
      calls.push('commit');
      return r;
    },
  };
  const clock = { now: () => NOW };
  const service = new MaintenanceService({
    bookings, auditEvents, loginFailures, sessions, audit: new AuditService(auditEvents, clock), uow, clock,
  });
  return { service, calls, events };
}

describe('MaintenanceService.purge', () => {
  it('keeps bookings and audit events 12 months (365 days), failures and ended sessions 24 h', () => {
    expect(RETENTION_MS).toBe(365 * DAY);
    expect(SHORT_RETENTION_MS).toBe(DAY);
  });

  it('deletes everything past its retention, in one transaction', () => {
    const { service, calls } = setup();
    const result = service.purge();
    const cutoff = NOW - 365 * DAY;
    const shortCutoff = NOW - DAY;
    expect(result).toEqual({
      cutoff, deletedBookings: 3, deletedAuditEvents: 7,
      shortCutoff, deletedLoginFailures: 2, deletedSessions: 4,
    });
    expect(calls).toEqual([
      'begin', `deleteBookings ${cutoff}`, `deleteEvents ${cutoff}`,
      `deleteFailures ${shortCutoff}`, `deleteSessions ${shortCutoff}`,
      'insert maintenance.purged', 'commit',
    ]);
  });

  it('records maintenance.purged with the counts after deleting, so the record itself is kept', () => {
    const { service, events } = setup();
    service.purge();
    expect(events).toEqual([
      {
        id: 1, at: NOW, actorUserId: null, action: 'maintenance.purged', targetType: null, targetId: null,
        details: {
          deletedBookings: 3, deletedAuditEvents: 7, cutoff: '2025-11-02T06:00:00.000Z',
          deletedLoginFailures: 2, deletedSessions: 4, shortCutoff: '2026-11-01T06:00:00.000Z',
        },
      },
    ]);
  });
});
