// T008 — campus-local time ⇄ UTC (FR-010, edge case "days on which campus time changes").
import { describe, expect, it } from 'vitest';
import { isOnSlotBoundary, localDate, localToUtc, wallClock } from '../../src/domain/campus-time.ts';

const HEL = 'Europe/Helsinki';
const utc = (iso: string) => Date.parse(iso);

describe('wallClock — campus-local wall-clock parts of a UTC instant', () => {
  it('reads Helsinki summer time (UTC+3) and winter time (UTC+2)', () => {
    expect(wallClock(utc('2026-07-01T09:15:30.250Z'), HEL)).toEqual({
      year: 2026, month: 7, day: 1, hour: 12, minute: 15, second: 30, millisecond: 250,
    });
    expect(wallClock(utc('2026-11-02T06:00:00.000Z'), HEL)).toEqual({
      year: 2026, month: 11, day: 2, hour: 8, minute: 0, second: 0, millisecond: 0,
    });
  });

  it('2026-10-25 (UTC+3 → UTC+2): the clock goes back from 04:00 to 03:00 at 01:00 UTC', () => {
    expect(wallClock(utc('2026-10-25T00:59:59.000Z'), HEL)).toMatchObject({ day: 25, hour: 3, minute: 59, second: 59 });
    expect(wallClock(utc('2026-10-25T01:00:00.000Z'), HEL)).toMatchObject({ day: 25, hour: 3, minute: 0, second: 0 });
    expect(wallClock(utc('2026-10-25T20:00:00.000Z'), HEL)).toMatchObject({ day: 25, hour: 22, minute: 0 });
  });

  it('2027-03-28 (UTC+2 → UTC+3): the clock jumps from 03:00 to 04:00 at 01:00 UTC', () => {
    expect(wallClock(utc('2027-03-28T00:59:00.000Z'), HEL)).toMatchObject({ day: 28, hour: 2, minute: 59 });
    expect(wallClock(utc('2027-03-28T01:00:00.000Z'), HEL)).toMatchObject({ day: 28, hour: 4, minute: 0 });
  });

  it('works for UTC itself', () => {
    expect(wallClock(utc('2026-01-31T23:30:00.000Z'), 'UTC')).toEqual({
      year: 2026, month: 1, day: 31, hour: 23, minute: 30, second: 0, millisecond: 0,
    });
  });
});

describe('localDate — campus-local calendar date of an instant', () => {
  it('rolls over at local midnight, not UTC midnight', () => {
    expect(localDate(utc('2026-10-24T20:59:59.999Z'), HEL)).toBe('2026-10-24');
    expect(localDate(utc('2026-10-24T21:00:00.000Z'), HEL)).toBe('2026-10-25');
    expect(localDate(utc('2026-10-25T21:59:59.999Z'), HEL)).toBe('2026-10-25');
    expect(localDate(utc('2026-10-25T22:00:00.000Z'), HEL)).toBe('2026-10-26');
  });
});

describe('localToUtc — campus-local date + time → UTC instant (two-pass offset)', () => {
  it('opening hours on the days around the autumn change (2026-10-25)', () => {
    expect(localToUtc('2026-10-24', '08:00', HEL)).toBe(utc('2026-10-24T05:00:00.000Z'));
    expect(localToUtc('2026-10-24', '22:00', HEL)).toBe(utc('2026-10-24T19:00:00.000Z'));
    expect(localToUtc('2026-10-25', '08:00', HEL)).toBe(utc('2026-10-25T06:00:00.000Z'));
    expect(localToUtc('2026-10-25', '22:00', HEL)).toBe(utc('2026-10-25T20:00:00.000Z'));
  });

  it('opening hours on the days around the spring change (2027-03-28)', () => {
    expect(localToUtc('2027-03-27', '08:00', HEL)).toBe(utc('2027-03-27T06:00:00.000Z'));
    expect(localToUtc('2027-03-28', '08:00', HEL)).toBe(utc('2027-03-28T05:00:00.000Z'));
    expect(localToUtc('2027-03-28', '22:00', HEL)).toBe(utc('2027-03-28T19:00:00.000Z'));
  });

  it('resolves a local time just before the autumn change with the old offset', () => {
    // 02:00 local on 2026-10-25 is still summer time (UTC+3)
    expect(localToUtc('2026-10-25', '02:00', HEL)).toBe(utc('2026-10-24T23:00:00.000Z'));
  });

  it('a whole campus day lasts 25 h in autumn and 23 h in spring', () => {
    const h = 3_600_000;
    expect(localToUtc('2026-10-26', '00:00', HEL) - localToUtc('2026-10-25', '00:00', HEL)).toBe(25 * h);
    expect(localToUtc('2027-03-29', '00:00', HEL) - localToUtc('2027-03-28', '00:00', HEL)).toBe(23 * h);
  });

  it('round-trips every half hour of opening time on both change days', () => {
    for (const date of ['2026-10-25', '2027-03-28']) {
      for (let m = 8 * 60; m <= 22 * 60; m += 30) {
        const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const instant = localToUtc(date, time, HEL);
        const wc = wallClock(instant, HEL);
        expect(localDate(instant, HEL)).toBe(date);
        expect(wc.hour * 60 + wc.minute).toBe(m);
      }
    }
  });

  it('rejects malformed or impossible dates and times', () => {
    expect(() => localToUtc('2026-02-30', '08:00', HEL)).toThrow(RangeError);
    expect(() => localToUtc('2026-13-01', '08:00', HEL)).toThrow(RangeError);
    expect(() => localToUtc('26-01-01', '08:00', HEL)).toThrow(RangeError);
    expect(() => localToUtc('2026-01-01', '24:00', HEL)).toThrow(RangeError);
    expect(() => localToUtc('2026-01-01', '8:00', HEL)).toThrow(RangeError);
  });
});

describe('isOnSlotBoundary — minute ∈ {0, 30} in campus time, no seconds or milliseconds', () => {
  it('accepts full and half hours', () => {
    expect(isOnSlotBoundary(utc('2026-10-25T06:00:00.000Z'), HEL)).toBe(true);
    expect(isOnSlotBoundary(utc('2026-10-25T06:30:00.000Z'), HEL)).toBe(true);
    expect(isOnSlotBoundary(utc('2027-03-28T19:00:00.000Z'), HEL)).toBe(true);
  });

  it('rejects other minutes, seconds and milliseconds', () => {
    expect(isOnSlotBoundary(utc('2026-10-25T06:15:00.000Z'), HEL)).toBe(false);
    expect(isOnSlotBoundary(utc('2026-10-25T06:00:01.000Z'), HEL)).toBe(false);
    expect(isOnSlotBoundary(utc('2026-10-25T06:00:00.001Z'), HEL)).toBe(false);
  });

  it('is evaluated in campus time (zone with a 45-minute offset)', () => {
    // Asia/Kathmandu is UTC+5:45: 04:15Z = 10:00 local, 04:00Z = 09:45 local
    expect(isOnSlotBoundary(utc('2026-11-02T04:15:00.000Z'), 'Asia/Kathmandu')).toBe(true);
    expect(isOnSlotBoundary(utc('2026-11-02T04:00:00.000Z'), 'Asia/Kathmandu')).toBe(false);
  });
});
