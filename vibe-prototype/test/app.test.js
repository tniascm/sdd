import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MIGRATIONS, migrate } from '../src/db.js';
import { addDays, toDateStr } from '../src/time.js';
import { setAdmin } from '../src/users.js';

// Starts an app on a random port with an in-memory database (nothing is written to disk).
async function startServer(overrides = {}, options = {}) {
  const config = loadConfig({ dbPath: ':memory:', ...overrides });
  const { app, db } = createApp(config, options);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = () => new Promise((resolve) => server.close(() => (db.close(), resolve())));
  return { base, stop, config, db };
}

// Minimal browser stand-in: keeps cookies and the CSRF token from the last page.
class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
    this.csrf = '';
  }

  async request(method, path, form) {
    const headers = {};
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(this.base + path, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [name, value] = pair.split('=');
      if (!value || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    const token = /name="_csrf" value="([^"]+)"/.exec(text);
    if (token) this.csrf = token[1];
    return { status: res.status, location: res.headers.get('location'), headers: res.headers, text };
  }

  get(path) {
    return this.request('GET', path);
  }

  post(path, form = {}) {
    return this.request('POST', path, { _csrf: this.csrf, ...form });
  }

  login(email, password = 'correct-horse') {
    return this.post('/login', { email, password });
  }

  async signup(name, email, password = 'correct-horse') {
    const res = await this.post('/signup', { name, email, password });
    await this.get('/'); // pick up the CSRF token
    return res;
  }

  book(roomId, date, start, duration = 60) {
    return this.post('/bookings', { room_id: roomId, date, start, duration });
  }
}

const today = toDateStr(new Date());
const tomorrow = addDays(today, 1);
const count = (text, re) => [...text.matchAll(re)].length;

describe('RoomBook', () => {
  let server;
  let alice;
  let bob;

  before(async () => {
    server = await startServer();
    alice = new Client(server.base);
    bob = new Client(server.base);
  });
  after(() => server.stop());

  test('anonymous visitors are sent to the login page', async () => {
    const res = await new Client(server.base).get('/');
    assert.equal(res.status, 302);
    assert.equal(res.location, '/login');
  });

  test('signup validates input', async () => {
    const c = new Client(server.base);
    const cases = [
      [{ email: 'not-an-email', password: 'longenough' }, /valid email/],
      [{ email: 'x@uni.example', password: 'short' }, /at least 8 characters/],
      [{ email: 'x@uni.example', password: 'password123' }, /too easy to guess/],
      [{ email: 'qwerty@uni.example', password: 'Qwertyuiop' }, /too easy to guess/],
      [{ email: 'xavier99@uni.example', password: 'xavier99' }, /too easy to guess/],
    ];
    for (const [input, message] of cases) {
      const res = await c.post('/signup', { name: 'X', ...input });
      assert.equal(res.status, 400, JSON.stringify(input));
      assert.match(res.text, message);
    }
  });

  test('students can sign up and see the room grid', async () => {
    const res = await alice.signup('Alice', 'Alice@Uni.example');
    assert.equal(res.status, 302);
    assert.equal(res.location, '/');
    const page = await alice.get('/');
    assert.equal(page.status, 200);
    assert.match(page.text, /Quiet Room A/);
    assert.match(page.text, /Group Room 1/);
    assert.ok(!page.text.includes('href="/admin"'), 'students do not see the admin link');
    await bob.signup('Bob <script>alert(1)</script>', 'bob@uni.example');
  });

  test('user-supplied text is HTML-escaped', async () => {
    const page = await bob.get('/');
    assert.ok(!page.text.includes('<script>alert(1)</script>'));
    assert.match(page.text, /Bob &lt;script&gt;/);
  });

  test('duplicate emails are rejected (case-insensitive)', async () => {
    const res = await new Client(server.base).post('/signup', { name: 'A2', email: 'alice@uni.example', password: 'password-xyz' });
    assert.equal(res.status, 409);
  });

  test('login checks the password', async () => {
    const c = new Client(server.base);
    let res = await c.login('alice@uni.example', 'wrong-password');
    assert.equal(res.status, 401);
    assert.match(res.text, /incorrect/);
    res = await c.login('ALICE@uni.example');
    assert.equal(res.status, 302);
    assert.equal((await c.get('/')).status, 200);
  });

  test('booking a free slot works and shows up everywhere', async () => {
    const res = await alice.book(1, tomorrow, '10:00', 60);
    assert.equal(res.status, 302);
    assert.equal(res.location, '/my?ok=booked');

    const my = await alice.get('/my?ok=booked');
    assert.match(my.text, /Room booked/);
    assert.match(my.text, /10:00–11:00/);
    assert.match(my.text, /Quiet Room A/);

    assert.match((await alice.get(`/?date=${tomorrow}`)).text, /Your booking/);
    const bobView = (await bob.get(`/?date=${tomorrow}`)).text;
    assert.match(bobView, /Booked/);
    assert.ok(!bobView.includes('Your booking'));
  });

  test('a room cannot be double-booked', async () => {
    const res = await bob.book(1, tomorrow, '10:30', 60);
    assert.equal(res.status, 409);
    assert.match(res.text, /already booked/);
  });

  test('back-to-back bookings are allowed', async () => {
    const res = await bob.book(1, tomorrow, '11:00', 60);
    assert.equal(res.status, 302);
  });

  test('a student cannot be in two rooms at once', async () => {
    const res = await alice.book(2, tomorrow, '10:30', 30);
    assert.equal(res.status, 409);
    assert.match(res.text, /another booking that overlaps/);
  });

  test('booking rules are enforced', async () => {
    const cases = [
      [{ start: '10:00', duration: 150 }, /at most 2 h/],
      [{ start: '10:15', duration: 60 }, /valid start time/],
      [{ start: '21:30', duration: 60 }, /between 08:00 and 22:00/],
      [{ start: '07:00', duration: 60 }, /between 08:00 and 22:00/],
      [{ date: addDays(today, -1) }, /already passed/],
      [{ date: addDays(today, 15) }, /14 days ahead/],
      [{ date: '2026-02-30' }, /valid date/],
      [{ room: 999 }, /choose a room/],
    ];
    for (const [input, message] of cases) {
      const res = await bob.book(input.room ?? 3, input.date ?? tomorrow, input.start ?? '14:00', input.duration ?? 60);
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(input)}`);
      assert.match(res.text, message);
    }
  });

  test('students can hold at most 3 upcoming bookings', async () => {
    assert.equal((await alice.book(2, tomorrow, '13:00')).status, 302);
    assert.equal((await alice.book(3, tomorrow, '15:00')).status, 302);
    const res = await alice.book(4, tomorrow, '17:00');
    assert.equal(res.status, 409);
    assert.match(res.text, /at most 3 upcoming bookings/);
  });

  test('students can cancel their own bookings only', async () => {
    const my = await alice.get('/my');
    const ids = [...my.text.matchAll(/action="\/bookings\/(\d+)\/cancel"/g)].map((m) => m[1]);
    assert.equal(ids.length, 3);

    let res = await bob.post(`/bookings/${ids[0]}/cancel`);
    assert.equal(res.location, '/my?err=cancel_failed');

    res = await alice.post(`/bookings/${ids[0]}/cancel`);
    assert.equal(res.location, '/my?ok=cancelled');
    assert.equal(count((await alice.get('/my')).text, /\/cancel"/g), 2);

    // The freed-up slot can now be booked by someone else.
    assert.equal((await bob.book(1, tomorrow, '10:00', 60)).status, 302);
  });

  test('form posts without the CSRF token are refused', async () => {
    const res = await alice.request('POST', '/bookings', { room_id: 5, date: tomorrow, start: '09:00', duration: 30 });
    assert.equal(res.status, 403);
  });

  test('logging out ends the session', async () => {
    const c = new Client(server.base);
    await c.login('bob@uni.example');
    await c.get('/');
    const res = await c.post('/logout');
    assert.equal(res.location, '/login');
    assert.equal((await c.get('/')).location, '/login');
  });

  test('unknown pages return 404 and odd flash codes are ignored', async () => {
    assert.equal((await alice.get('/nope')).status, 404);
    assert.equal((await alice.get('/my?ok=__proto__')).status, 200);
  });
});

describe('email domain', () => {
  let server;
  before(async () => {
    server = await startServer();
  });
  after(() => server.stop());

  test('only @uni.example addresses can sign up', async () => {
    const c = new Client(server.base);
    for (const email of ['eve@example.com', 'dan@student.uni.example', 'dan@uni.example.com']) {
      const res = await c.post('/signup', { name: 'Eve', email, password: 'long-password' });
      assert.equal(res.status, 400, email);
      assert.match(res.text, /@uni\.example/);
    }
    const res = await c.post('/signup', { name: 'Dan', email: 'dan@uni.example', password: 'long-password' });
    assert.equal(res.status, 302);
  });
});

describe('time-dependent rules', () => {
  // Pretend it is 10:15 on a fixed day.
  const fixedNow = new Date(2030, 0, 15, 10, 15);
  const day = toDateStr(fixedNow);
  let server;
  let c;

  before(async () => {
    server = await startServer({}, { now: () => fixedNow });
    c = new Client(server.base);
    await c.signup('Carol', 'carol@uni.example');
  });
  after(() => server.stop());

  test('the slot in progress can still be booked, earlier ones cannot', async () => {
    assert.equal((await c.book(1, day, '09:30', 30)).status, 400);
    assert.equal((await c.book(1, day, '10:00', 30)).status, 302);
  });

  test('past slots are not offered in the grid', async () => {
    const page = (await c.get(`/?date=${day}`)).text;
    assert.ok(!page.includes(`start=09:30`));
    assert.ok(page.includes(`start=10:30`));
  });
});

describe('admin: rooms and maintenance closures', () => {
  let server;
  let admin;
  let sam;

  before(async () => {
    server = await startServer();
    admin = new Client(server.base);
    sam = new Client(server.base);
    await admin.signup('Fran Facilities', 'fran@uni.example');
    await sam.signup('Sam', 'sam@uni.example');
  });
  after(() => server.stop());

  test('students cannot use the admin page', async () => {
    assert.equal((await sam.get('/admin')).status, 403);
    assert.equal((await sam.post('/admin/rooms', { name: 'Sneaky', capacity: 2 })).status, 403);
    assert.equal((await new Client(server.base).get('/admin')).location, '/login');
  });

  test('admin rights are granted by the make-admin helper', async () => {
    assert.equal(setAdmin(server.db, 'nobody@uni.example', true), null);
    assert.equal(setAdmin(server.db, 'FRAN@uni.example', true).email, 'fran@uni.example');
    const page = await admin.get('/admin');
    assert.equal(page.status, 200);
    assert.match(page.text, /Add a room/);
    assert.match(page.text, /href="\/admin"/);
  });

  test('admins can add rooms, which students can then book', async () => {
    let res = await admin.post('/admin/rooms', { name: 'Room 42', location: 'Tower', capacity: '8', features: 'Quiet' });
    assert.equal(res.location, '/admin?ok=room_added');
    assert.match((await sam.get('/')).text, /Room 42/);

    res = await admin.post('/admin/rooms', { name: 'room 42', capacity: '3' });
    assert.equal(res.status, 400);
    assert.match(res.text, /already a room called/);
    res = await admin.post('/admin/rooms', { name: 'Tiny', capacity: '0' });
    assert.equal(res.status, 400);
    assert.match(res.text, /between 1 and 500/);
    res = await admin.post('/admin/rooms', { name: '  ', capacity: '2' });
    assert.equal(res.status, 400);
  });

  test('closing a room cancels its bookings and tells the students', async () => {
    assert.equal((await sam.book(2, tomorrow, '10:00')).status, 302);
    assert.equal((await sam.book(3, tomorrow, '12:00')).status, 302);

    const res = await admin.post('/admin/rooms/2/close', { from: tomorrow, until: tomorrow, reason: 'Broken window' });
    assert.equal(res.location, '/admin?ok=closed&n=1');
    assert.match((await admin.get(res.location)).text, /1 booking was cancelled/);

    const my = (await sam.get('/my')).text;
    assert.match(my, /Quiet Room B .* was cancelled because the room is closed \(Broken window\)/);
    assert.equal(count(my, /\/cancel"/g), 1, 'the booking in the other room is kept');

    const grid = (await sam.get(`/?date=${tomorrow}`)).text;
    assert.match(grid, /<strong>Closed<\/strong><small>Broken window<\/small>/);

    const again = await sam.book(2, tomorrow, '15:00');
    assert.equal(again.status, 409);
    assert.match(again.text, /closed on that day \(Broken window\)/);
    assert.equal((await sam.book(2, addDays(today, 2), '10:00')).status, 302, 'other days are unaffected');
  });

  test('closure dates are validated', async () => {
    let res = await admin.post('/admin/rooms/3/close', { from: addDays(today, -1), reason: 'x' });
    assert.equal(res.status, 400);
    assert.match(res.text, /cannot start in the past/);
    res = await admin.post('/admin/rooms/3/close', { from: addDays(today, 3), until: addDays(today, 2) });
    assert.equal(res.status, 400);
    assert.match(res.text, /on or after the first day/);
  });

  test('students can dismiss notices', async () => {
    const my = (await sam.get('/my')).text;
    const id = /action="\/notices\/(\d+)\/dismiss"/.exec(my)[1];
    // Someone else cannot dismiss Sam's notice.
    await admin.post(`/notices/${id}/dismiss`, { back: '/my' });
    assert.match((await sam.get('/my')).text, /was cancelled because/);

    let res = await sam.post(`/notices/${id}/dismiss`, { back: 'https://evil.example' });
    assert.equal(res.location, '/');
    res = await sam.get('/my');
    assert.ok(!res.text.includes('was cancelled because'));
  });

  test('reopening a room makes it bookable again', async () => {
    const page = (await admin.get('/admin')).text;
    assert.match(page, /Broken window/);
    const id = /action="\/admin\/closures\/(\d+)\/delete"/.exec(page)[1];
    const res = await admin.post(`/admin/closures/${id}/delete`);
    assert.equal(res.location, '/admin?ok=reopened');
    assert.equal((await sam.book(2, tomorrow, '15:00')).status, 302);
  });

  test('a room can be closed until further notice', async () => {
    const res = await admin.post('/admin/rooms/4/close', { from: today, until: '', reason: '' });
    assert.equal(res.location, '/admin?ok=closed&n=0');
    const page = (await admin.get('/admin')).text;
    assert.match(page, /until further notice · Maintenance/);
    assert.match(page, /Closed today/);
    const later = await sam.book(4, addDays(today, 10), '10:00');
    assert.equal(later.status, 409);
    assert.match(later.text, /closed on that day/);
  });
});

describe('GDPR: data export and account deletion', () => {
  let server;
  let gina;
  let hal;

  before(async () => {
    server = await startServer();
    gina = new Client(server.base);
    hal = new Client(server.base);
    await gina.signup('Gina', 'gina@uni.example');
    await hal.signup('Hal', 'hal@uni.example');
    assert.equal((await gina.book(1, tomorrow, '10:00')).status, 302);
    assert.equal((await hal.book(2, tomorrow, '10:00')).status, 302);
  });
  after(() => server.stop());

  test('the account page offers export and deletion', async () => {
    const page = await gina.get('/account');
    assert.equal(page.status, 200);
    assert.match(page.text, /gina@uni\.example/);
    assert.match(page.text, /Download my data/);
    assert.match(page.text, /Delete my account/);
  });

  test('students can download everything stored about them', async () => {
    const res = await gina.get('/account/export');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="?roombook-data-\d{4}-\d{2}-\d{2}\.json"?/);
    assert.match(res.headers.get('content-type'), /application\/json/);
    const data = JSON.parse(res.text);
    assert.equal(data.account.email, 'gina@uni.example');
    assert.equal(data.account.name, 'Gina');
    assert.equal(data.bookings.length, 1);
    assert.deepEqual(
      { room: data.bookings[0].room, date: data.bookings[0].date, start: data.bookings[0].start, end: data.bookings[0].end },
      { room: 'Quiet Room A', date: tomorrow, start: '10:00', end: '11:00' }
    );
    assert.ok(!res.text.includes('scrypt'), 'password hash is not exported');
    assert.ok(!res.text.includes('hal@uni.example'), "other people's data is not exported");
  });

  test('a wrong password does not delete the account', async () => {
    const res = await gina.post('/account/delete', { password: 'not-my-password' });
    assert.equal(res.status, 401);
    assert.match(res.text, /was not deleted/);
    assert.equal((await gina.get('/account')).status, 200);
  });

  test('deleting the account removes the user and their bookings', async () => {
    const res = await gina.post('/account/delete', { password: 'correct-horse' });
    assert.equal(res.location, '/login?ok=deleted');
    assert.match((await gina.get('/login?ok=deleted')).text, /all of its data have been deleted/);
    assert.equal((await gina.get('/')).location, '/login');

    const db = server.db;
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'gina@uni.example'").get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 1, "only Hal's booking remains");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE email = 'gina@uni.example'").get().n, 0);

    assert.equal((await new Client(server.base).login('gina@uni.example')).status, 401);
    assert.match((await hal.get('/my')).text, /Quiet Room B/);
    // The slot Gina held is free again.
    assert.equal((await hal.book(1, tomorrow, '12:00')).status, 302);
  });
});

describe('password guessing protection', () => {
  let clock = new Date();
  let server;

  before(async () => {
    server = await startServer({ loginMaxAttempts: 3, loginLockMinutes: 15 }, { now: () => clock });
    await new Client(server.base).signup('Ivy', 'ivy@uni.example');
    await new Client(server.base).signup('Jay', 'jay@uni.example');
  });
  after(() => server.stop());

  test('an account is locked after too many wrong passwords', async () => {
    const c = new Client(server.base);
    for (let i = 0; i < 3; i++) assert.equal((await c.login('ivy@uni.example', `guess-${i}`)).status, 401);
    const res = await c.login('ivy@uni.example'); // even the right password is refused for now
    assert.equal(res.status, 429);
    assert.match(res.text, /Too many failed attempts\. Please wait 15 minutes/);
  });

  test('the lock expires after the lock window', async () => {
    clock = new Date(clock.getTime() + 16 * 60 * 1000);
    assert.equal((await new Client(server.base).login('ivy@uni.example')).status, 302);
  });

  test('a successful login resets the counter', async () => {
    const c = new Client(server.base);
    assert.equal((await c.login('ivy@uni.example', 'nope-1')).status, 401);
    assert.equal((await c.login('ivy@uni.example', 'nope-2')).status, 401);
    assert.equal((await c.login('ivy@uni.example')).status, 302);
    // Counter is back to zero, so a new wrong guess is just "incorrect", not locked.
    assert.equal((await new Client(server.base).login('ivy@uni.example', 'nope-3')).status, 401);
  });

  test('firing many guesses at once cannot get around the limit', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => new Client(server.base).login('jay@uni.example', `parallel-${i}`))
    );
    const statuses = results.map((r) => r.status).sort();
    assert.equal(statuses.filter((s) => s === 401).length, 3);
    assert.equal(statuses.filter((s) => s === 429).length, 7);
  });

  test('one IP address cannot try password after password across many accounts', async () => {
    const c = new Client(server.base);
    let blocked = false;
    for (let i = 0; i < 15 && !blocked; i++) {
      const res = await c.login(`user${i}@uni.example`, 'guess');
      blocked = res.status === 429;
    }
    assert.ok(blocked, 'IP should be blocked after 12 recent failures');
  });
});

describe('database upgrades', () => {
  test('a database from the first version is upgraded without losing data', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATIONS[0]); // what the first release created (user_version 0)
    db.prepare("INSERT INTO users (name, email, password_hash) VALUES ('Old', 'old@uni.example', 'x')").run();

    migrate(db);
    migrate(db); // running again is a no-op

    assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
    assert.deepEqual({ ...db.prepare('SELECT name, is_admin FROM users').get() }, { name: 'Old', is_admin: 0 });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM closures').get().n, 0);
    db.close();
  });
});
