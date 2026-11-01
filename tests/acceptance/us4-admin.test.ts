// Verifier (T039) — User Story 4: administer rooms and bookings. Spec: FR-007, FR-008, FR-015…FR-017, FR-020.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, at, TODAY, TOMORROW, PASSWORD, TEST_ADMIN, type Harness, type TestUser } from '../support/harness.ts';

let h: Harness;
let alice: TestUser;

beforeEach(async () => {
  h = await startHarness();
  alice = await h.newUser({ displayName: 'Alice Student' });
});
afterEach(() => h.close());

describe('US4 — Administer rooms and bookings', () => {
  it('US4-1 (FR-007): an administrator creates a room and it appears in the room list', async () => {
    const r = await h.admin.api.post('/rooms', { name: 'Cedar', building: 'Arts', capacity: 8, equipment: ['projector'] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Cedar', building: 'Arts', capacity: 8, equipment: ['projector'], inService: true });
    const list = await alice.api.get('/rooms');
    expect(list.body.rooms.map((x: any) => x.id)).toContain(r.body.id);
  });

  it('US4-2 (NFR-003): non-administrators are refused every administrative operation', async () => {
    const room = await h.createRoom();
    const calls = [
      alice.api.post('/rooms', { name: 'X', building: 'Y', capacity: 2 }),
      alice.api.patch(`/rooms/${room.id}`, { capacity: 3 }),
      alice.api.post(`/rooms/${room.id}/out-of-service`),
      alice.api.post(`/rooms/${room.id}/in-service`),
      alice.api.get('/admin/rooms'),
      alice.api.get(`/admin/bookings?date=${TOMORROW}`),
      alice.api.get('/admin/users'),
      alice.api.put(`/admin/users/${alice.id}/role`, { role: 'admin' }),
      alice.api.get('/admin/audit-events'),
    ];
    for (const r of await Promise.all(calls)) {
      expect([r.status, r.body.error?.code]).toEqual([403, 'FORBIDDEN']);
    }
    expect((await alice.api.get('/me')).body.role).toBe('student');
  });

  it('US4-3 (FR-008, FR-016): taking a room out of service blocks booking and cancels its future bookings with a reason', async () => {
    const room = await h.createRoom({ name: 'Dune' });
    const bob = await h.newUser();
    const inProgress = (await h.book(bob, { roomId: room.id, start: at(TODAY, '08:30'), end: at(TODAY, '09:30') })).body;
    const future = (await h.book(alice, { roomId: room.id, start: at(TOMORROW, '10:00'), end: at(TOMORROW, '11:00') })).body;
    h.clock.set(at(TODAY, '09:00'));

    const r = await h.admin.api.post(`/rooms/${room.id}/out-of-service`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ room: { id: room.id, inService: false }, cancelledBookings: 1 });

    const mine = await alice.api.get('/bookings/mine?include=all');
    expect(mine.body.bookings.find((b: any) => b.id === future.id)).toMatchObject({
      status: 'cancelled', cancelledBy: 'system', cancelReason: 'Room taken out of service',
    });
    const bobs = await bob.api.get('/bookings/mine');
    expect(bobs.body.bookings.find((b: any) => b.id === inProgress.id).status).toBe('confirmed');

    expect((await alice.api.get('/rooms')).body.rooms.map((x: any) => x.id)).not.toContain(room.id);
    const blocked = await h.book(alice, { roomId: room.id, start: at(TOMORROW, '12:00'), end: at(TOMORROW, '13:00') });
    expect(blocked.body.error.code).toBe('ROOM_OUT_OF_SERVICE');
    expect((await alice.api.get(`/rooms/${room.id}/availability?date=${TOMORROW}`)).status).toBe(404);

    const adminRooms = await h.admin.api.get('/admin/rooms');
    expect(adminRooms.body.rooms.find((x: any) => x.id === room.id).inService).toBe(false);

    const back = await h.admin.api.post(`/rooms/${room.id}/in-service`);
    expect(back.body.room.inService).toBe(true);
    expect((await alice.api.get('/rooms')).body.rooms.map((x: any) => x.id)).toContain(room.id);
  });

  it('US4-4 (FR-015): administrators see all bookings of a date with who made them', async () => {
    const r1 = await h.createRoom({ name: 'Elm' });
    const r2 = await h.createRoom({ name: 'Fir' });
    const bob = await h.newUser({ displayName: 'Bob Builder' });
    await h.book(alice, { roomId: r1.id, start: at(TOMORROW, '10:00'), end: at(TOMORROW, '11:00') });
    await h.book(bob, { roomId: r2.id, start: at(TOMORROW, '12:00'), end: at(TOMORROW, '13:00') });
    await h.book(bob, { roomId: r2.id, start: at('2026-11-04', '12:00'), end: at('2026-11-04', '13:00') });

    const r = await h.admin.api.get(`/admin/bookings?date=${TOMORROW}`);
    expect(r.status).toBe(200);
    expect(r.body.date).toBe(TOMORROW);
    // FR-015 does not prescribe an order, so compare order-independently
    const rows = r.body.bookings.map((b: any) => [b.roomName, b.booker.displayName, b.booker.email]);
    expect(rows.sort()).toEqual([
      ['Elm', 'Alice Student', alice.email],
      ['Fir', 'Bob Builder', bob.email],
    ]);
  });

  it("US4-5 (FR-017): after promotion to staff, a user's bookings follow staff limits", async () => {
    const room = await h.createRoom();
    const fourHours = { roomId: room.id, start: at(TOMORROW, '10:00'), end: at(TOMORROW, '14:00') };
    expect((await h.book(alice, fourHours)).body.error.code).toBe('TOO_LONG');
    const r = await h.admin.api.put(`/admin/users/${alice.id}/role`, { role: 'staff' });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('staff');
    expect((await h.book(alice, fourHours)).status).toBe(201);
  });
});

describe('US4 — room management edge cases (FR-007)', () => {
  it('room names are unique regardless of letter case; capacity must be 1–50; equipment must be known', async () => {
    await h.createRoom({ name: 'Aurora' });
    const dup = await h.admin.api.post('/rooms', { name: 'aurora', building: 'B', capacity: 4 });
    expect([dup.status, dup.body.error?.code]).toEqual([409, 'ROOM_NAME_TAKEN']);
    expect((await h.admin.api.post('/rooms', { name: 'Big', building: 'B', capacity: 51 })).status).toBe(400);
    expect((await h.admin.api.post('/rooms', { name: 'Tiny', building: 'B', capacity: 0 })).status).toBe(400);
    expect((await h.admin.api.post('/rooms', { name: 'Odd', building: 'B', capacity: 4, equipment: ['laser'] })).status).toBe(400);
  });

  it('administrators edit room details; editing an unknown room is not found', async () => {
    const room = await h.createRoom({ name: 'Grove', capacity: 4 });
    const r = await h.admin.api.patch(`/rooms/${room.id}`, { capacity: 10, equipment: ['whiteboard', 'video-conferencing'] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Grove', capacity: 10 });
    expect([...r.body.equipment].sort()).toEqual(['video-conferencing', 'whiteboard']);
    expect((await h.admin.api.patch('/rooms/00000000-0000-4000-8000-000000000000', { capacity: 3 })).status).toBe(404);
    expect((await h.admin.api.patch(`/rooms/${room.id}`, {})).status).toBe(400);
  });
});

describe('US4 — administrator cancellation (FR-015)', () => {
  it("cancelling another user's booking requires a reason, which the owner then sees", async () => {
    const room = await h.createRoom();
    const b = (await h.book(alice, { roomId: room.id, start: at(TOMORROW, '10:00'), end: at(TOMORROW, '11:00') })).body;
    const noReason = await h.admin.api.post(`/bookings/${b.id}/cancel`);
    expect([noReason.status, noReason.body.error?.code]).toEqual([422, 'REASON_REQUIRED']);
    const ok = await h.admin.api.post(`/bookings/${b.id}/cancel`, { reason: 'Fire alarm test in the building' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'cancelled', cancelledBy: 'admin', cancelReason: 'Fire alarm test in the building' });
    const mine = await alice.api.get('/bookings/mine?include=all');
    expect(mine.body.bookings[0].cancelReason).toBe('Fire alarm test in the building');
  });

  it('administrators may cancel a booking in progress but not one that has ended', async () => {
    const room = await h.createRoom();
    const b1 = (await h.book(alice, { roomId: room.id, start: at(TODAY, '09:00'), end: at(TODAY, '10:00') })).body;
    const b2 = (await h.book(alice, { roomId: room.id, start: at(TODAY, '11:00'), end: at(TODAY, '12:00') })).body;
    h.clock.set(at(TODAY, '11:30'));
    const ended = await h.admin.api.post(`/bookings/${b1.id}/cancel`, { reason: 'late cleanup' });
    expect([ended.status, ended.body.error?.code]).toEqual([422, 'ALREADY_ENDED']);
    expect((await h.admin.api.post(`/bookings/${b2.id}/cancel`, { reason: 'Water leak' })).status).toBe(200);
  });
});

describe('US4 — roles and audit (FR-017, FR-020)', () => {
  it('the only administrator cannot remove their own administrator role', async () => {
    const r = await h.admin.api.put(`/admin/users/${h.admin.id}/role`, { role: 'staff' });
    expect([r.status, r.body.error?.code]).toEqual([409, 'LAST_ADMIN']);
    await h.admin.api.put(`/admin/users/${alice.id}/role`, { role: 'admin' });
    expect((await h.admin.api.put(`/admin/users/${h.admin.id}/role`, { role: 'staff' })).status).toBe(200);
  });

  it('administrators can find users by email fragment', async () => {
    const r = await h.admin.api.get(`/admin/users?email=${encodeURIComponent(alice.email.split('@')[0])}`);
    expect(r.body.users.map((u: any) => u.id)).toEqual([alice.id]);
  });

  it('audit events are listed newest first and contain no passwords, tokens or email addresses', async () => {
    const room = await h.createRoom({ name: 'Hazel' });
    await h.anon.post('/auth/login', { email: alice.email, password: 'wrong password!' });
    await h.admin.api.put(`/admin/users/${alice.id}/role`, { role: 'staff' });
    await h.admin.api.post(`/rooms/${room.id}/out-of-service`);

    const r = await h.admin.api.get('/admin/audit-events?limit=200');
    const ids = r.body.events.map((e: any) => e.id);
    expect(ids).toEqual([...ids].sort((a: number, b: number) => b - a));
    const actions = r.body.events.map((e: any) => e.action);
    for (const a of ['user.registered', 'auth.login.succeeded', 'auth.login.failed', 'room.created', 'user.role_changed', 'room.out_of_service']) {
      expect(actions).toContain(a);
    }
    expect(r.text).not.toContain(PASSWORD);
    expect(r.text).not.toContain(TEST_ADMIN.password);
    expect(r.text).not.toContain(alice.token);
    expect(r.text).not.toContain('@uni.example');

    const page = await h.admin.api.get(`/admin/audit-events?limit=2&beforeId=${ids[0]}`);
    expect(page.body.events.map((e: any) => e.id)).toEqual(ids.slice(1, 3));
  });
});
