# Independent audit: vibe-prototype vs. spec 001-room-booking

**Date:** 2026-11-01, 18:42–18:55 EET. `vibe-prototype/` itself was not changed (`diff -rq` against the audited copy is empty).
**Method:** I ran a scratch copy with `PORT=3901 TZ=Europe/Helsinki node src/server.js` (Node 26.8.2) and probed it with `curl`, cookie jars and CSRF tokens scraped from the forms. Three `fetch` scripts covered races, time zones and load: `race.mjs`, `dst.mjs`, `perf.mjs`. Admin rights came from `node scripts/make-admin.js`. The app cannot create past bookings, so for US5-2 one past booking was inserted straight into the copy's SQLite file. "Tomorrow" means 2026-11-02.
**Verdicts:** *Pass* means every clause is met. *Partial* means some clauses are met. *Fail* means the central outcome is contradicted. *Not implemented* means the function is absent.

## 1. Summary

| Pass | Partial | Fail | Not implemented |
|---:|---:|---:|---:|
| 12 | 7 | 2 | 2 |

The core booking path works: overlap detection, back-to-back bookings, opening hours, the 30-minute grid, the quota and owner-only cancellation. Escaping, CSRF on signed-in forms, parameterised SQL and the security headers are also correct, and 20 simultaneous requests for one slot produce exactly one booking. All 11 scenario deviations are **drift**, meaning rules the builder was never told: the 7-day student horizon, 8-hour sessions, a staff role, party size, a cancelled status with history, anonymisation on erasure, audit logging and the request limit. The **defects** are outside the scenarios:
- campus time comes from the host's time zone
- session tokens are stored in plain text
- sign-up and all other requests are unthrottled
- an IP-wide login lock locks out everyone behind a shared address

There are no High-severity findings and 5 Medium ones.

## 2. Acceptance scenarios

| ID | Verdict | Evidence | Class. |
|---|---|---|---|
| US1-1 | Partial | Room 3 (6 seats), tomorrow 10:00–11:00 → `302 /my?ok=booked`, listed in /my. Party size does not exist: there is no form field and no column (db.js:34-43), and `party_size=40` for a 2-seat room → 302. | drift |
| US1-2 | Pass | 10:30–11:30 by Bob → 409 "Sorry, that room is already booked for part of that time." (bookings.js:156-161) | – |
| US1-3 | Pass | 11:00–12:00 by Bob → 302 | – |
| US1-4 | Partial | Yesterday or today 17:00 → 400 "That time has already passed."; 10:15 → "valid start time"; 21:30+60 → "between 08:00 and 22:00". Party size is unchecked. A past start inside the current slot is accepted: at 18:44, 18:30–19:00 → 302 (bookings.js:31-35, 143). | drift |
| US1-5 | Pass | 4th booking → 409 "You can hold at most 3 upcoming bookings" (bookings.js:170-178) | – |
| US1-6 | Fail | 150 min → 400 "at most 2 h". 8 and 14 days ahead → 302 (window 14 days, config.js:35). There is no staff role, only `is_admin` (db.js:51), so a 240-min request → 400 and admins get student limits. | drift |
| US1-7 | Pass | Bob's grid shows "Booked 10:00–11:00", with 0 occurrences of other bookers' names and no booking ids (bookings.js:66-73) | – |
| US2-1 | Pass | `alice@uni.example` with a 16-character password → 302; role shown as "Student"; the password is never echoed. Off-spec: 8-character passwords are accepted (auth.js:43). | – |
| US2-2 | Pass | gmail.com, student.uni.example and uni.example.com → 400 "Please use your university email address" (auth.js:40) | – |
| US2-3 | Partial | Wrong password and unknown email get the same 401 "Email or password is incorrect.", both in 0.025 s (dummy hash, auth.js:15-23). The session lasts 7 days (`Max-Age=604800`, config.js:36). | drift |
| US2-4 | Partial | After 5 failures, a 6th attempt with the correct password → 429 "Please wait 15 minutes". The lock counts from the *first* failure (auth.js:138); a later lock said "wait 12 minutes". There is no audit log (7 tables, none for audit). | drift |
| US2-5 | Pass | After logout, replaying the saved cookie → 302 /login (app.js:212-216) | – |
| US3-1 | Partial | Cancel → `/my?ok=cancelled`; the slot can be booked again and the quota is restored. The row is DELETEd (bookings.js:193) and there is no status column, so nothing is "marked cancelled". | drift |
| US3-2 | Fail | Booking 18:30–19:00 made at 18:44 and then cancelled → `/my?ok=cancelled`. Cancelling is allowed until the booking ends (bookings.js:96, 193). | drift |
| US3-3 | Pass | Alice → Bob's #2 and Alice → nonexistent #99999 both return `302 /my?err=cancel_failed` with byte-identical bodies; #2 is unchanged (bookings.js:193) | – |
| US4-1 | Pass | Admin adds "Lab 7" (Science Building, 8 seats, projector) → 302 and it is visible to students. Off-spec: capacity 500 and free-text equipment are accepted (rooms.js:17-21). | – |
| US4-2 | Pass | Student: GET /admin, POST /admin/rooms, `/admin/rooms/1/close` and `/admin/closures/1/delete` → 403 (app.js:120-128) | – |
| US4-3 | Partial | Closing room 3 with reason "Room taken out of service" → `n=3`; later bookings → 409; owners get a notice. Frank's in-progress booking (18:30–19:00, closed at 18:45) was also cancelled (rooms.js:104). Bookings are deleted, and the room stays in the grid and in the /book list. | drift |
| US4-4 | Not impl. | `/admin/bookings` → 404; no booker names on any admin page (route list app.js:161-392) | drift |
| US4-5 | Not impl. | No staff role and no role UI; the admin flag can only be set from the shell (users.js:6-11) | drift |
| US5-1 | Pass | `/account/export` returns a JSON attachment with the profile and bookings and no other user's name or email. It also exports IPs of failed sign-ins to the account (users.js:37,58). | – |
| US5-2 | Partial | Wrong password → 401. Correct password → deleted; the old cookie → /login; sign-in → 401. The past booking was deleted, not anonymised (`ON DELETE CASCADE`, db.js:37). | drift |
| US5-3 | Pass | Dave's upcoming bookings are gone, and Carol then booked his 11-09 10:00 slot (302). They are deleted, so no "Account deleted" reason is recorded. | – |

## 3. Non-functional requirements

| NFR | Verdict | Evidence |
|---|---|---|
| 001 (measured) | Pass | 50 rooms, 5,000 bookings, 20 concurrent clients × 25 grid requests: p95 33–39 ms (`perf.mjs`) |
| 002 | Partial | Passwords use scrypt with a 16-byte salt (auth.js:8-12). Session tokens are stored verbatim (auth.js:64-72, db.js:18-23); the DB value equals the cookie. |
| 003 | Pass | Every booking, notice and account route filters by the session's user (bookings.js:193, users.js:18, app.js:325-346) |
| 004 | Fail | There is no contract. Unknown fields are ignored (`evil=1&role=admin` → 302). A missing or JSON body → 500 (app.js:167). The response is a generic page; stack traces go to the server log only. |
| 005 | Pass | Every response, including static files and 404s, carries CSP `default-src 'self'; frame-ancestors 'none'`, `nosniff` and `X-Frame-Options: DENY`. There are no inline scripts (app.js:76-84). |
| 006 | Pass | 20 users, same slot, at once: 1 × 302 and 19 × 409. One user asking for 20 slots at once ends with exactly 3. Synchronous SQLite inside `BEGIN IMMEDIATE` serialises them (db.js:126-136). |
| 008 | Partial | 96.7 % line coverage. The clock can be injected (app.js:68), but the rules sit inside the DB-bound `createBooking` (bookings.js:114-185). |
| 009 | Partial | Availability hides who booked. The app also stores IPs of failed logins (db.js:75-80). |
| 010 | Fail | 400 GETs in under 1 s → 400 × 200; 30 parallel sign-ups → 30 × 302. There is no limiter. |

## 4. Security review (spec-independent)

| # | Sev. | Finding and reproduction | Location |
|---|---|---|---|
| S1 | Medium | **No throttling outside login.** Every sign-up runs scrypt (memory-hard) with no limit, which makes CPU and memory exhaustion and bulk account creation cheap. 30 parallel sign-ups → all 302. | app.js:186-210 |
| S2 | Medium | **Plain-text session tokens.** `sessions.token` equals the cookie and the DB file is created `-rw-r--r--`, so whoever can read the DB or a backup can take over every live 7-day session. | auth.js:63-74, db.js:18-23 |
| S3 | Medium | **The IP-wide lock locks out innocent users.** After 20 failures from one address, a *different* user with the correct password gets 429. Behind a campus NAT, or a proxy without `TRUST_PROXY`, one person can lock everyone out, and the same lock blocks account deletion. Spoofed `X-Forwarded-For` is ignored. | auth.js:129-139, app.js:138-146, 337-343 |
| S4 | Medium | **No security event log (OWASP A09).** Lockouts, closures, deletions and brute-force runs leave no trace, and failed logins are pruned after 15 min. | auth.js:145 |
| S5 | Low | **Login CSRF.** `/login` and `/signup` accept a cross-site POST without a token or Origin check (`Origin: https://evil.example` → 302 plus a session), so a victim can be signed into the attacker's account. | app.js:109-110 |
| S6 | Low | **No `Secure` cookie flag by default** (`HttpOnly; SameSite=Lax` only) and no HSTS. | config.js:38, app.js:150-156 |
| S7 | Low | **Weak password policy:** 8 characters minimum and a 40-word blocklist. | auth.js:43-61 |
| S8 | Low | **A missing body crashes the handler** (TypeError → 500); nothing leaks. | app.js:167, auth.js:31 |

These checks found nothing wrong:
- **XSS:** markup in the display name, room name, location and features, the closure reason and the reflected email is always escaped (views.js:14-29).
- **SQL injection:** all statements are prepared; `1 OR 1=1` as an id is rejected.
- **IDOR:** see US3-3; dismissing a notice also checks the owner.
- **CSRF:** a missing or foreign token → 403.
- **Session fixation:** an attacker-chosen `sid` is ignored.
- **Open redirect:** an allow-list is used (app.js:312).
- **Sign-in enumeration, error leakage, clickjacking:** none.

## 5. Other defects

- **D1 (Medium): time zone.** Campus time is the host process's time zone (config.js:22, time.js:5-11), and bookings are stored as local date plus minutes with no zone (db.js:33-40). With `TZ=UTC` (`dst.mjs`, clock at 18:50 Helsinki time), 17:00 (already past on campus) and 21:30 (23:30 Helsinki) were both accepted. Restarting under another TZ shifts every booking without warning.
- **D2 (Low):** closures and account deletion physically delete bookings (rooms.js:109-117, db.js:37), so no usage history or record of who cancelled remains.
- **D3 (Low): erasure residue.** Just after the deletion, `dave@uni.example` still appeared 19 times in `audit.db-wal`, so SC-006 fails on a raw search.
- **D4 (Low): booking ids are reused** (no AUTOINCREMENT). Erin's cancelled #9 became Frank's #9; the owner check prevents harm.
- **D5 (Low): the last administrator can delete their own account** (no check in users.js:63-71). This is from reading the code; the S3 lock blocked a live test.
- **DST: no defect found.** With `TZ=Europe/Helsinki` and the clock at 2027-03-28 10:15 EEST (spring-forward day), 09:30 → 400 and 10:00 → 302, stored as wall-clock minutes. EU clock changes fall outside opening hours.
- **Races: none** (see NFR-006).

## 6. Test suite

`node --test test/` → 37/37 pass in 1.1 s, with 96.7 % line and 84 % branch coverage. All tests are HTTP integration tests on an in-memory DB with an injectable clock, which is a sound harness.

**Covered:** sign-up, the email domain, login and logout; double-booking and back-to-back bookings; the booking rules, quota and owner-only cancellation; a missing CSRF token; the admin guard, closures and notices; export and deletion; lockout, including parallel guesses; the DB migration.

**Missing:**
- concurrent bookings: NFR-006 is never exercised
- session expiry
- cookie flags and security headers (never asserted)
- XSS in any field other than the name
- login CSRF
- rate limiting
- malformed bodies
- time zone and DST
- cancelling a booking that has already started

Several tests assert assumptions that contradict the spec:
- the in-progress slot can be booked (FR-010)
- the 14-day horizon (FR-012)
- capacity up to 500 (FR-007)
- deletion removes the user's bookings (FR-019)

The green suite therefore shows the code agrees with the builder's own assumptions, not that it conforms to the spec.
