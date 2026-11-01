import { formatDate, formatDuration, formatTime } from './time.js';

// --- Tiny HTML templating: every interpolated value is escaped unless it is already Html. ---

class Html {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escape(value) {
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(escape).join('');
  if (value === null || value === undefined || value === false) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += escape(v) + strings[i + 1];
  });
  return new Html(out);
}

// --- Shared pieces ---

const csrfField = (csrf) => html`<input type="hidden" name="_csrf" value="${csrf}">`;

function alert(flash) {
  if (!flash) return '';
  return html`<div class="alert ${flash.type}" role="${flash.type === 'error' ? 'alert' : 'status'}">${flash.text}</div>`;
}

function layout({ title, user, csrf, active, flash, body }) {
  const navLink = (href, label, key) =>
    html`<a href="${href}"${active === key ? html` aria-current="page"` : ''}>${label}</a>`;

  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · RoomBook</title>
  <link rel="stylesheet" href="/style.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
  <header class="topbar">
    <div class="wrap topbar-inner">
      <a class="brand" href="/">RoomBook</a>
      ${
        user
          ? html`<nav class="nav">${navLink('/', 'Book a room', 'rooms')}${navLink('/my', 'My bookings', 'my')}</nav>
      <form class="logout" method="post" action="/logout">
        ${csrfField(csrf)}
        <span class="who">${user.name}</span>
        <button type="submit" class="link-button">Log out</button>
      </form>`
          : ''
      }
    </div>
  </header>
  <main class="wrap">
    ${alert(flash)}
    ${body}
  </main>
</body>
</html>`.value;
}

// --- Auth pages ---

export function loginPage({ error, email }) {
  return layout({
    title: 'Log in',
    body: html`<section class="card narrow">
      <h1>Log in</h1>
      <p class="muted">Book quiet rooms and group spaces around campus.</p>
      ${alert(error && { type: 'error', text: error })}
      <form method="post" action="/login" class="stack">
        <label>Email <input type="email" name="email" value="${email}" autocomplete="email" required autofocus></label>
        <label>Password <input type="password" name="password" autocomplete="current-password" required></label>
        <button type="submit" class="btn primary">Log in</button>
      </form>
      <p class="muted">New here? <a href="/signup">Create an account</a></p>
    </section>`,
  });
}

export function signupPage({ error, values = {}, emailDomain }) {
  return layout({
    title: 'Create account',
    body: html`<section class="card narrow">
      <h1>Create an account</h1>
      ${alert(error && { type: 'error', text: error })}
      <form method="post" action="/signup" class="stack">
        <label>Full name <input type="text" name="name" value="${values.name}" maxlength="80" autocomplete="name" required autofocus></label>
        <label>University email
          <input type="email" name="email" value="${values.email}" autocomplete="email" required
            placeholder="${emailDomain ? `you@${emailDomain}` : 'you@university.edu'}">
        </label>
        <label>Password <input type="password" name="password" minlength="8" autocomplete="new-password" required>
          <small class="muted">At least 8 characters.</small>
        </label>
        <button type="submit" class="btn primary">Create account</button>
      </form>
      <p class="muted">Already have an account? <a href="/login">Log in</a></p>
    </section>`,
  });
}

// --- Room grid ---

function gridCell(cell, room, date) {
  if (cell.hidden) return '';
  const span = cell.span > 1 ? html` rowspan="${cell.span}"` : '';
  switch (cell.state) {
    case 'free': {
      const time = formatTime(cell.start);
      const href = `/book?room=${room.id}&date=${date}&start=${time}`;
      return html`<td class="cell free"><a href="${href}" aria-label="Book ${room.name} at ${time}">Book</a></td>`;
    }
    case 'mine':
      return html`<td class="cell mine"${span}><strong>Your booking</strong><small>${cell.label}</small></td>`;
    case 'booked':
      return html`<td class="cell booked"${span}><span>Booked</span><small>${cell.label}</small></td>`;
    default:
      return html`<td class="cell past" aria-label="Unavailable"></td>`;
  }
}

export function roomsPage({ user, csrf, flash, grid, date, today, lastDay, prevDate, nextDate, config }) {
  const { rooms, rows } = grid;
  return layout({
    title: 'Book a room',
    user,
    csrf,
    active: 'rooms',
    flash,
    body: html`<div class="page-head">
      <div>
        <h1>Study rooms</h1>
        <p class="muted">${formatDate(date)}${date === today ? ' (today)' : ''}. Pick a free slot to book it.</p>
      </div>
      <form class="day-picker" method="get" action="/">
        ${
          prevDate
            ? html`<a class="btn" href="/?date=${prevDate}" aria-label="Previous day">&larr;</a>`
            : html`<span class="btn disabled" aria-hidden="true">&larr;</span>`
        }
        <input type="date" name="date" value="${date}" min="${today}" max="${lastDay}" aria-label="Date">
        <button type="submit" class="btn">Show</button>
        ${
          nextDate
            ? html`<a class="btn" href="/?date=${nextDate}" aria-label="Next day">&rarr;</a>`
            : html`<span class="btn disabled" aria-hidden="true">&rarr;</span>`
        }
      </form>
    </div>

    ${
      rooms.length === 0
        ? html`<div class="card empty">No rooms have been set up yet. Add them to <code>rooms.json</code> and restart.</div>`
        : html`<div class="grid-wrap">
      <table class="grid">
        <thead>
          <tr>
            <th class="time" scope="col">Time</th>
            ${rooms.map(
              (r) => html`<th scope="col">
              <span class="room-name">${r.name}</span>
              <span class="room-meta">${r.location}</span>
              <span class="room-meta">Seats ${r.capacity}${r.features ? html` · ${r.features}` : ''}</span>
            </th>`
            )}
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (row) => html`<tr>
            <th class="time" scope="row">${formatTime(row.start)}</th>
            ${row.cells.map((cell, i) => gridCell(cell, rooms[i], date))}
          </tr>`
          )}
        </tbody>
      </table>
    </div>`
    }
    <p class="muted small">
      Rooms open ${formatTime(config.openHour * 60)}–${formatTime(config.closeHour * 60)}.
      Book up to ${formatDuration(config.maxBookingMinutes)} at a time, up to ${config.bookingWindowDays} days ahead,
      with at most ${config.maxActiveBookings} upcoming bookings.
    </p>`,
  });
}

// --- Booking form ---

export function bookPage({ user, csrf, error, rooms, values, slots, durations, today, lastDay }) {
  const selected = (a, b) => (String(a) === String(b) ? html` selected` : '');
  return layout({
    title: 'Book a room',
    user,
    csrf,
    active: 'rooms',
    body: html`<section class="card narrow">
      <h1>Book a room</h1>
      ${alert(error && { type: 'error', text: error })}
      <form method="post" action="/bookings" class="stack">
        ${csrfField(csrf)}
        <label>Room
          <select name="room_id" required>
            ${rooms.map(
              (r) =>
                html`<option value="${r.id}"${selected(r.id, values.room)}>${r.name} (${r.location}, seats ${r.capacity})</option>`
            )}
          </select>
        </label>
        <label>Date <input type="date" name="date" value="${values.date}" min="${today}" max="${lastDay}" required></label>
        <div class="row">
          <label>Start time
            <select name="start" required>
              ${slots.map((m) => {
                const t = formatTime(m);
                return html`<option value="${t}"${selected(t, values.start)}>${t}</option>`;
              })}
            </select>
          </label>
          <label>Length
            <select name="duration" required>
              ${durations.map(
                (d) => html`<option value="${d}"${selected(d, values.duration)}>${formatDuration(d)}</option>`
              )}
            </select>
          </label>
        </div>
        <div class="actions">
          <button type="submit" class="btn primary">Confirm booking</button>
          <a href="/?date=${values.date}">Back to rooms</a>
        </div>
      </form>
    </section>`,
  });
}

// --- My bookings ---

function bookingItem(b, csrf, canCancel) {
  return html`<li class="booking">
    <div>
      <div class="booking-when">${formatDate(b.date)} · ${formatTime(b.start_min)}–${formatTime(b.end_min)}</div>
      <div class="booking-where">${b.room_name} <span class="muted">· ${b.room_location}</span></div>
    </div>
    ${
      canCancel
        ? html`<form method="post" action="/bookings/${b.id}/cancel">
        ${csrfField(csrf)}
        <button type="submit" class="btn danger">Cancel</button>
      </form>`
        : ''
    }
  </li>`;
}

export function myBookingsPage({ user, csrf, flash, upcoming, past, config }) {
  return layout({
    title: 'My bookings',
    user,
    csrf,
    active: 'my',
    flash,
    body: html`<h1>My bookings</h1>
    <section>
      <h2>Upcoming <span class="muted small">(${upcoming.length} of ${config.maxActiveBookings})</span></h2>
      ${
        upcoming.length
          ? html`<ul class="bookings">${upcoming.map((b) => bookingItem(b, csrf, true))}</ul>`
          : html`<div class="card empty">You have no upcoming bookings. <a href="/">Find a room</a></div>`
      }
    </section>
    ${
      past.length
        ? html`<section>
      <h2>Recent</h2>
      <ul class="bookings past">${past.map((b) => bookingItem(b, csrf, false))}</ul>
    </section>`
        : ''
    }`,
  });
}

// --- Errors ---

export function errorPage({ user, csrf, title, message }) {
  return layout({
    title,
    user,
    csrf,
    body: html`<section class="card narrow">
      <h1>${title}</h1>
      <p>${message}</p>
      <p><a href="/">Back to rooms</a></p>
    </section>`,
  });
}
