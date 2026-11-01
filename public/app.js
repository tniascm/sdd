// RoomBook UI — plain DOM, no framework. All user-supplied text is rendered with textContent.
'use strict';

const API = '/api/v1';
const TOKEN_KEY = 'roombook.token';

const state = {
  token: readToken(),
  user: null,
  /** Campus time zone, learned from the first availability response (the server's CAMPUS_TIME_ZONE). */
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  /** The room currently open in the booking section. */
  room: null,
};

// ------------------------------------------------------------------ helpers

function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function writeToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable: the session lasts until reload */ }
}

const $ = (selector, root = document) => root.querySelector(selector);

/** Creates an element; `text` is always assigned through textContent. */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = String(value);
    else if (key === 'className') node.className = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

class ApiError extends Error {
  constructor(status, error) {
    super(error?.message || `Request failed (${status}).`);
    this.status = status;
    this.code = error?.code || 'UNKNOWN';
    this.details = Array.isArray(error?.details) ? error.details : [];
  }
}

async function api(method, path, body) {
  const headers = {};
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: 'The server could not be reached. Check your connection.' });
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && state.token && path !== '/auth/login') {
      signedOut('Your session has ended. Please sign in again.');
    }
    throw new ApiError(res.status, data?.error);
  }
  return data;
}

function setStatus(message, isError = false) {
  const status = $('#status');
  status.textContent = message || '';
  status.classList.toggle('error', Boolean(isError));
}

/** Shows `error.details[].field` next to the matching field; anything else at the top of the form. */
function showErrors(form, error) {
  clearErrors(form);
  const unplaced = [];
  for (const d of error.details || []) {
    const slot = form.querySelector(`[data-error-for="${CSS.escape(d.field)}"]`);
    if (slot) {
      slot.textContent = d.message;
      const input = form.querySelector(`[name="${CSS.escape(d.field)}"]`);
      if (input) {
        if (!slot.id) slot.id = `${form.id}-${d.field}-error`;
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', slot.id);
      }
    } else {
      unplaced.push(`${d.field}: ${d.message}`);
    }
  }
  const formError = form.querySelector('[data-error-for="_form"]');
  const message = unplaced.length ? `${error.message} ${unplaced.join(' ')}` : error.message;
  if (formError) formError.textContent = error.details?.length && !unplaced.length ? '' : message;
  const firstInvalid = form.querySelector('[aria-invalid="true"]');
  if (firstInvalid) {
    firstInvalid.focus();
  } else if (formError && formError.textContent) {
    formError.setAttribute('tabindex', '-1');
    formError.focus();
  } else {
    setStatus(message, true);
  }
}

function clearErrors(form) {
  for (const slot of form.querySelectorAll('[data-error-for]')) slot.textContent = '';
  for (const input of form.querySelectorAll('[aria-invalid]')) {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

/** Wires a form: prevents reload, clears errors, shows API errors next to their fields. */
function onSubmit(form, handler) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      await handler(formValues(form), form);
    } catch (err) {
      if (err instanceof ApiError) showErrors(form, err);
      else throw err;
    } finally {
      if (button) button.disabled = false;
    }
  });
}

// ------------------------------------------------------------------ session (US2)

const signedInHandlers = [];

function signedIn(user) {
  state.user = user;
  $('#auth-view').hidden = true;
  $('#app-view').hidden = false;
  $('#session-bar').hidden = false;
  $('#session-user').textContent = `${user.displayName} (${user.role})`;
  for (const node of document.querySelectorAll('[data-admin-only]')) node.hidden = user.role !== 'admin';
  for (const handler of signedInHandlers) handler(user);
}

function signedOut(message) {
  state.token = null;
  state.user = null;
  writeToken(null);
  $('#auth-view').hidden = false;
  $('#app-view').hidden = true;
  $('#session-bar').hidden = true;
  $('#session-user').textContent = '';
  for (const node of document.querySelectorAll('[data-admin-only]')) node.hidden = true;
  setStatus(message || '');
}

onSubmit($('#login-form'), async (values, form) => {
  const session = await api('POST', '/auth/login', { email: values.email, password: values.password });
  state.token = session.token;
  writeToken(session.token);
  form.reset();
  setStatus(`Signed in. Your session lasts until ${formatDateTime(session.expiresAt)}.`);
  signedIn(session.user);
  $('#main').focus();
});

onSubmit($('#register-form'), async (values, form) => {
  const user = await api('POST', '/auth/register', {
    email: values.email,
    displayName: values.displayName,
    password: values.password,
  });
  form.reset();
  setStatus('Account created. You can sign in now.');
  $('#login-email').value = user.email;
  $('#login-password').focus();
});

$('#logout-button').addEventListener('click', async () => {
  try { await api('POST', '/auth/logout'); } catch { /* the session is dropped locally either way */ }
  signedOut('You have signed out.');
  $('#login-email').focus();
});

// ------------------------------------------------------------------ campus time (mirrors src/domain/campus-time.ts)

function wallClock(instant, timeZone) {
  const parts = {};
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  for (const p of fmt.formatToParts(instant)) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return parts;
}

/** Campus-local date ("YYYY-MM-DD") + time ("HH:MM") → ISO UTC string (two-pass offset). */
function campusToUtc(date, time, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (t) => {
    const w = wallClock(t, timeZone);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(t / 1000) * 1000;
  };
  const first = offsetAt(naive);
  let instant = naive - first;
  const second = offsetAt(instant);
  if (second !== first) instant = naive - second;
  return new Date(instant).toISOString();
}

function campusDate(instant, timeZone) {
  const w = wallClock(instant, timeZone);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString(undefined, { timeZone: state.timeZone, hour: '2-digit', minute: '2-digit' });
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString(undefined, {
    timeZone: state.timeZone, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  });
}

function formatSlot(item) {
  return `${formatDate(item.start)}, ${formatTime(item.start)}–${formatTime(item.end)}`;
}

/** "HH:MM" values from `from` to `to` in 30-minute steps. */
function halfHours(from, to) {
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out = [];
  for (let m = toMin(from); m <= toMin(to); m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

// ------------------------------------------------------------------ rooms (US1, FR-005)

const EQUIPMENT_LABELS = {
  whiteboard: 'Whiteboard',
  projector: 'Projector',
  'display-screen': 'Display screen',
  'video-conferencing': 'Video conferencing',
};

function roomFilterQuery(form) {
  const params = new URLSearchParams();
  const data = new FormData(form);
  const minCapacity = String(data.get('minCapacity') || '').trim();
  const building = String(data.get('building') || '').trim();
  const equipment = data.getAll('equipment');
  if (minCapacity) params.set('minCapacity', minCapacity);
  if (building) params.set('building', building);
  if (equipment.length) params.set('equipment', equipment.join(','));
  const query = params.toString();
  return query ? `?${query}` : '';
}

async function loadRooms() {
  const form = $('#room-filter-form');
  clearErrors(form);
  try {
    const { rooms } = await api('GET', `/rooms${roomFilterQuery(form)}`);
    renderRooms(rooms);
  } catch (err) {
    if (err instanceof ApiError) showErrors(form, err);
    else throw err;
  }
}

function renderRooms(rooms) {
  const list = $('#room-list');
  list.replaceChildren();
  if (rooms.length === 0) {
    list.append(el('li', { className: 'muted', text: 'No rooms match these filters.' }));
    return;
  }
  for (const room of rooms) {
    const equipment = room.equipment.length ? room.equipment.map((e) => EQUIPMENT_LABELS[e] || e).join(', ') : 'no equipment';
    const button = el('button', { type: 'button', text: 'Availability and booking' });
    button.setAttribute('aria-label', `Availability and booking for ${room.name}`);
    button.addEventListener('click', () => openRoom(room));
    list.append(el('li', {}, [
      el('div', { className: 'row' }, [
        el('div', {}, [
          el('strong', { text: room.name }),
          el('div', { className: 'muted', text: `${room.building} · up to ${room.capacity} people · ${equipment}` }),
        ]),
        button,
      ]),
    ]));
  }
}

onSubmit($('#room-filter-form'), () => loadRooms());

// ------------------------------------------------------------------ availability and booking (US1, FR-006, FR-009)

function tomorrowLocal() {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return campusDate(d.getTime(), state.timeZone);
}

function openRoom(room) {
  state.room = room;
  $('#book-room-name').textContent = room.name;
  $('#book-section').hidden = false;
  const dateInput = $('#availability-date');
  if (!dateInput.value) dateInput.value = tomorrowLocal();
  $('#booking-party').max = String(room.capacity);
  loadAvailability().then(() => $('#book-heading').scrollIntoView({ block: 'start' }));
  dateInput.focus();
}

async function loadAvailability() {
  const form = $('#availability-form');
  clearErrors(form);
  const date = $('#availability-date').value;
  if (!state.room) return;
  try {
    const a = await api('GET', `/rooms/${encodeURIComponent(state.room.id)}/availability?date=${encodeURIComponent(date)}`);
    state.timeZone = a.timeZone;
    renderAvailability(a);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    showErrors(form, err);
    if (err.code === 'NOT_FOUND') {
      setStatus('This room is no longer available for booking.', true);
      $('#book-section').hidden = true;
      loadRooms();
    }
  }
}

function renderAvailability(a) {
  $('#availability-summary').textContent =
    `${a.date}: open ${a.opens}–${a.closes} (${a.timeZone}). Booked times do not show who booked them.`;
  const render = (list, items, emptyText) => {
    list.replaceChildren();
    if (items.length === 0) list.append(el('li', { className: 'muted', text: emptyText }));
    for (const i of items) list.append(el('li', { text: `${formatTime(i.start)}–${formatTime(i.end)}` }));
  };
  render($('#free-list'), a.free, 'No free time on this date.');
  render($('#booked-list'), a.booked, 'Nothing booked yet.');

  const start = $('#booking-start');
  const end = $('#booking-end');
  const previous = { start: start.value, end: end.value };
  const options = (select, times) => select.replaceChildren(...times.map((t) => el('option', { value: t, text: t })));
  const slots = halfHours(a.opens, a.closes);
  options(start, slots.slice(0, -1));
  options(end, slots.slice(1));
  if (previous.start && slots.includes(previous.start)) start.value = previous.start;
  if (previous.end && slots.includes(previous.end)) end.value = previous.end;
  else end.selectedIndex = Math.min(start.selectedIndex + 1, end.options.length - 1);
  $('#booking-form').dataset.date = a.date;
}

onSubmit($('#availability-form'), () => loadAvailability());

onSubmit($('#booking-form'), async (values, form) => {
  const date = form.dataset.date;
  const body = {
    roomId: state.room.id,
    start: campusToUtc(date, values.start, state.timeZone),
    end: campusToUtc(date, values.end, state.timeZone),
    partySize: Number(values.partySize),
  };
  if (values.purpose) body.purpose = values.purpose;
  const booking = await api('POST', '/bookings', body);
  setStatus(`Booked ${booking.roomName}: ${formatSlot(booking)}.`);
  $('#booking-purpose').value = '';
  await Promise.all([loadAvailability(), loadMine()]);
});

// ------------------------------------------------------------------ my bookings (FR-013)

async function loadMine() {
  const { bookings } = await api('GET', '/bookings/mine');
  renderMine(bookings);
}

function renderMine(bookings) {
  const list = $('#mine-list');
  list.replaceChildren();
  if (bookings.length === 0) {
    list.append(el('li', { className: 'muted', text: 'You have no upcoming bookings.' }));
    return;
  }
  for (const b of bookings) {
    const details = [el('strong', { text: b.roomName }), ' ', formatSlot(b), ` · ${b.partySize} people`];
    const item = el('li', {}, [el('div', {}, details)]);
    if (b.purpose) item.append(el('div', { className: 'muted', text: `Purpose: ${b.purpose}` }));
    list.append(item);
  }
}

signedInHandlers.push(() => {
  loadRooms();
  loadMine();
});

// ------------------------------------------------------------------ formatting

function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ------------------------------------------------------------------ start

async function start() {
  if (!state.token) return signedOut();
  try {
    signedIn(await api('GET', '/me'));
  } catch {
    signedOut();
  }
}

start();
