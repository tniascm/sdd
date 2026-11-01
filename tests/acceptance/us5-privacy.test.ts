// Verifier (T045) — User Story 5: control my personal data. Spec: FR-018, FR-019, NFR-009, SC-006.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, at, TODAY, TOMORROW, PASSWORD, TEST_ADMIN, type Harness, type TestUser } from '../support/harness.ts';

let h: Harness;
let room: any;
let zelda: TestUser;
let bob: TestUser;

beforeEach(async () => {
  h = await startHarness();
  room = await h.createRoom({ name: 'Ivy' });
  zelda = await h.newUser({ email: 'zelda.unique@uni.example', displayName: 'Zelda Uniquename' });
  bob = await h.newUser();
});
afterEach(() => h.close());

/** Every row of every table, serialised — used to prove that erasure leaves nothing behind (SC-006). */
function dumpDatabase(): string {
  const db = h.container.db;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  return tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t.name}"`).all())).join('\n');
}

describe('US5 — Control my personal data', () => {
  it('US5-1 (FR-018): the export contains my profile and all my bookings and nothing about other users', async () => {
    await h.book(zelda, { roomId: room.id, start: at(TOMORROW, '10:00'), end: at(TOMORROW, '11:00'), purpose: 'Thesis' });
    const c = (await h.book(zelda, { roomId: room.id, start: at(TOMORROW, '12:00'), end: at(TOMORROW, '13:00') })).body;
    await zelda.api.post(`/bookings/${c.id}/cancel`);
    await h.book(bob, { roomId: room.id, start: at(TOMORROW, '14:00'), end: at(TOMORROW, '15:00') });

    const r = await zelda.api.get('/me/export');
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ id: zelda.id, email: zelda.email, displayName: 'Zelda Uniquename' });
    expect(r.body.bookings).toHaveLength(2);
    expect(r.text).not.toContain(bob.email);
    expect(r.text).not.toContain(bob.id);
  });

  it('US5-2 (FR-019, SC-006): after erasure the user cannot sign in, sessions end, and no stored data names them', async () => {
    await h.book(zelda, { roomId: room.id, start: at(TODAY, '09:00'), end: at(TODAY, '10:00'), purpose: "Zelda Uniquename's revision" });
    h.clock.set(at(TODAY, '11:00')); // that booking is now in the past

    const r = await zelda.api.post('/me/erase', { password: PASSWORD });
    expect(r.status).toBe(204);

    expect((await zelda.api.get('/me')).status).toBe(401);
    const login = await h.anon.post('/auth/login', { email: zelda.email, password: PASSWORD });
    expect(login.status).toBe(401);

    const day = await h.admin.api.get(`/admin/bookings?date=${TODAY}`);
    expect(day.body.bookings).toHaveLength(1);
    expect(day.body.bookings[0].booker).toBeNull();
    expect(day.body.bookings[0].purpose).toBeNull();

    const dump = dumpDatabase();
    expect(dump).not.toContain('zelda.unique@uni.example');
    expect(dump).not.toContain('Zelda Uniquename');
  });

  it('US5-3 (FR-019): upcoming bookings are cancelled on erasure and their slots become free', async () => {
    await h.book(zelda, { roomId: room.id, start: at(TOMORROW, '10:00'), end: at(TOMORROW, '11:00') });
    expect((await zelda.api.post('/me/erase', { password: PASSWORD })).status).toBe(204);
    const avail = await bob.api.get(`/rooms/${room.id}/availability?date=${TOMORROW}`);
    expect(avail.body.booked).toEqual([]);
    expect((await h.book(bob, { roomId: room.id, start: at(TOMORROW, '10:00'), end: at(TOMORROW, '11:00') })).status).toBe(201);
  });
});

describe('US5 — edge cases', () => {
  it('a wrong password does not erase the account', async () => {
    const r = await zelda.api.post('/me/erase', { password: 'not my password' });
    expect([r.status, r.body.error?.code]).toEqual([403, 'PASSWORD_INCORRECT']);
    expect((await zelda.api.get('/me')).status).toBe(200);
  });

  it('the only administrator cannot erase their account', async () => {
    const r = await h.admin.api.post('/me/erase', { password: TEST_ADMIN.password });
    expect([r.status, r.body.error?.code]).toEqual([409, 'LAST_ADMIN']);
  });

  it('a missing password is a validation error', async () => {
    expect((await zelda.api.post('/me/erase', {})).status).toBe(400);
  });

  it('erasure is audit-logged with the pseudonymous id only', async () => {
    await zelda.api.post('/me/erase', { password: PASSWORD });
    const audit = await h.admin.api.get('/admin/audit-events?limit=200');
    const ev = audit.body.events.find((e: any) => e.action === 'user.erased');
    expect(ev).toBeDefined();
    expect(audit.text).not.toContain('zelda');
  });
});
