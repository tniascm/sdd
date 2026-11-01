/**
 * FR-021 retention, run by an operator (`npm run purge`): permanently deletes bookings that
 * ended more than 12 months ago and audit events older than 12 months (data-model.md: 365 days),
 * plus sign-in failure records older than 24 hours and sessions that expired or were revoked
 * more than 24 hours ago (R-9).
 */
import type { AuditService } from './audit-service.ts';
import type {
  AuditEventRepository,
  BookingRepository,
  Clock,
  LoginFailureRepository,
  SessionRepository,
  UnitOfWork,
} from './ports.ts';

export const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
export const SHORT_RETENTION_MS = 24 * 60 * 60 * 1000;

export type MaintenanceDeps = {
  bookings: BookingRepository;
  auditEvents: AuditEventRepository;
  loginFailures: LoginFailureRepository;
  sessions: SessionRepository;
  audit: AuditService;
  uow: UnitOfWork;
  clock: Clock;
};

export type PurgeResult = {
  /** bookings and audit events before this instant are deleted */
  cutoff: number;
  deletedBookings: number;
  deletedAuditEvents: number;
  /** login failures and ended sessions before this instant are deleted */
  shortCutoff: number;
  deletedLoginFailures: number;
  deletedSessions: number;
};

export class MaintenanceService {
  private readonly deps: MaintenanceDeps;

  constructor(deps: MaintenanceDeps) {
    this.deps = deps;
  }

  purge(): PurgeResult {
    const { bookings, auditEvents, loginFailures, sessions, audit, uow, clock } = this.deps;
    const now = clock.now();
    const cutoff = now - RETENTION_MS;
    const shortCutoff = now - SHORT_RETENTION_MS;
    return uow.transaction(() => {
      const deletedBookings = bookings.deleteEndedBefore(cutoff);
      const deletedAuditEvents = auditEvents.deleteBefore(cutoff);
      const deletedLoginFailures = loginFailures.deleteBefore(shortCutoff);
      const deletedSessions = sessions.deleteEndedBefore(shortCutoff);
      audit.record('maintenance.purged', null, null, {
        deletedBookings,
        deletedAuditEvents,
        cutoff: new Date(cutoff).toISOString(),
        deletedLoginFailures,
        deletedSessions,
        shortCutoff: new Date(shortCutoff).toISOString(),
      });
      return { cutoff, deletedBookings, deletedAuditEvents, shortCutoff, deletedLoginFailures, deletedSessions };
    });
  }
}
