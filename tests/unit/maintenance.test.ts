// T050 — FR-021: delete bookings that ended more than 12 months ago and audit events older than
// 12 months; record maintenance.purged. Test doubles only (no database).
import { describe, expect, it } from 'vitest';
import { AuditService } from '../../src/application/audit-service.ts';
import { MaintenanceService, RETENTION_MS } from '../../src/application/maintenance.ts';
import type { AuditEventRepository, BookingRepository, NewAuditEvent, UnitOfWork } from '../../src/application/ports.ts';
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
  const uow: UnitOfWork = {
    transaction<T>(fn: () => T): T {
      calls.push('begin');
      const r = fn();
      calls.push('commit');
      return r;
    },
  };
  const clock = { now: () => NOW };
  const service = new MaintenanceService({ bookings, auditEvents, audit: new AuditService(auditEvents, clock), uow, clock });
  return { service, calls, events };
}

describe('MaintenanceService.purge', () => {
  it('keeps 12 months (365 days)', () => {
    expect(RETENTION_MS).toBe(365 * DAY);
  });

  it('deletes old bookings and audit events with a cutoff of now − 12 months, in one transaction', () => {
    const { service, calls } = setup();
    const result = service.purge();
    const cutoff = NOW - 365 * DAY;
    expect(result).toEqual({ cutoff, deletedBookings: 3, deletedAuditEvents: 7 });
    expect(calls).toEqual(['begin', `deleteBookings ${cutoff}`, `deleteEvents ${cutoff}`, 'insert maintenance.purged', 'commit']);
  });

  it('records maintenance.purged with the counts after deleting, so the record itself is kept', () => {
    const { service, events } = setup();
    service.purge();
    expect(events).toEqual([
      {
        id: 1, at: NOW, actorUserId: null, action: 'maintenance.purged', targetType: null, targetId: null,
        details: { deletedBookings: 3, deletedAuditEvents: 7, cutoff: '2025-11-02T06:00:00.000Z' },
      },
    ]);
  });
});
