// Verifier (T027) — NFR-006 / SC-003: concurrent bookings of the same slot produce exactly one winner.
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startHarness, at, TOMORROW, type Harness } from '../support/harness.ts';
import { checkContract } from '../support/contract.ts';

let h: Harness;
beforeEach(async () => { h = await startHarness(); });
afterEach(() => h.close());

it('SC-003: 20 simultaneous requests for the same free slot → exactly 1 confirmed, 19 SLOT_UNAVAILABLE', async () => {
  const room = await h.createRoom({ capacity: 4 });
  const users = [];
  for (let i = 0; i < 20; i++) users.push(await h.newUser());

  const server = h.app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const body = JSON.stringify({ roomId: room.id, start: at(TOMORROW, '14:00'), end: at(TOMORROW, '15:00'), partySize: 2 });
    const results = await Promise.all(
      users.map((u) =>
        fetch(`http://127.0.0.1:${port}/api/v1/bookings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${u.token}` },
          body,
        }).then(async (r) => ({ status: r.status, body: await r.json() })),
      ),
    );
    for (const r of results) checkContract('POST', '/api/v1/bookings', r.status, r.body);

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const losers = results.filter((r) => r.status !== 201);
    expect(losers).toHaveLength(19);
    expect(new Set(losers.map((r) => `${r.status} ${r.body.error.code}`))).toEqual(new Set(['409 SLOT_UNAVAILABLE']));
  } finally {
    server.close();
  }

  const availability = await users[0].api.get(`/rooms/${room.id}/availability?date=${TOMORROW}`);
  expect(availability.body.booked).toEqual([{ start: '2026-11-03T12:00:00.000Z', end: '2026-11-03T13:00:00.000Z' }]);
});
