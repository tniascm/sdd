// Verifier (T048) — every operation documented in contracts/openapi.yaml is implemented and
// answers with a contract-valid response (the harness validates each response automatically).
import { afterAll, expect, it } from 'vitest';
import { startHarness, at, TOMORROW, PASSWORD } from '../support/harness.ts';
import { documentedOperations, exercised } from '../support/contract.ts';

it('all 21 documented operations respond according to the contract', async () => {
  const h = await startHarness();
  try {
    const u = await h.newUser(); // register + login + (no role change)
    const room = await h.createRoom({ name: 'Contract Room' });
    const admin = h.admin.api;

    await h.anon.get('/health');
    await u.api.get('/me');
    await u.api.get('/rooms');
    await u.api.get(`/rooms/${room.id}/availability?date=${TOMORROW}`);
    await admin.patch(`/rooms/${room.id}`, { building: 'Annex' });
    const b = await h.book(u, { roomId: room.id, start: at(TOMORROW, '10:00'), end: at(TOMORROW, '11:00') });
    expect(b.status).toBe(201);
    await u.api.get('/bookings/mine');
    await u.api.post(`/bookings/${b.body.id}/cancel`);
    await admin.post(`/rooms/${room.id}/out-of-service`);
    await admin.post(`/rooms/${room.id}/in-service`);
    await admin.get('/admin/rooms');
    await admin.get(`/admin/bookings?date=${TOMORROW}`);
    await admin.get('/admin/users?email=user');
    await admin.put(`/admin/users/${u.id}/role`, { role: 'staff' });
    await admin.get('/admin/audit-events');
    await u.api.get('/me/export');
    const other = await h.newUser();
    await other.api.post('/auth/logout');
    await u.api.post('/me/erase', { password: PASSWORD });
  } finally {
    h.close();
  }
});

afterAll(() => {
  expect(documentedOperations).toHaveLength(21);
  const missing = documentedOperations.filter((op) => !exercised.has(op));
  expect(missing).toEqual([]);
});
