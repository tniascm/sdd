import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import {
  SESSION_COOKIE,
  clearLoginFailures,
  createSession,
  destroySession,
  findSession,
  hashPassword,
  loginLockMinutes,
  purgeExpiredSessions,
  readCookie,
  recordLoginFailure,
  safeEqual,
  validateSignup,
  verifyPassword,
} from './auth.js';
import {
  BookingError,
  bookingWindow,
  cancelBooking,
  createBooking,
  dayGrid,
  durations,
  listRooms,
  slotStarts,
  userBookings,
} from './bookings.js';
import { openDatabase } from './db.js';
import { AdminError, addRoom, adminRooms, closeRoom, reopenClosure } from './rooms.js';
import { addDays, formatTime, isValidDate, parseTime, toDateStr } from './time.js';
import { deleteUser, dismissNotice, exportUserData, listNotices } from './users.js';
import * as views from './views.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Short codes in ?ok= / ?err= so arbitrary text can't be injected via the URL.
const FLASH = {
  booked: { type: 'success', text: 'Room booked. You can see it below.' },
  cancelled: { type: 'success', text: 'Booking cancelled.' },
  cancel_failed: { type: 'error', text: 'That booking could not be cancelled. It may have already ended.' },
  deleted: { type: 'success', text: 'Your account and all of its data have been deleted.' },
  room_added: { type: 'success', text: 'Room added. Students can book it now.' },
  reopened: { type: 'success', text: 'Closure removed. The room can be booked again for those days.' },
};

function flashFor(query) {
  if (query.ok === 'closed') {
    const n = Number.parseInt(query.n, 10) || 0;
    const cancelled = n === 1 ? '1 booking was' : `${n} bookings were`;
    return { type: 'success', text: `Room closed. ${cancelled} cancelled and the students were notified.` };
  }
  for (const key of [query.ok, query.err]) {
    if (typeof key === 'string' && Object.hasOwn(FLASH, key)) return FLASH[key];
  }
  return undefined;
}

const tooManyAttempts = (minutes) =>
  `Too many failed attempts. Please wait ${minutes === 1 ? '1 minute' : `${minutes} minutes`} and try again.`;

/**
 * Builds the Express app. `now` can be overridden in tests.
 * Returns { app, db } so callers can close the database.
 */
export function createApp(config, { now = () => new Date() } = {}) {
  const db = openDatabase(config);
  purgeExpiredSessions(db);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });
  app.use(express.static(publicDir, { maxAge: '1h' }));
  // Pages contain personal data, so browsers should not keep copies (e.g. on shared PCs).
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));

  // Load the logged-in user (if any) from the session cookie.
  app.use((req, res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    const session = findSession(db, token);
    if (session) {
      req.sessionToken = token;
      req.user = session.user;
      req.csrf = session.csrf;
    }
    res.locals.user = req.user;
    res.locals.csrf = req.csrf;
    res.locals.notices = req.user ? listNotices(db, req.user.id) : [];
    next();
  });

  // Every POST made while logged in must carry the session's CSRF token.
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.user && !safeEqual(req.body?._csrf, req.csrf)) {
      return res
        .status(403)
        .send(views.errorPage({ ...res.locals, title: 'Form expired', message: 'Please go back, reload the page and try again.' }));
    }
    next();
  });

  const requireUser = (req, res, next) => (req.user ? next() : res.redirect('/login'));

  const requireAdmin = (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!req.user.isAdmin) {
      return res
        .status(403)
        .send(views.errorPage({ ...res.locals, title: 'Admins only', message: 'You need an admin account to open this page.' }));
    }
    next();
  };

  const clientIp = (req) => req.ip || 'unknown';

  /**
   * Checks a password while limiting guesses. The attempt is counted *before* the
   * (slow) password check, so many parallel requests cannot slip past the limit;
   * it is forgotten again if the password turns out to be right.
   * Returns { ok } or { lockedFor } (minutes).
   */
  async function checkPasswordLimited(req, email, passwordHash, password) {
    const nowMs = now().getTime();
    const lockedFor = loginLockMinutes(db, config, email, clientIp(req), nowMs);
    if (lockedFor) return { lockedFor };
    recordLoginFailure(db, config, email, clientIp(req), nowMs);
    const ok = (await verifyPassword(password, passwordHash)) && Boolean(passwordHash);
    if (ok) clearLoginFailures(db, email);
    return { ok };
  }

  function startSession(res, userId) {
    const { token, maxAge } = createSession(db, config, userId);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      path: '/',
      maxAge,
    });
  }

  // --- Accounts ---

  app.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    res.send(views.loginPage({ flash: flashFor(req.query) }));
  });

  app.post('/login', async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase().slice(0, 254);
    const password = String(req.body.password ?? '');
    const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
    const { ok, lockedFor } = await checkPasswordLimited(req, email, user?.password_hash, password);
    if (lockedFor) {
      return res.status(429).send(views.loginPage({ error: tooManyAttempts(lockedFor), email }));
    }
    if (!user || !ok) {
      return res.status(401).send(views.loginPage({ error: 'Email or password is incorrect.', email }));
    }
    startSession(res, user.id);
    res.redirect('/');
  });

  app.get('/signup', (req, res) => {
    if (req.user) return res.redirect('/');
    res.send(views.signupPage({ emailDomain: config.emailDomain }));
  });

  app.post('/signup', async (req, res) => {
    const values = { name: req.body.name, email: req.body.email };
    const render = (status, error) =>
      res.status(status).send(views.signupPage({ error, values, emailDomain: config.emailDomain }));

    const { error, value } = validateSignup(req.body, config);
    if (error) return render(400, error);

    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(value.email)) {
      return render(409, 'An account with this email already exists. Try logging in.');
    }
    const passwordHash = await hashPassword(value.password);
    let userId;
    try {
      const result = db
        .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
        .run(value.name, value.email, passwordHash);
      userId = Number(result.lastInsertRowid);
    } catch (err) {
      if (/UNIQUE/i.test(err.message)) return render(409, 'An account with this email already exists. Try logging in.');
      throw err;
    }
    startSession(res, userId);
    res.redirect('/');
  });

  app.post('/logout', (req, res) => {
    if (req.sessionToken) destroySession(db, req.sessionToken);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.redirect('/login');
  });

  // --- Rooms & bookings ---

  app.get('/', requireUser, (req, res) => {
    const current = now();
    const { today, lastDay } = bookingWindow(config, current);
    let date = isValidDate(req.query.date) ? req.query.date : today;
    if (date < today) date = today;
    if (date > lastDay) date = lastDay;

    res.send(
      views.roomsPage({
        ...res.locals,
        flash: flashFor(req.query),
        grid: dayGrid(db, config, date, req.user.id, current),
        date,
        today,
        lastDay,
        prevDate: date > today ? addDays(date, -1) : null,
        nextDate: date < lastDay ? addDays(date, 1) : null,
        config,
      })
    );
  });

  function renderBookForm(req, res, { status = 200, error, values }) {
    const { today, lastDay } = bookingWindow(config, now());
    res.status(status).send(
      views.bookPage({
        ...res.locals,
        error,
        rooms: listRooms(db),
        values,
        slots: slotStarts(config),
        durations: durations(config),
        today,
        lastDay,
      })
    );
  }

  app.get('/book', requireUser, (req, res) => {
    const { today } = bookingWindow(config, now());
    const start = parseTime(req.query.start);
    renderBookForm(req, res, {
      values: {
        room: req.query.room,
        date: isValidDate(req.query.date) ? req.query.date : today,
        start: start === null ? formatTime(config.openHour * 60) : formatTime(start),
        duration: Math.min(60, config.maxBookingMinutes),
      },
    });
  });

  app.post('/bookings', requireUser, (req, res) => {
    const values = {
      room: req.body.room_id,
      date: req.body.date,
      start: req.body.start,
      duration: req.body.duration,
    };
    try {
      createBooking(
        db,
        config,
        { userId: req.user.id, roomId: values.room, date: values.date, start: values.start, duration: values.duration },
        now()
      );
    } catch (err) {
      if (err instanceof BookingError) return renderBookForm(req, res, { status: err.status, error: err.message, values });
      throw err;
    }
    res.redirect('/my?ok=booked');
  });

  app.get('/my', requireUser, (req, res) => {
    const { upcoming, past } = userBookings(db, req.user.id, now());
    res.send(
      views.myBookingsPage({
        ...res.locals,
        flash: flashFor(req.query),
        upcoming,
        past,
        config,
      })
    );
  });

  app.post('/bookings/:id/cancel', requireUser, (req, res) => {
    const ok = cancelBooking(db, req.user.id, req.params.id, now());
    res.redirect(ok ? '/my?ok=cancelled' : '/my?err=cancel_failed');
  });

  app.post('/notices/:id/dismiss', requireUser, (req, res) => {
    dismissNotice(db, req.user.id, req.params.id);
    const back = Object.values(views.PAGE_PATHS).includes(req.body.back) ? req.body.back : '/';
    res.redirect(back);
  });

  // --- Account: download data, delete account (GDPR) ---

  const accountRow = (userId) =>
    db.prepare('SELECT name, email, is_admin, created_at FROM users WHERE id = ?').get(userId);

  app.get('/account', requireUser, (req, res) => {
    res.send(views.accountPage({ ...res.locals, account: accountRow(req.user.id) }));
  });

  app.get('/account/export', requireUser, (req, res) => {
    const data = exportUserData(db, req.user.id);
    res.attachment(`roombook-data-${toDateStr(now())}.json`);
    res.type('application/json');
    res.send(JSON.stringify(data, null, 2));
  });

  app.post('/account/delete', requireUser, async (req, res) => {
    const render = (status, error) =>
      res.status(status).send(views.accountPage({ ...res.locals, error, account: accountRow(req.user.id) }));

    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const { ok, lockedFor } = await checkPasswordLimited(
      req,
      req.user.email,
      row?.password_hash,
      String(req.body.password ?? '')
    );
    if (lockedFor) return render(429, tooManyAttempts(lockedFor));
    if (!ok) return render(401, 'That password is not correct. Your account was not deleted.');

    deleteUser(db, req.user.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.redirect('/login?ok=deleted');
  });

  // --- Admin: rooms and closures ---

  function renderAdmin(req, res, { status = 200, flash, values } = {}) {
    const current = now();
    res.status(status).send(
      views.adminPage({ ...res.locals, flash, values, rooms: adminRooms(db, current), today: toDateStr(current) })
    );
  }

  const adminError = (req, res, err, values) => {
    if (!(err instanceof AdminError)) throw err;
    renderAdmin(req, res, { status: 400, flash: { type: 'error', text: err.message }, values });
  };

  app.get('/admin', requireAdmin, (req, res) => {
    renderAdmin(req, res, { flash: flashFor(req.query) });
  });

  app.post('/admin/rooms', requireAdmin, (req, res) => {
    try {
      addRoom(db, req.body);
    } catch (err) {
      return adminError(req, res, err, req.body);
    }
    res.redirect('/admin?ok=room_added');
  });

  app.post('/admin/rooms/:id/close', requireAdmin, (req, res) => {
    let result;
    try {
      result = closeRoom(
        db,
        { roomId: req.params.id, from: req.body.from, until: req.body.until, reason: req.body.reason },
        now()
      );
    } catch (err) {
      return adminError(req, res, err);
    }
    res.redirect(`/admin?ok=closed&n=${result.cancelled}`);
  });

  app.post('/admin/closures/:id/delete', requireAdmin, (req, res) => {
    reopenClosure(db, req.params.id);
    res.redirect('/admin?ok=reopened');
  });

  // --- Fallbacks ---

  app.use((req, res) => {
    res
      .status(404)
      .send(views.errorPage({ ...res.locals, title: 'Page not found', message: 'That page does not exist.' }));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
      return res.status(413).send(views.errorPage({ ...res.locals, title: 'Too much data', message: 'That form was too large.' }));
    }
    console.error(err);
    res
      .status(500)
      .send(views.errorPage({ ...res.locals, title: 'Something went wrong', message: 'Please try again in a moment.' }));
  });

  return { app, db };
}
