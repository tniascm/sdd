// RoomBook UI — plain DOM, no framework. All user-supplied text is rendered with textContent.
'use strict';

const API = '/api/v1';
const TOKEN_KEY = 'roombook.token';

const state = {
  token: readToken(),
  user: null,
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
