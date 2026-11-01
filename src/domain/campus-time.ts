/**
 * Campus-local time ⇄ UTC (research R7). Pure: uses the built-in Intl time-zone database only.
 * Opening hours and slot boundaries (FR-010) are evaluated in campus time, so they stay correct
 * on days when the campus switches between summer and winter time.
 */

export type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of the UTC instant `instant` (epoch ms) in `timeZone`. */
export function wallClock(instant: number, timeZone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: ((instant % 1000) + 1000) % 1000,
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Campus-local calendar date (`YYYY-MM-DD`) of an instant. */
export function localDate(instant: number, timeZone: string): string {
  const wc = wallClock(instant, timeZone);
  return `${pad(wc.year, 4)}-${pad(wc.month)}-${pad(wc.day)}`;
}

/** Offset of `timeZone` from UTC at `instant`, in ms (e.g. +3 h for Helsinki in summer). */
function offsetAt(instant: number, timeZone: string): number {
  const wc = wallClock(instant, timeZone);
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second, wc.millisecond);
  return asUtc - instant;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parses `YYYY-MM-DD`; throws RangeError for malformed or non-existent calendar dates. */
export function parseLocalDate(date: string): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`invalid date: ${date}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError(`invalid date: ${date}`);
  }
  return { year, month, day };
}

/** Parses `HH:MM` (00:00–23:59) into minutes since midnight; throws RangeError otherwise. */
export function parseLocalTime(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new RangeError(`invalid time: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Campus-local date + time → UTC instant (epoch ms), by the two-pass offset method:
 * take the offset at the naive instant, then re-check it at the corrected instant.
 * For a local time that occurs twice (autumn change) the later instant is returned.
 */
export function localToUtc(date: string, time: string, timeZone: string): number {
  const { year, month, day } = parseLocalDate(date);
  const minutes = parseLocalTime(time);
  const naive = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  const firstOffset = offsetAt(naive, timeZone);
  let instant = naive - firstOffset;
  const secondOffset = offsetAt(instant, timeZone);
  if (secondOffset !== firstOffset) instant = naive - secondOffset;
  return instant;
}

/** True when the instant is a full or half hour in campus time with no seconds or milliseconds. */
export function isOnSlotBoundary(instant: number, timeZone: string): boolean {
  const wc = wallClock(instant, timeZone);
  return (wc.minute === 0 || wc.minute === 30) && wc.second === 0 && wc.millisecond === 0;
}
