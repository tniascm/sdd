/**
 * FR-021 retention: permanently deletes bookings that ended more than 12 months ago and audit
 * events older than 12 months (data-model.md: 365 days). Run by an operator (`npm run purge`).
 */
import type { AuditService } from './audit-service.ts';
import type { AuditEventRepository, BookingRepository, Clock, UnitOfWork } from './ports.ts';

export const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

export type MaintenanceDeps = {
  bookings: BookingRepository;
  auditEvents: AuditEventRepository;
  audit: AuditService;
  uow: UnitOfWork;
  clock: Clock;
};

export type PurgeResult = { cutoff: number; deletedBookings: number; deletedAuditEvents: number };

export class MaintenanceService {
  private readonly deps: MaintenanceDeps;

  constructor(deps: MaintenanceDeps) {
    this.deps = deps;
  }

  purge(): PurgeResult {
    const { bookings, auditEvents, audit, uow, clock } = this.deps;
    const cutoff = clock.now() - RETENTION_MS;
    return uow.transaction(() => {
      const deletedBookings = bookings.deleteEndedBefore(cutoff);
      const deletedAuditEvents = auditEvents.deleteBefore(cutoff);
      audit.record('maintenance.purged', null, null, {
        deletedBookings,
        deletedAuditEvents,
        cutoff: new Date(cutoff).toISOString(),
      });
      return { cutoff, deletedBookings, deletedAuditEvents };
    });
  }
}
