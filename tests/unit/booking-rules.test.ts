// T028 — FR-010 … FR-012 booking rules as a decision table, without database, network or real clock (NFR-008).
import { describe, expect, it } from 'vitest';
import { checkBookingRules, overlaps, type RuleContext } from '../../src/domain/booking-rules.ts';

const MIN = 60_000;
/** Campus-local wall time in Helsinki during winter time (UTC+2). */
const t = (date: string, time: string) => Date.parse(`${date}T${time}:00+02:00`);

const NOW = t('2026-11-02', '08:00'); // Monday
const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({
  now: NOW, role: 'student', roomCapacity: 6, upcomingCount: 0,
  timeZone: 'Europe/Helsinki', opensAt: '08:00', closesAt: '22:00', ...over,
});
const req = (date: string, from: string, to: string, partySize = 2) => ({ start: t(date, from), end: t(date, to), partySize });
const code = (r: ReturnType<typeof req>, c: Partial<RuleContext> = {}) => checkBookingRules(r, ctx(c))?.code ?? 'OK';

describe('FR-010 slot shape', () => {
  it.each([
    ['30 minutes', '10:00', '10:30', 'OK'],
    ['0 minutes (start = end)', '10:00', '10:00', 'TOO_SHORT'],
    ['end before start', '11:00', '10:00', 'TOO_SHORT'],
    ['start not on a half hour', '10:15', '11:00', 'NOT_ON_SLOT_BOUNDARY'],
    ['end not on a half hour', '10:00', '10:45', 'NOT_ON_SLOT_BOUNDARY'],
  ])('%s → %s', (_label, from, to, expected) => {
    expect(code(req('2026-11-03', from, to))).toBe(expected);
  });

  it('seconds or milliseconds off the boundary are rejected', () => {
    const r = req('2026-11-03', '10:00', '11:00');
    expect(code({ ...r, start: r.start + 1000 })).toBe('NOT_ON_SLOT_BOUNDARY');
    expect(code({ ...r, end: r.end + 1 })).toBe('NOT_ON_SLOT_BOUNDARY');
  });
});

describe('FR-010 start in the future', () => {
  it('a start before now or exactly now is IN_PAST; 30 min later is fine', () => {
    expect(code(req('2026-11-02', '07:30', '08:30'), { now: t('2026-11-02', '07:45') })).toBe('IN_PAST');
    expect(code(req('2026-11-02', '08:00', '09:00'))).toBe('IN_PAST');
    expect(code(req('2026-11-02', '08:30', '09:30'))).toBe('OK');
  });
});

describe('FR-010 opening hours (08:00–22:00 campus time, one campus-local day)', () => {
  it.each([
    ['08:00–09:00 (first slot)', '2026-11-03', '08:00', '09:00', 'OK'],
    ['21:30–22:00 (last slot)', '2026-11-03', '21:30', '22:00', 'OK'],
    ['21:30–22:30', '2026-11-03', '21:30', '22:30', 'OUTSIDE_OPENING_HOURS'],
    ['07:30–08:30', '2026-11-03', '07:30', '08:30', 'OUTSIDE_OPENING_HOURS'],
  ])('%s → %s', (_label, date, from, to, expected) => {
    expect(code(req(date, from, to))).toBe(expected);
  });

  it('a booking crossing midnight is outside opening hours', () => {
    expect(code({ start: t('2026-11-03', '21:00'), end: t('2026-11-04', '00:00'), partySize: 2 }, { role: 'staff' })).toBe('OUTSIDE_OPENING_HOURS');
  });

  it('opening hours follow campus time on the spring DST change (2027-03-28, UTC+3 from 04:00)', () => {
    const now = Date.parse('2027-03-27T06:00:00.000Z');
    const at = (iso: string) => Date.parse(iso);
    // 08:00 local on 2027-03-28 is 05:00Z; 07:30 local is 04:30Z
    expect(checkBookingRules({ start: at('2027-03-28T05:00:00Z'), end: at('2027-03-28T06:00:00Z'), partySize: 1 }, ctx({ now }))).toBeNull();
    expect(checkBookingRules({ start: at('2027-03-28T04:30:00Z'), end: at('2027-03-28T05:30:00Z'), partySize: 1 }, ctx({ now }))?.code).toBe('OUTSIDE_OPENING_HOURS');
    expect(checkBookingRules({ start: at('2027-03-28T18:30:00Z'), end: at('2027-03-28T19:00:00Z'), partySize: 1 }, ctx({ now }))).toBeNull();
    expect(checkBookingRules({ start: at('2027-03-28T19:00:00Z'), end: at('2027-03-28T19:30:00Z'), partySize: 1 }, ctx({ now }))?.code).toBe('OUTSIDE_OPENING_HOURS');
  });
});

describe('FR-010 party size', () => {
  it('equal to the capacity is fine, above it PARTY_TOO_LARGE, below 1 is invalid', () => {
    expect(code(req('2026-11-03', '10:00', '11:00', 6))).toBe('OK');
    expect(code(req('2026-11-03', '10:00', '11:00', 7))).toBe('PARTY_TOO_LARGE');
    expect(code(req('2026-11-03', '10:00', '11:00', 0))).toBe('VALIDATION_FAILED');
  });
});

describe('FR-012 role limits', () => {
  it.each([
    ['student', '10:00', '12:00', 'OK'],
    ['student', '10:00', '12:30', 'TOO_LONG'],
    ['staff', '10:00', '14:00', 'OK'],
    ['staff', '10:00', '14:30', 'TOO_LONG'],
    ['admin', '10:00', '14:00', 'OK'],
    ['admin', '10:00', '14:30', 'TOO_LONG'],
  ] as const)('%s %s–%s → %s', (role, from, to, expected) => {
    expect(code(req('2026-11-03', from, to), { role })).toBe(expected);
  });

  it('students may start exactly 7 days ahead but not 30 minutes later', () => {
    expect(code(req('2026-11-09', '08:00', '09:00'))).toBe('OK');
    expect(code(req('2026-11-09', '08:30', '09:30'))).toBe('TOO_FAR_AHEAD');
  });

  it('staff may start exactly 30 days ahead but not 30 minutes later', () => {
    expect(code(req('2026-12-02', '08:00', '09:00'), { role: 'staff' })).toBe('OK');
    expect(code(req('2026-12-02', '08:30', '09:30'), { role: 'staff' })).toBe('TOO_FAR_AHEAD');
  });

  it.each([
    ['student', 2, 'OK'],
    ['student', 3, 'QUOTA_REACHED'],
    ['staff', 9, 'OK'],
    ['staff', 10, 'QUOTA_REACHED'],
  ] as const)('%s holding %i upcoming bookings → %s', (role, upcomingCount, expected) => {
    expect(code(req('2026-11-03', '10:00', '11:00'), { role, upcomingCount })).toBe(expected);
  });
});

describe('violations name the field and are human-readable (NFR-007)', () => {
  it.each([
    [req('2026-11-03', '10:15', '11:00'), {}, 'start'],
    [req('2026-11-03', '10:00', '10:00'), {}, 'end'],
    [req('2026-11-03', '21:30', '22:30'), {}, 'end'],
    [req('2026-11-03', '10:00', '11:00', 7), {}, 'partySize'],
    [req('2026-11-09', '08:30', '09:30'), {}, 'start'],
  ])('%#', (r, c, field) => {
    const v = checkBookingRules(r, ctx(c));
    expect(v?.field).toBe(field);
    expect(v?.message.length).toBeGreaterThan(10);
  });
});

describe('FR-011 overlaps (half-open intervals)', () => {
  const a = { start: 10 * MIN, end: 20 * MIN };
  it.each([
    [{ start: 20 * MIN, end: 30 * MIN }, false], // back-to-back after
    [{ start: 0, end: 10 * MIN }, false], // back-to-back before
    [{ start: 15 * MIN, end: 25 * MIN }, true],
    [{ start: 5 * MIN, end: 15 * MIN }, true],
    [{ start: 12 * MIN, end: 18 * MIN }, true],
    [{ start: 0, end: 30 * MIN }, true],
    [{ start: 10 * MIN, end: 20 * MIN }, true],
  ])('%o → %s', (b, expected) => {
    expect(overlaps(a, b)).toBe(expected);
    expect(overlaps(b, a)).toBe(expected);
  });
});
