import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  findSession,
  hashPassword,
  purgeExpiredSessions,
  readCookie,
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
import { addDays, formatTime, isValidDate, parseTime } from './time.js';
import * as views from './views.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Short codes in ?ok= / ?err= so arbitrary text can't be injected via the URL.
const FLASH = {
  booked: { type: 'success', text: 'Room booked. You can see it below.' },
  cancelled: { type: 'success', text: 'Booking cancelled.' },
  cancel_failed: { type: 'error', text: 'That booking could not be cancelled. It may have already ended.' },
};

/**
 * Builds the Express app. `now` can be overridden in tests.
 * Returns { app, db } so callers can close the database.
 */
export function createApp(config, { now = () => new Date() } = {}) {
  const db = openDatabase(config);
  purgeExpiredSessions(db);

  const app = express();
  app.disable('x-powered-by');

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
    res.send(views.loginPage({}));
  });

  app.post('/login', async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');
    const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
    const ok = await verifyPassword(password, user?.password_hash);
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
        flash: FLASH[req.query.ok] || FLASH[req.query.err],
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
        flash: FLASH[req.query.ok] || FLASH[req.query.err],
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
