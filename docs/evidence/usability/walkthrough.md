# T055 — Usability walkthrough (NFR-007, SC-002)

**Where:** real server (`node src/server.ts`, fresh database
seeded with `scripts/seed.ts`), Chromium driven by Playwright, viewport **360 × 740 px**.
**Method:** keyboard only — focus moved with `Tab`/`Shift+Tab`, actions with `Enter`, text entered into
the *focused* field (Playwright `fill`), select values by type-ahead. No pointer events were used.
One exception: picking "11:00" in the End list needs typing "11" within ~1 s; the tool's latency
between key presses was too long for that, so that one value was set with Playwright `selectOption`
on the focused element (a human types it in one go).

## Path (happy path, deliberate error steps excluded)

| Step | Keys | Result |
|---|---|---|
| Register | 5×Tab, email, Tab, name, Tab, password, Enter | "Account created. You can sign in now." — email pre-filled in sign-in form, focus moved to its password field |
| Sign in | password, Enter | focus moved to `<main>` |
| Find a room for 4 | 4×Tab, "4", Enter | 5 rooms listed; buttons named "Availability and booking for *Room*" |
| Open Aurora | 7×Tab, Enter | booking panel opens; focus on the date field, pre-set to tomorrow; free times loaded |
| Choose 10:00–11:00 for 4 | 5×Tab (3 date segments), "1" (→10:00), Tab, "11" (→11:00), Tab, "4", Enter | "Booked Aurora: … 10:00–11:00." and listed under My bookings |

≈ **40 keyboard actions**; the page never scrolled horizontally (`scrollWidth` = 360 at every step).
Screenshots: `01-register-field-error-360px.png`, `02-booked-360px-fullpage.png`.

## NFR-007 checks

| Check | Result |
|---|---|
| Every function reachable by keyboard | ✅ for the booking path (skip link, native form controls, visible focus ring) |
| 360 px wide | ✅ no horizontal scroll |
| Errors name the field/rule | ✅ "Password must be at least 12 characters." under the password field; "A booking must last at least 30 minutes and end after it starts." on the booking form; focus moved to the field in error |
| First booking in < 2 min (SC-002) | ⚠️ **not measurable by an agent** — tool latency dominates. **[TEAM]**: time 3–5 first-time users on this exact path and record the times here. |

## Findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| U-1 | Medium (usability) | Changing **Start** does not update **End**: after choosing Start 10:00 the End list still showed 09:00 and offered times before the start. The server rejects it with a clear message, but every first-time user who changes the start time hits an error. | `public/app.js` `renderAvailability` sets End only when availability is rendered; no `change` listener on `#booking-start` |
| U-2 | Low | Dates are formatted in the *browser's* locale ((non-English month name)) inside an English UI. | status line and My bookings |
| U-3 | Low | `GET /favicon.ico` → 404, logged as a console error on every page load. | browser console |
| U-4 | Info | Chromium hint: the account-deletion password form has no (hidden) username field, so password managers and assistive tech cannot tell which account it is for. | browser console (verbose) |

Positive observations: skip link; every input has a `<label>`; status messages in a live region;
focus management after register, sign-in, room selection and on validation errors; the date defaults
to tomorrow; room buttons have descriptive accessible names.
