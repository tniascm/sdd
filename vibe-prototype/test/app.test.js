import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { addDays, toDateStr } from '../src/time.js';

// Starts an app on a random port with an in-memory database.
async function startServer(overrides = {}, options = {}) {
  const config = loadConfig({ dbPath: ':memory:', ...overrides });
  const { app, db } = createApp(config, options);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = () => new Promise((resolve) => server.close(() => (db.close(), resolve())));
  return { base, stop, config };
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
    return { status: res.status, location: res.headers.get('location'), text };
  }

  get(path) {
    return this.request('GET', path);
  }

  post(path, form = {}) {
    return this.request('POST', path, { _csrf: this.csrf, ...form });
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
    let res = await c.post('/signup', { name: 'X', email: 'not-an-email', password: 'longenough' });
    assert.equal(res.status, 400);
    assert.match(res.text, /valid email/);
    res = await c.post('/signup', { name: 'X', email: 'x@uni.edu', password: 'short' });
    assert.equal(res.status, 400);
    assert.match(res.text, /at least 8 characters/);
  });

  test('students can sign up and see the room grid', async () => {
    const res = await alice.signup('Alice', 'Alice@Uni.edu');
    assert.equal(res.status, 302);
    assert.equal(res.location, '/');
    const page = await alice.get('/');
    assert.equal(page.status, 200);
    assert.match(page.text, /Quiet Room A/);
    assert.match(page.text, /Group Room 1/);
    await bob.signup('Bob <script>alert(1)</script>', 'bob@uni.edu');
  });

  test('user-supplied text is HTML-escaped', async () => {
    const page = await bob.get('/');
    assert.ok(!page.text.includes('<script>alert(1)</script>'));
    assert.match(page.text, /Bob &lt;script&gt;/);
  });

  test('duplicate emails are rejected (case-insensitive)', async () => {
    const res = await new Client(server.base).post('/signup', { name: 'A2', email: 'alice@uni.edu', password: 'password123' });
    assert.equal(res.status, 409);
  });

  test('login checks the password', async () => {
    const c = new Client(server.base);
    let res = await c.post('/login', { email: 'alice@uni.edu', password: 'wrong-password' });
    assert.equal(res.status, 401);
    assert.match(res.text, /incorrect/);
    res = await c.post('/login', { email: 'ALICE@uni.edu', password: 'correct-horse' });
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
    const after = await alice.get('/my');
    assert.equal([...after.text.matchAll(/\/cancel"/g)].length, 2);

    // The freed-up slot can now be booked by someone else.
    assert.equal((await bob.book(1, tomorrow, '10:00', 60)).status, 302);
  });

  test('form posts without the CSRF token are refused', async () => {
    const res = await alice.request('POST', '/bookings', { room_id: 5, date: tomorrow, start: '09:00', duration: 30 });
    assert.equal(res.status, 403);
  });

  test('logging out ends the session', async () => {
    const c = new Client(server.base);
    await c.post('/login', { email: 'bob@uni.edu', password: 'correct-horse' });
    await c.get('/');
    const res = await c.post('/logout');
    assert.equal(res.location, '/login');
    assert.equal((await c.get('/')).location, '/login');
  });

  test('unknown pages return 404', async () => {
    assert.equal((await alice.get('/nope')).status, 404);
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
    await c.signup('Carol', 'carol@uni.edu');
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

describe('email domain restriction', () => {
  let server;
  before(async () => {
    server = await startServer({ emailDomain: 'myuni.edu' });
  });
  after(() => server.stop());

  test('only university addresses can sign up', async () => {
    const c = new Client(server.base);
    let res = await c.post('/signup', { name: 'Eve', email: 'eve@gmail.com', password: 'password123' });
    assert.equal(res.status, 400);
    assert.match(res.text, /@myuni\.edu/);
    res = await c.post('/signup', { name: 'Dan', email: 'dan@student.myuni.edu', password: 'password123' });
    assert.equal(res.status, 302);
  });
});
