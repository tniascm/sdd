/**
 * FR-010 … FR-012 booking rules — pure functions of their inputs (NFR-008: testable without
 * database, network or real clock). The first violated rule is reported, naming its field.
 */
import { openingWindow, type Interval } from './availability.ts';
import { isOnSlotBoundary, localDate } from './campus-time.ts';
import type { ErrorCode } from './errors.ts';
import { ROLE_LIMITS, type Role } from './types.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const SLOT_MINUTES = 30;

export type SlotRequest = { start: number; end: number; partySize: number };

export type RuleContext = {
  now: number;
  role: Role;
  roomCapacity: number;
  /** the caller's confirmed bookings that have not ended (FR-012 "upcoming") */
  upcomingCount: number;
  timeZone: string;
  opensAt: string;
  closesAt: string;
};

export type RuleViolation = { code: ErrorCode; message: string; field?: string };

/** FR-011: half-open intervals overlap ⇔ a.start < b.end ∧ b.start < a.end (back-to-back is fine). */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function checkBookingRules(req: SlotRequest, ctx: RuleContext): RuleViolation | null {
  const limits = ROLE_LIMITS[ctx.role];
  const { start, end, partySize } = req;

  if (!isOnSlotBoundary(start, ctx.timeZone)) {
    return { code: 'NOT_ON_SLOT_BOUNDARY', field: 'start', message: 'The start time must be on a full or half hour (e.g. 10:00 or 10:30).' };
  }
  if (!isOnSlotBoundary(end, ctx.timeZone)) {
    return { code: 'NOT_ON_SLOT_BOUNDARY', field: 'end', message: 'The end time must be on a full or half hour (e.g. 11:00 or 11:30).' };
  }
  if (end - start < SLOT_MINUTES * MINUTE) {
    return { code: 'TOO_SHORT', field: 'end', message: `A booking must last at least ${SLOT_MINUTES} minutes and end after it starts.` };
  }
  if (start <= ctx.now) {
    return { code: 'IN_PAST', field: 'start', message: 'The booking must start in the future.' };
  }

  const window = openingWindow(localDate(start, ctx.timeZone), ctx.timeZone, ctx.opensAt, ctx.closesAt);
  if (start < window.start) {
    return { code: 'OUTSIDE_OPENING_HOURS', field: 'start', message: `Rooms open at ${ctx.opensAt} campus time.` };
  }
  if (end > window.end) {
    return { code: 'OUTSIDE_OPENING_HOURS', field: 'end', message: `Bookings must end by ${ctx.closesAt} campus time on the same day.` };
  }

  if (end - start > limits.maxDurationMin * MINUTE) {
    return { code: 'TOO_LONG', field: 'end', message: `As ${article(ctx.role)} ${ctx.role} you can book at most ${limits.maxDurationMin / 60} hours at a time.` };
  }
  if (start - ctx.now > limits.maxAheadDays * DAY) {
    return { code: 'TOO_FAR_AHEAD', field: 'start', message: `As ${article(ctx.role)} ${ctx.role} you can book at most ${limits.maxAheadDays} days ahead.` };
  }

  if (!Number.isInteger(partySize) || partySize < 1) {
    return { code: 'VALIDATION_FAILED', field: 'partySize', message: 'The party size must be at least 1.' };
  }
  if (partySize > ctx.roomCapacity) {
    return { code: 'PARTY_TOO_LARGE', field: 'partySize', message: `This room holds at most ${ctx.roomCapacity} people.` };
  }

  if (ctx.upcomingCount >= limits.maxUpcoming) {
    return { code: 'QUOTA_REACHED', message: `You already hold ${limits.maxUpcoming} upcoming bookings, the most allowed for your role. Cancel one to book again.` };
  }
  return null;
}

const article = (role: Role) => (role === 'admin' ? 'an' : 'a');
