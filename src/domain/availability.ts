/**
 * FR-006: a room's booked and free intervals inside the campus-local opening window of a date.
 * Only start and end are ever copied, so no booker identity can appear (NFR-009).
 */
import { localToUtc } from './campus-time.ts';

export type Interval = { start: number; end: number };

/** Opening hours of a campus-local date as a UTC interval (DST-safe). */
export function openingWindow(date: string, timeZone: string, opensAt: string, closesAt: string): Interval {
  return { start: localToUtc(date, opensAt, timeZone), end: localToUtc(date, closesAt, timeZone) };
}

export function computeAvailability(window: Interval, intervals: readonly Interval[]): { booked: Interval[]; free: Interval[] } {
  const booked = intervals
    .filter((i) => i.start < window.end && i.end > window.start)
    .map((i) => ({ start: Math.max(i.start, window.start), end: Math.min(i.end, window.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const free: Interval[] = [];
  let cursor = window.start;
  for (const b of booked) {
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return { booked, free };
}
