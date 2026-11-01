// Implementer — US3 scenarios whose Verifier versions move the clock more than 8 h past sign-in
// (see the Phase 3–8 report). Same assertions, but the user signs in again after the jump,
// because FR-002 ends every session 8 hours after sign-in.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOUR } from '../support/fixed-clock.ts';
import { at, startHarness, TOMORROW, type Harness, type TestUser } from '../support/harness.ts';

let h: Harness;
let room: { id: string };
let alice: TestUser;

beforeEach(async () => {
  h = await startHarness();
  room = await h.createRoom({ capacity: 6 });
  alice = await h.newUser();
});
afterEach(() => h.close());

const tomorrow = (from: string, to: string) => ({ roomId: room.id, start: at(TOMORROW, from), end: at(TOMORROW, to) });
const againAs = async (u: TestUser) => h.as(await h.login(u.email));

describe('FR-002 interplay', () => {
  it('a session from yesterday morning is refused the next day (why the Verifier variants get 401)', async () => {
    h.clock.set(at(TOMORROW, '10:00'));
    expect((await alice.api.get('/bookings/mine')).status).toBe(401);
  });
});

describe('FR-013 / FR-014 with a fresh session after the clock jump', () => {
  it('US3-2: a booking that has already started cannot be cancelled by its owner', async () => {
    const b = (await h.book(alice, tomorrow('10:00', '11:00'))).body;
    h.clock.set(at(TOMORROW, '10:00'));
    const r = await (await againAs(alice)).post(`/bookings/${b.id}/cancel`);
    expect([r.status, r.body.error?.code]).toEqual([422, 'ALREADY_STARTED']);
  });

  it('include=all lists cancelled and past bookings with their status, in start order', async () => {
    const first = (await h.book(alice, tomorrow('08:00', '09:00'))).body;
    const second = (await h.book(alice, tomorrow('12:00', '13:00'))).body;
    await alice.api.post(`/bookings/${second.id}/cancel`);
    h.clock.set(at(TOMORROW, '09:30'));
    const api = await againAs(alice);
    expect((await api.get('/bookings/mine')).body.bookings).toEqual([]);
    const all = await api.get('/bookings/mine?include=all');
    expect(all.body.bookings.map((b: { id: string; status: string }) => [b.id, b.status])).toEqual([
      [first.id, 'confirmed'],
      [second.id, 'cancelled'],
    ]);
  });

  it('an ended booking no longer counts toward the quota', async () => {
    for (const [f, t] of [['08:00', '09:00'], ['10:00', '11:00'], ['12:00', '13:00']]) {
      expect((await h.book(alice, tomorrow(f, t))).status).toBe(201);
    }
    h.clock.set(at(TOMORROW, '09:00'));
    h.clock.advance(1 * HOUR);
    const api = await againAs(alice);
    expect((await api.post('/bookings', { ...tomorrow('15:00', '16:00'), partySize: 2 })).status).toBe(201);
  });
});
