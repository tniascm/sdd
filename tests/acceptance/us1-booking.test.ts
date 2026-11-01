// Verifier (T026) — User Story 1: book a study room. Spec: FR-005, FR-006, FR-009…FR-012, NFR-009.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, at, TODAY, TOMORROW, type Harness, type TestUser } from '../support/harness.ts';

let h: Harness;
let room: any;
let alice: TestUser;
let bob: TestUser;

beforeEach(async () => {
  h = await startHarness();
  room = await h.createRoom({ name: 'Aurora', building: 'Main Library', capacity: 6, equipment: ['whiteboard', 'projector'] });
  alice = await h.newUser({ displayName: 'Alice Booker' });
  bob = await h.newUser();
});
afterEach(() => h.close());

const slot = (date: string, from: string, to: string) => ({ start: at(date, from), end: at(date, to) });

describe('US1 — Book a study room', () => {
  it('US1-1 (FR-009): a student books a room in service for tomorrow 10:00–11:00 for 4 people and sees it in upcoming bookings', async () => {
    const r = await h.book(alice, { roomId: room.id, ...slot(TOMORROW, '10:00', '11:00'), partySize: 4 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ roomId: room.id, roomName: 'Aurora', partySize: 4, status: 'confirmed' });
    expect(r.body.start).toBe('2026-11-03T08:00:00.000Z');
    expect(r.body.end).toBe('2026-11-03T09:00:00.000Z');

    const mine = await alice.api.get('/bookings/mine');
    expect(mine.status).toBe(200);
    expect(mine.body.bookings.map((b: any) => b.id)).toEqual([r.body.id]);
  });

  it('US1-2 (FR-011): an overlapping booking of the same room is rejected and nothing is created', async () => {
    expect((await h.book(alice, { roomId: room.id, ...slot(TOMORROW, '10:00', '11:00') })).status).toBe(201);
    const r = await h.book(bob, { roomId: room.id, ...slot(TOMORROW, '10:30', '11:30') });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SLOT_UNAVAILABLE');
    expect((await bob.api.get('/bookings/mine')).body.bookings).toHaveLength(0);
  });

  it('US1-3 (FR-011): back-to-back bookings are allowed', async () => {
    expect((await h.book(alice, { roomId: room.id, ...slot(TOMORROW, '10:00', '11:00') })).status).toBe(201);
    expect((await h.book(bob, { roomId: room.id, ...slot(TOMORROW, '11:00', '12:00') })).status).toBe(201);
    expect((await h.book(bob, { roomId: room.id, ...slot(TOMORROW, '09:00', '10:00') })).status).toBe(201);
  });

  describe('US1-4 (FR-010): rule violations are rejected with an error naming the rule', () => {
    it('start in the past', async () => {
      h.clock.set(at(TODAY, '12:00'));
      const r = await h.book(alice, { roomId: room.id, ...slot(TODAY, '10:00', '11:00') });
      expect([r.status, r.body.error?.code]).toEqual([422, 'IN_PAST']);
    });
    it('not on a 30-minute boundary', async () => {
      const r = await h.book(alice, { roomId: room.id, ...slot(TOMORROW, '10:15', '11:15') });
      expect([r.status, r.body.error?.code]).toEqual([422, 'NOT_ON_SLOT_BOUNDARY']);
    });
    it('ends after 22:00 campus time', async () => {
      const r = await h.book(alice, { roomId: room.id, ...slot(TOMORROW, '21:30', '22:30') });
      expect([r.status, r.body.error?.code]).toEqual([422, 'OUTSIDE_OPENING_HOURS']);
    });
    it('starts before 08:00 campus time', async () => {
      const r = await h.book(alice, { roomId: room.id, ...slot(TOMORROW, '07:30', '08:30') });
      expect([r.status, r.body.error?.code]).toEqual([422, 'OUTSIDE_OPENING_HOURS']);
    });
    it('party size larger than the room capacity', async () => {
      const r = await h.book(alice, { roomId: room.id, ...slot(TOMORROW, '10:00', '11:00'), partySize: 7 });
      expect([r.status, r.body.error?.code]).toEqual([422, 'PARTY_TOO_LARGE']);
    });
    it('the error message is human-readable (NFR-007)', async () => {
      const r = await h.book(alice, { roomId: room.id, ...slot(TOMORROW, '10:15', '11:15') });
      expect(r.body.error.message.length).toBeGreaterThan(10);
    });
  });

  it('US1-5 (FR-012): a student holding 3 upcoming bookings cannot make a fourth', async () => {
    for (const [from, to] of [['08:00', '09:00'], ['12:00', '13:00'], ['16:00', '17:00']]) {
      expect((await h.book(alice, { roomId: room.id, ...slot(TOMORROW, from, to) })).status).toBe(201);
    }
    const r = await h.book(alice, { roomId: room.id, ...slot(TOMORROW, '19:00', '20:00') });
    expect([r.status, r.body.error?.code]).toEqual([422, 'QUOTA_REACHED']);
  });

  it('US1-6 (FR-012): students are limited to 2 h and 7 days ahead; staff may book 4 h and 30 days ahead', async () => {
    expect((await h.book(alice, { roomId: room.id, ...slot(TOMORROW, '10:00', '12:00') })).status).toBe(201);
    const tooLong = await h.book(bob, { roomId: room.id, ...slot(TOMORROW, '13:00', '15:30') });
    expect([tooLong.status, tooLong.body.error?.code]).toEqual([422, 'TOO_LONG']);
    // now = 2026-11-02 08:00 → exactly 7 days ahead is 2026-11-09 08:00
    expect((await h.book(bob, { roomId: room.id, ...slot('2026-11-09', '08:00', '09:00') })).status).toBe(201);
    const tooFar = await h.book(alice, { roomId: room.id, ...slot('2026-11-09', '08:30', '09:30') });
    expect([tooFar.status, tooFar.body.error?.code]).toEqual([422, 'TOO_FAR_AHEAD']);

    const staff = await h.newUser({ role: 'staff' });
    expect((await h.book(staff, { roomId: room.id, ...slot('2026-11-04', '10:00', '14:00') })).status).toBe(201);
    expect((await h.book(staff, { roomId: room.id, ...slot('2026-11-30', '10:00', '11:00') })).status).toBe(201);
    const staffTooLong = await h.book(staff, { roomId: room.id, ...slot('2026-11-05', '10:00', '14:30') });
    expect(staffTooLong.body.error?.code).toBe('TOO_LONG');
  });

  it('US1-7 (FR-006, NFR-009): availability shows booked and free intervals but not who booked', async () => {
    await h.book(alice, { roomId: room.id, ...slot(TOMORROW, '10:00', '11:00'), purpose: 'Alice exam prep' });
    const r = await bob.api.get(`/rooms/${room.id}/availability?date=${TOMORROW}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ roomId: room.id, date: TOMORROW, timeZone: 'Europe/Helsinki', opens: '08:00', closes: '22:00' });
    expect(r.body.booked).toEqual([{ start: '2026-11-03T08:00:00.000Z', end: '2026-11-03T09:00:00.000Z' }]);
    expect(r.body.free).toEqual([
      { start: '2026-11-03T06:00:00.000Z', end: '2026-11-03T08:00:00.000Z' },
      { start: '2026-11-03T09:00:00.000Z', end: '2026-11-03T20:00:00.000Z' },
    ]);
    expect(r.text).not.toContain('Alice');
    expect(r.text).not.toContain(alice.email);
  });
});

describe('US1 — room list (FR-005)', () => {
  it('lists rooms in service with filters for capacity, building and equipment', async () => {
    await h.createRoom({ name: 'Borealis', building: 'Science Hall', capacity: 12, equipment: ['display-screen'] });
    const all = await alice.api.get('/rooms');
    expect(all.body.rooms.map((x: any) => x.name).sort()).toEqual(['Aurora', 'Borealis']);
    expect((await alice.api.get('/rooms?minCapacity=7')).body.rooms.map((x: any) => x.name)).toEqual(['Borealis']);
    expect((await alice.api.get('/rooms?building=Main%20Library')).body.rooms.map((x: any) => x.name)).toEqual(['Aurora']);
    expect((await alice.api.get('/rooms?equipment=whiteboard,projector')).body.rooms.map((x: any) => x.name)).toEqual(['Aurora']);
    expect((await alice.api.get('/rooms?equipment=whiteboard,display-screen')).body.rooms).toEqual([]);
  });

  it('requires sign-in', async () => {
    expect((await h.anon.get('/rooms')).status).toBe(401);
  });
});

describe('US1 — edge cases', () => {
  it('start equal to end, or end before start, is rejected as too short', async () => {
    const same = await h.book(alice, { roomId: room.id, start: at(TOMORROW, '10:00'), end: at(TOMORROW, '10:00') });
    expect([same.status, same.body.error?.code]).toEqual([422, 'TOO_SHORT']);
    const reversed = await h.book(alice, { roomId: room.id, start: at(TOMORROW, '11:00'), end: at(TOMORROW, '10:00') });
    expect([reversed.status, reversed.body.error?.code]).toEqual([422, 'TOO_SHORT']);
  });

  it('a booking crossing midnight is outside opening hours', async () => {
    const staff = await h.newUser({ role: 'staff' });
    const r = await h.book(staff, { roomId: room.id, start: at(TOMORROW, '21:00'), end: at('2026-11-04', '00:00') });
    expect([r.status, r.body.error?.code]).toEqual([422, 'OUTSIDE_OPENING_HOURS']);
  });

  it('21:30–22:00 (last slot of the day) is allowed', async () => {
    expect((await h.book(alice, { roomId: room.id, ...slot(TOMORROW, '21:30', '22:00') })).status).toBe(201);
  });

  it('a room out of service cannot be booked; an unknown room is not found', async () => {
    await h.admin.api.post(`/rooms/${room.id}/out-of-service`);
    const r = await h.book(alice, { roomId: room.id, ...slot(TOMORROW, '10:00', '11:00') });
    expect([r.status, r.body.error?.code]).toEqual([422, 'ROOM_OUT_OF_SERVICE']);
    const unknown = await h.book(alice, { roomId: '00000000-0000-4000-8000-000000000000', ...slot(TOMORROW, '10:00', '11:00') });
    expect([unknown.status, unknown.body.error?.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('party size 0, purpose over 100 characters and unknown fields are rejected by validation', async () => {
    const base = { roomId: room.id, ...slot(TOMORROW, '10:00', '11:00') };
    expect((await alice.api.post('/bookings', { ...base, partySize: 0 })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await alice.api.post('/bookings', { ...base, partySize: 2, purpose: 'x'.repeat(101) })).body.error.code).toBe('VALIDATION_FAILED');
    const extra = await alice.api.post('/bookings', { ...base, partySize: 2, userId: bob.id });
    expect([extra.status, extra.body.error.code]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('markup in the purpose is stored and returned as plain text', async () => {
    const purpose = '<script>alert(1)</script>';
    const r = await h.book(alice, { roomId: room.id, ...slot(TOMORROW, '10:00', '11:00'), purpose });
    expect(r.status).toBe(201);
    expect(r.body.purpose).toBe(purpose);
    expect(r.headers['content-type']).toMatch(/application\/json/);
  });

  it('opening hours follow campus local time across the daylight-saving change (2027-03-28, UTC+2 → UTC+3)', async () => {
    const before = await alice.api.get(`/rooms/${room.id}/availability?date=2027-03-27`);
    expect(before.body.free).toEqual([{ start: '2027-03-27T06:00:00.000Z', end: '2027-03-27T20:00:00.000Z' }]);
    const after = await alice.api.get(`/rooms/${room.id}/availability?date=2027-03-28`);
    expect(after.body.free).toEqual([{ start: '2027-03-28T05:00:00.000Z', end: '2027-03-28T19:00:00.000Z' }]);
  });

  it('availability of an unknown room is not found and a malformed date is a validation error', async () => {
    expect((await alice.api.get(`/rooms/00000000-0000-4000-8000-000000000000/availability?date=${TOMORROW}`)).status).toBe(404);
    expect((await alice.api.get(`/rooms/${room.id}/availability?date=03-11-2026`)).status).toBe(400);
  });
});
