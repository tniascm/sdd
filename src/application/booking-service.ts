/** Bookings: FR-009 … FR-015. */
import { randomUUID } from 'node:crypto';
import { checkBookingRules } from '../domain/booking-rules.ts';
import { localToUtc, nextLocalDate, parseLocalDate } from '../domain/campus-time.ts';
import { DomainError } from '../domain/errors.ts';
import type { Actor, Booking } from '../domain/types.ts';
import type { AuditService } from './audit-service.ts';
import type { AdminBookingView, BookingRepository, BookingView, Clock, RoomRepository, UnitOfWork } from './ports.ts';

export type BookingServiceDeps = {
  rooms: RoomRepository;
  bookings: BookingRepository;
  uow: UnitOfWork;
  audit: AuditService;
  clock: Clock;
  config: { timeZone: string; opensAt: string; closesAt: string };
};

export type BookingInput = { roomId: string; start: number; end: number; partySize: number; purpose?: string };

export class BookingService {
  private readonly deps: BookingServiceDeps;

  constructor(deps: BookingServiceDeps) {
    this.deps = deps;
  }

  /**
   * FR-009 … FR-012. The whole check-and-insert runs in one synchronous transaction with no
   * `await` inside, so concurrent requests for one slot yield exactly one booking (NFR-006);
   * the database trigger is a second guard (FR-011).
   */
  create(actor: Actor, input: BookingInput): BookingView {
    const { rooms, bookings, uow, clock, config } = this.deps;
    return uow.transaction(() => {
      const now = clock.now();
      const room = rooms.findById(input.roomId);
      if (!room) throw new DomainError('NOT_FOUND', 'Room not found.', [{ field: 'roomId', message: 'Room not found.' }]);
      if (!room.inService) {
        const message = 'This room is out of service and cannot be booked.';
        throw new DomainError('ROOM_OUT_OF_SERVICE', message, [{ field: 'roomId', message }]);
      }

      const violation = checkBookingRules(input, {
        now,
        role: actor.role,
        roomCapacity: room.capacity,
        upcomingCount: bookings.countUpcomingByUser(actor.userId, now),
        timeZone: config.timeZone,
        opensAt: config.opensAt,
        closesAt: config.closesAt,
      });
      if (violation) {
        throw new DomainError(violation.code, violation.message, violation.field ? [{ field: violation.field, message: violation.message }] : undefined);
      }

      if (bookings.listConfirmedForRoom(room.id, input.start, input.end).length > 0) throw slotUnavailable();

      const booking: Booking = {
        id: randomUUID(),
        roomId: room.id,
        userId: actor.userId,
        start: input.start,
        end: input.end,
        partySize: input.partySize,
        purpose: input.purpose ?? null,
        status: 'confirmed',
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        createdAt: now,
      };
      bookings.insert(booking); // BOOKING_OVERLAP from the trigger becomes SLOT_UNAVAILABLE
      return { ...booking, roomName: room.name };
    });
  }

  /**
   * FR-014: owners cancel their own booking before it starts. Someone else's booking is
   * answered exactly like a missing one (NFR-003).
   */
  cancel(actor: Actor, bookingId: string): BookingView {
    const { bookings, uow, clock } = this.deps;
    return uow.transaction(() => {
      const now = clock.now();
      const booking = bookings.findById(bookingId);
      if (!booking || booking.userId !== actor.userId) throw bookingNotFound();
      if (booking.status === 'cancelled') throw alreadyCancelled();
      if (booking.start <= now) {
        throw new DomainError('ALREADY_STARTED', 'This booking has already started and can no longer be cancelled.');
      }
      bookings.cancel(booking.id, { at: now, by: 'owner', reason: null });
      return bookings.findById(booking.id) as BookingView;
    });
  }

  /**
   * FR-015: administrators cancel any booking that has not ended. For someone else's booking
   * a reason (1–200 characters) is required and shown to the owner; an administrator's own
   * booking is an owner cancellation and needs none. Every such cancellation is audited (FR-020).
   */
  adminCancel(actor: Actor, bookingId: string, reason: string | undefined): BookingView {
    const { bookings, uow, clock, audit } = this.deps;
    return uow.transaction(() => {
      const now = clock.now();
      const booking = bookings.findById(bookingId);
      if (!booking) throw bookingNotFound();
      if (booking.status === 'cancelled') throw alreadyCancelled();
      if (booking.end <= now) throw new DomainError('ALREADY_ENDED', 'This booking has already ended and can no longer be cancelled.');
      const own = booking.userId === actor.userId;
      if (!own && !reason) {
        const message = 'Give a reason (1–200 characters); it is shown to the person who booked.';
        throw new DomainError('REASON_REQUIRED', message, [{ field: 'reason', message }]);
      }
      bookings.cancel(booking.id, own ? { at: now, by: 'owner', reason: null } : { at: now, by: 'admin', reason: reason ?? null });
      audit.record('booking.cancelled_by_admin', actor.userId, { type: 'booking', id: booking.id }, { roomId: booking.roomId, own });
      return bookings.findById(booking.id) as BookingView;
    });
  }

  /** FR-015: every booking (any status) starting on a campus-local date, with its booker. */
  listForDate(date: string): { date: string; timeZone: string; bookings: AdminBookingView[] } {
    const { bookings, config } = this.deps;
    parseLocalDate(date);
    const from = localToUtc(date, '00:00', config.timeZone);
    const to = localToUtc(nextLocalDate(date), '00:00', config.timeZone);
    return { date, timeZone: config.timeZone, bookings: bookings.listStartingBetween(from, to) };
  }

  /** FR-013: own bookings in start order; by default only upcoming ones. */
  listMine(actor: Actor, include: 'upcoming' | 'all' = 'upcoming'): BookingView[] {
    return this.deps.bookings.listByUser(actor.userId, { upcomingOnly: include === 'upcoming', now: this.deps.clock.now() });
  }
}

const bookingNotFound = () => new DomainError('NOT_FOUND', 'Booking not found.');
const alreadyCancelled = () => new DomainError('ALREADY_CANCELLED', 'This booking has already been cancelled.');

function slotUnavailable(): DomainError {
  return new DomainError('SLOT_UNAVAILABLE', 'The room is already booked for part of this time.');
}
