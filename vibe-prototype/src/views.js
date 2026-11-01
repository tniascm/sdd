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

// Where "Dismiss" on a notice returns to; the server only accepts these paths.
export const PAGE_PATHS = { rooms: '/', my: '/my', admin: '/admin', account: '/account' };

function noticeList(notices, csrf, active) {
  if (!notices?.length) return '';
  return html`<div class="notices">
    ${notices.map(
      (n) => html`<div class="alert notice" role="status">
      <span>${n.message}</span>
      <form method="post" action="/notices/${n.id}/dismiss">
        ${csrfField(csrf)}
        <input type="hidden" name="back" value="${PAGE_PATHS[active] ?? '/'}">
        <button type="submit" class="link-button">Dismiss</button>
      </form>
    </div>`
    )}
  </div>`;
}

function layout({ title, user, csrf, notices, active, flash, body }) {
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
          ? html`<nav class="nav">
        ${navLink('/', 'Book a room', 'rooms')}${navLink('/my', 'My bookings', 'my')}
        ${user.isAdmin ? navLink('/admin', 'Admin', 'admin') : ''}
      </nav>
      <form class="logout" method="post" action="/logout">
        ${csrfField(csrf)}
        <a class="who" href="/account"${active === 'account' ? html` aria-current="page"` : ''}>${user.name}</a>
        <button type="submit" class="link-button">Log out</button>
      </form>`
          : ''
      }
    </div>
  </header>
  <main class="wrap">
    ${noticeList(notices, csrf, active)}
    ${alert(flash)}
    ${body}
  </main>
</body>
</html>`.value;
}

// --- Auth pages ---

export function loginPage({ error, email, flash }) {
  return layout({
    title: 'Log in',
    flash,
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
            placeholder="you@${emailDomain}">
          <small class="muted">Only @${emailDomain} addresses can sign up.</small>
        </label>
        <label>Password <input type="password" name="password" minlength="8" autocomplete="new-password" required>
          <small class="muted">At least 8 characters. Avoid common passwords.</small>
        </label>
        <button type="submit" class="btn primary">Create account</button>
      </form>
      <p class="muted small">We store your name, email and bookings. You can download or delete them at any time
        from your account page.</p>
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
    case 'closed':
      return html`<td class="cell closed"${span}><strong>Closed</strong><small>${cell.label}</small></td>`;
    default:
      return html`<td class="cell past" aria-label="Unavailable"></td>`;
  }
}

export function roomsPage({ user, csrf, notices, flash, grid, date, today, lastDay, prevDate, nextDate, config }) {
  const { rooms, rows } = grid;
  return layout({
    title: 'Book a room',
    user,
    csrf,
    notices,
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
        ? html`<div class="card empty">No rooms have been set up yet.${
            user.isAdmin ? html` <a href="/admin">Add one on the admin page.</a>` : ''
          }</div>`
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

export function bookPage({ user, csrf, notices, error, rooms, values, slots, durations, today, lastDay }) {
  const selected = (a, b) => (String(a) === String(b) ? html` selected` : '');
  return layout({
    title: 'Book a room',
    user,
    csrf,
    notices,
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

export function myBookingsPage({ user, csrf, notices, flash, upcoming, past, config }) {
  return layout({
    title: 'My bookings',
    user,
    csrf,
    notices,
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

export function errorPage({ user, csrf, notices, title, message }) {
  return layout({
    title,
    user,
    csrf,
    notices,
    body: html`<section class="card narrow">
      <h1>${title}</h1>
      <p>${message}</p>
      <p><a href="/">Back to rooms</a></p>
    </section>`,
  });
}

// --- Admin ---

function closureRange(c) {
  if (!c.end_date) return `From ${formatDate(c.start_date)}, until further notice`;
  if (c.end_date === c.start_date) return formatDate(c.start_date);
  return `${formatDate(c.start_date)} – ${formatDate(c.end_date)}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function adminRoom(r, csrf, today) {
  return html`<li class="card admin-room">
    <div class="admin-room-head">
      <div>
        <span class="room-name">${r.name}</span>
        <span class="room-meta">${r.location}${r.location ? ' · ' : ''}Seats ${r.capacity}${r.features ? ` · ${r.features}` : ''}</span>
      </div>
      <span class="badge ${r.closedToday ? 'closed' : 'open'}">${r.closedToday ? 'Closed today' : 'Open'}</span>
    </div>
    <p class="muted small">${plural(r.upcomingBookings, 'upcoming booking')}</p>
    ${
      r.closures.length
        ? html`<ul class="closures">
      ${r.closures.map(
        (c) => html`<li>
        <span><strong>Closed:</strong> ${closureRange(c)} · ${c.reason}</span>
        <form method="post" action="/admin/closures/${c.id}/delete">
          ${csrfField(csrf)}
          <button type="submit" class="link-button">Reopen</button>
        </form>
      </li>`
      )}
    </ul>`
        : ''
    }
    <details>
      <summary>Close for maintenance</summary>
      <form method="post" action="/admin/rooms/${r.id}/close" class="stack">
        ${csrfField(csrf)}
        <div class="row">
          <label>First day <input type="date" name="from" value="${today}" min="${today}" required></label>
          <label>Last day <input type="date" name="until" min="${today}">
            <small class="muted">Leave empty to close until further notice.</small>
          </label>
        </div>
        <label>Reason <input type="text" name="reason" value="Maintenance" maxlength="200"></label>
        <p class="muted small">Bookings in this period will be cancelled and the students will see a notice.</p>
        <div><button type="submit" class="btn danger">Close room</button></div>
      </form>
    </details>
  </li>`;
}

export function adminPage({ user, csrf, notices, flash, rooms, today, values = {} }) {
  return layout({
    title: 'Admin',
    user,
    csrf,
    notices,
    active: 'admin',
    flash,
    body: html`<h1>Admin</h1>
    <p class="muted">Add study rooms and close them for maintenance. Closed rooms cannot be booked.</p>
    <section>
      <h2>Rooms</h2>
      ${
        rooms.length
          ? html`<ul class="admin-rooms">${rooms.map((r) => adminRoom(r, csrf, today))}</ul>`
          : html`<div class="card empty">No rooms yet. Add the first one below.</div>`
      }
    </section>
    <section>
      <h2>Add a room</h2>
      <form method="post" action="/admin/rooms" class="card stack add-room">
        ${csrfField(csrf)}
        <div class="row">
          <label class="grow">Name <input type="text" name="name" value="${values.name}" maxlength="80" required></label>
          <label>Seats <input type="number" name="capacity" value="${values.capacity ?? 4}" min="1" max="500" required></label>
        </div>
        <label>Location <input type="text" name="location" value="${values.location}" maxlength="120"
          placeholder="e.g. Main Library, Floor 3"></label>
        <label>Features <input type="text" name="features" value="${values.features}" maxlength="200"
          placeholder="e.g. Whiteboard, TV screen"></label>
        <div><button type="submit" class="btn primary">Add room</button></div>
      </form>
    </section>`,
  });
}

// --- Account (data export and deletion) ---

export function accountPage({ user, csrf, notices, error, account }) {
  return layout({
    title: 'Your account',
    user,
    csrf,
    notices,
    active: 'account',
    body: html`<h1>Your account</h1>
    <div class="cards">
      <section class="card">
        <dl class="facts">
          <dt>Name</dt><dd>${account.name}</dd>
          <dt>Email</dt><dd>${account.email}</dd>
          <dt>Member since</dt><dd>${formatDate(account.created_at.slice(0, 10))}</dd>
          <dt>Role</dt><dd>${account.is_admin ? 'Admin' : 'Student'}</dd>
        </dl>
      </section>
      <section class="card">
        <h2>Download your data</h2>
        <p>Get a copy of everything RoomBook stores about you as a JSON file. That covers your profile, bookings and
          notices, plus any recent failed logins to your account.</p>
        <a class="btn" href="/account/export">Download my data</a>
      </section>
      <section class="card danger-zone" id="delete">
        <h2>Delete your account</h2>
        <p>This permanently deletes your account, all of your bookings and your notices. It cannot be undone.</p>
        ${alert(error && { type: 'error', text: error })}
        <form method="post" action="/account/delete" class="stack">
          ${csrfField(csrf)}
          <label>Enter your password to confirm
            <input type="password" name="password" autocomplete="current-password" required>
          </label>
          <div><button type="submit" class="btn danger">Delete my account</button></div>
        </form>
      </section>
    </div>`,
  });
}
