// Verifier (T036) — User Story 3: manage my bookings. Spec: FR-013, FR-014, NFR-003.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, at, TOMORROW, type Harness, type TestUser } from '../support/harness.ts';
import { HOUR } from '../support/fixed-clock.ts';

let h: Harness;
let room: any;
let alice: TestUser;
let bob: TestUser;

beforeEach(async () => {
  h = await startHarness();
  room = await h.createRoom({ capacity: 6 });
  alice = await h.newUser();
  bob = await h.newUser();
});
afterEach(() => h.close());

const tomorrow = (from: string, to: string) => ({ roomId: room.id, start: at(TOMORROW, from), end: at(TOMORROW, to) });

describe('US3 — Manage my bookings', () => {
  it('US3-1 (FR-014): cancelling before the start frees the slot, removes it from upcoming bookings and restores the quota', async () => {
    const ids = [];
    for (const [f, t] of [['08:00', '09:00'], ['10:00', '11:00'], ['12:00', '13:00']]) {
      ids.push((await h.book(alice, tomorrow(f, t))).body.id);
    }
    const c = await alice.api.post(`/bookings/${ids[1]}/cancel`);
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ id: ids[1], status: 'cancelled', cancelledBy: 'owner' });

    const upcoming = await alice.api.get('/bookings/mine');
    expect(upcoming.body.bookings.map((b: any) => b.id)).toEqual([ids[0], ids[2]]);

    const avail = await bob.api.get(`/rooms/${room.id}/availability?date=${TOMORROW}`);
    expect(avail.body.booked).toHaveLength(2);
    // quota restored: a third upcoming booking is allowed again
    expect((await h.book(alice, tomorrow('15:00', '16:00'))).status).toBe(201);
    // and the freed slot can be taken by someone else
    expect((await h.book(bob, tomorrow('10:00', '11:00'))).status).toBe(201);
  });

  it('US3-2 (FR-014): a booking that has already started cannot be cancelled by its owner', async () => {
    const b = (await h.book(alice, tomorrow('10:00', '11:00'))).body;
    h.clock.set(at(TOMORROW, '10:00'));
    alice = await h.relogin(alice); // the original session expired after 8 h (FR-002) — VF-5
    const r = await alice.api.post(`/bookings/${b.id}/cancel`);
    expect([r.status, r.body.error?.code]).toEqual([422, 'ALREADY_STARTED']);
  });

  it("US3-3 (FR-014, NFR-003): cancelling someone else's booking fails exactly like a missing booking and changes nothing", async () => {
    const b = (await h.book(alice, tomorrow('10:00', '11:00'))).body;
    const foreign = await bob.api.post(`/bookings/${b.id}/cancel`);
    const missing = await bob.api.post('/bookings/00000000-0000-4000-8000-000000000000/cancel');
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    const still = await alice.api.get('/bookings/mine');
    expect(still.body.bookings[0]).toMatchObject({ id: b.id, status: 'confirmed' });
  });
});

describe('US3 — listing and edge cases (FR-013)', () => {
  it('include=all lists cancelled and past bookings with their status, in start order', async () => {
    const first = (await h.book(alice, tomorrow('08:00', '09:00'))).body;
    const second = (await h.book(alice, tomorrow('12:00', '13:00'))).body;
    await alice.api.post(`/bookings/${second.id}/cancel`);
    h.clock.set(at(TOMORROW, '09:30')); // the first booking has ended
    alice = await h.relogin(alice); // the original session expired after 8 h (FR-002) — VF-5

    expect((await alice.api.get('/bookings/mine')).body.bookings).toEqual([]);
    const all = await alice.api.get('/bookings/mine?include=all');
    expect(all.body.bookings.map((b: any) => [b.id, b.status])).toEqual([
      [first.id, 'confirmed'],
      [second.id, 'cancelled'],
    ]);
  });

  it('an invalid include value is a validation error', async () => {
    expect((await alice.api.get('/bookings/mine?include=everything')).status).toBe(400);
  });

  it('cancelling twice is rejected', async () => {
    const b = (await h.book(alice, tomorrow('10:00', '11:00'))).body;
    await alice.api.post(`/bookings/${b.id}/cancel`);
    const again = await alice.api.post(`/bookings/${b.id}/cancel`);
    expect([again.status, again.body.error?.code]).toEqual([422, 'ALREADY_CANCELLED']);
  });

  it('an ended booking no longer counts toward the quota', async () => {
    for (const [f, t] of [['08:00', '09:00'], ['10:00', '11:00'], ['12:00', '13:00']]) {
      expect((await h.book(alice, tomorrow(f, t))).status).toBe(201);
    }
    h.clock.set(at(TOMORROW, '09:00'));
    h.clock.advance(1 * HOUR); // 10:00 — first booking ended, second just started
    alice = await h.relogin(alice); // the original session expired after 8 h (FR-002) — VF-5
    expect((await h.book(alice, tomorrow('15:00', '16:00'))).status).toBe(201);
  });
});
