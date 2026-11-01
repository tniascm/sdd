// T029 — FR-006 availability: booked and free intervals inside the campus-local opening window,
// without booker identity (NFR-009).
import { describe, expect, it } from 'vitest';
import { computeAvailability, openingWindow } from '../../src/domain/availability.ts';

const H = 3_600_000;
const W = { start: 8 * H, end: 22 * H };

describe('openingWindow', () => {
  it('maps campus opening hours of a date to UTC, also on DST change days', () => {
    expect(openingWindow('2026-11-03', 'Europe/Helsinki', '08:00', '22:00')).toEqual({
      start: Date.parse('2026-11-03T06:00:00.000Z'),
      end: Date.parse('2026-11-03T20:00:00.000Z'),
    });
    expect(openingWindow('2027-03-28', 'Europe/Helsinki', '08:00', '22:00')).toEqual({
      start: Date.parse('2027-03-28T05:00:00.000Z'),
      end: Date.parse('2027-03-28T19:00:00.000Z'),
    });
  });
});

describe('computeAvailability', () => {
  it('a day without bookings is one free interval', () => {
    expect(computeAvailability(W, [])).toEqual({ booked: [], free: [W] });
  });

  it('a booking in the middle splits the free time in two', () => {
    expect(computeAvailability(W, [{ start: 10 * H, end: 11 * H }])).toEqual({
      booked: [{ start: 10 * H, end: 11 * H }],
      free: [{ start: 8 * H, end: 10 * H }, { start: 11 * H, end: 22 * H }],
    });
  });

  it('bookings at the edges and back-to-back leave no empty free intervals', () => {
    const r = computeAvailability(W, [
      { start: 21 * H, end: 22 * H },
      { start: 8 * H, end: 9 * H },
      { start: 9 * H, end: 10 * H },
    ]);
    expect(r.booked).toEqual([{ start: 8 * H, end: 9 * H }, { start: 9 * H, end: 10 * H }, { start: 21 * H, end: 22 * H }]);
    expect(r.free).toEqual([{ start: 10 * H, end: 21 * H }]);
  });

  it('a fully booked day has no free intervals', () => {
    expect(computeAvailability(W, [W]).free).toEqual([]);
  });

  it('clips intervals to the window and ignores those outside it', () => {
    const r = computeAvailability(W, [{ start: 7 * H, end: 9 * H }, { start: 22 * H, end: 23 * H }, { start: 1 * H, end: 2 * H }]);
    expect(r.booked).toEqual([{ start: 8 * H, end: 9 * H }]);
    expect(r.free).toEqual([{ start: 9 * H, end: 22 * H }]);
  });

  it('copies only start and end, so no booker identity can leak (NFR-009)', () => {
    const booking = { start: 10 * H, end: 11 * H, userId: 'u-1', purpose: 'Alice exam prep' };
    const r = computeAvailability(W, [booking]);
    expect(r.booked[0]).toStrictEqual({ start: 10 * H, end: 11 * H });
  });
});
