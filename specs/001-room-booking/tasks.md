# Tasks: RoomBook — Campus Study-Room Booking

**Input**: Design documents from `/specs/001-room-booking/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/openapi.yaml, quickstart.md

**Tests**: REQUIRED — constitution Principle II (test-first, non-negotiable). Acceptance tests are
written from the spec's acceptance scenarios and must be run red before the implementation tasks
of the same story.

**Roles**: tasks marked **(Verifier)** write tests and test support; tasks marked
**(Implementer)** write production code. The Implementer MUST NOT edit files under
`tests/acceptance/`, `tests/contract/` or `tests/support/`; if such a test looks wrong, the
Implementer reports it and the Verifier decides (spec amendment first, per Principle I).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1 … US5)

## Path Conventions

Single project at repository root: `src/`, `tests/`, `public/`, `scripts/` (see plan.md).

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 (Implementer) Create `package.json` (`"type": "module"`, `"engines": { "node": ">=24" }`) with exact pinned versions from plan.md Technical Context (express 5.3.0, zod 4.6.7, helmet 8.3.0; dev: typescript 6.0.3, vitest 5.0.5, @vitest/coverage-v8 5.0.5, supertest 7.3.1, @types/supertest, @types/express, @types/node, ajv 8.20.0, yaml 2.9.1, eslint 10.14.0, typescript-eslint 8.72.1) and scripts `start`, `seed`, `purge`, `perf`, `test`, `test:unit`, `test:integration`, `test:contract`, `test:acceptance`, `test:coverage`, `typecheck`, `lint`
- [X] T002 [P] (Implementer) Create `tsconfig.json`: `strict`, `noEmit`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `module`/`moduleResolution` `nodenext`, `target` `es2024`, includes `src`, `tests`, `scripts`
- [X] T003 [P] (Implementer) Create `vitest.config.ts` (NFR-008; node environment; coverage provider v8 over `src/**`, excluding `src/server.ts` and `src/cli/**`; threshold `lines: 85`)
- [X] T004 [P] (Implementer) Create `eslint.config.js` (typescript-eslint recommended, non-type-aware), `.env.example` (variables from quickstart.md), add `data/` to `.gitignore`
- [X] T005 (Implementer) Create the directory skeleton from plan.md Project Structure

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 [P] (Implementer) `src/domain/errors.ts`: `DomainError(code, message, details?)`; code union = every code in plan.md "Error Mapping" plus `INTERNAL`
- [X] T007 [P] (Implementer) `src/domain/types.ts`: `Role = 'student' | 'staff' | 'admin'`; `Equipment = 'whiteboard' | 'projector' | 'display-screen' | 'video-conferencing'`; `User`, `Room`, `Booking` (`status: 'confirmed' | 'cancelled'`, `cancelledBy: 'owner' | 'admin' | 'system' | null`), `AuditAction` (all 13 actions in data-model.md); `ROLE_LIMITS` = student `{ maxDurationMin: 120, maxAheadDays: 7, maxUpcoming: 3 }`, staff and admin `{ 240, 30, 10 }` (FR-012)
- [X] T008 [P] (Implementer, test first) `tests/unit/campus-time.test.ts` then `src/domain/campus-time.ts`: wall-clock parts of a UTC instant in a time zone; campus-local date+time → UTC instant (two-pass offset); `isOnSlotBoundary` (minute ∈ {0, 30}, seconds/ms 0); cases for `Europe/Helsinki` on 2026-10-25 (UTC+3 → +2) and 2027-03-28 (UTC+2 → +3)
- [X] T009 (Implementer) `src/application/ports.ts`: `Clock { now(): number }` (epoch ms), `PasswordHasher { hash(pw): Promise<string>; verify(pw, stored): Promise<boolean> }`, `TokenService { generate(): string; hash(token): string }`, repository interfaces for User, Session, LoginFailure, Room, Booking, AuditEvent, and `UnitOfWork { transaction<T>(fn: () => T): T }` (synchronous by design — research R3)
- [X] T010 (Implementer, test first) `tests/integration/sqlite-schema.test.ts` then `src/infrastructure/sqlite/database.ts` + `schema.ts`: tables per data-model.md, `PRAGMA foreign_keys = ON`, sessions `ON DELETE CASCADE`, bookings.user_id `ON DELETE SET NULL`, `BEFORE INSERT` trigger (FR-011) raising `BOOKING_OVERLAP` for an overlapping confirmed booking (`a.start < b.end AND b.start < a.end`), back-to-back allowed, cancelled rows ignored
- [X] T011 (Implementer) `src/infrastructure/sqlite/repositories.ts` + `unit-of-work.ts` (`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`) — parameterised statements only (Principle IV)
- [X] T012 [P] (Implementer, test first) `tests/unit/scrypt-hasher.test.ts` then `src/infrastructure/scrypt-hasher.ts` (NFR-002): format `scrypt$N$r$p$salt$hash`, 16-byte salt, 64-byte key, `maxmem` 64 MiB, `timingSafeEqual`; production params N = 2^15, r = 8, p = 3 (research R4); params injectable for tests
- [X] T013 [P] (Implementer) `src/infrastructure/token-service.ts` (NFR-002; `randomBytes(32)` base64url; SHA-256 hex) and `src/infrastructure/system-clock.ts`
- [X] T014 [P] (Implementer) `src/config.ts`: `loadConfig(env)` with defaults from quickstart.md (`CAMPUS_TIME_ZONE` Europe/Helsinki, `OPENING_HOURS` 08:00-22:00, `ALLOWED_EMAIL_DOMAINS` uni.example, `RATE_LIMIT_PER_MINUTE` 300, session TTL 8 h); exported `Config` type
- [X] T015 (Implementer) `src/application/audit-service.ts` (FR-020): `record(action, actorUserId, target?, details?)`; rejects detail keys named `email`, `password`, `token` (Principle V)
- [X] T016 (Implementer) `src/http/error-handler.ts`: DomainError → status per plan.md "Error Mapping"; zod error → 400 `VALIDATION_FAILED` with `details: [{ field, message }]`; malformed JSON or body > 10 kB → 400 `VALIDATION_FAILED`; unknown error → 500 `INTERNAL` with generic message (no stack, no SQL — NFR-004); body shape = contract `Error`
- [X] T017 (Implementer, test first) `tests/unit/rate-limit.test.ts` then `src/http/rate-limit.ts`: fixed 60-second window per client address using the injected `Clock`; over the limit → 429 `RATE_LIMITED` + `Retry-After` seconds (NFR-010)
- [X] T018 (Implementer) `src/http/auth-middleware.ts`: `Authorization: Bearer` → token hash → valid session (not revoked, not expired, user exists) → `req.actor = { userId, role }`; otherwise 401 `UNAUTHENTICATED`; `requireAdmin` → 403 `FORBIDDEN`
- [X] T019 (Implementer) `src/container.ts` `buildContainer({ dbFile, clock, config, hasherParams? })` returning services + `bootstrapAdmin()` (creates/ensures the admin from `config.admin`); `src/http/app.ts` `createApp(container)`: helmet with CSP (NFR-005) from research R9, `express.json({ limit: '10kb' })`, rate limiter, `/api/v1` routers, JSON 404 `NOT_FOUND` for unknown `/api` paths, static `public/`, error handler; `src/server.ts` entry point
- [X] T020 [P] (Verifier) `tests/support/fixed-clock.ts` (settable/advanceable `Clock`), `tests/support/contract.ts` (loads `contracts/openapi.yaml`, ajv 2020 + formats, validates status is documented and body matches schema for the matched operation), `tests/support/harness.ts` (in-memory container + app, helper API client that validates **every** response against the contract, helpers to register/sign in users and create rooms)

**Checkpoint**: foundation ready — unit and integration tests above pass; the app starts and answers `GET /api/v1/health`.

---

## Phase 3: User Story 2 — Register, sign in and sign out securely (Priority: P1)

**Goal**: authenticated, attributable users (prerequisite of every other story).

**Independent Test**: register → sign in → `GET /me` → sign out → same token refused.

### Tests for User Story 2 ⚠️ (write first, run red)

- [X] T021 [P] [US2] (Verifier) `tests/acceptance/us2-auth.test.ts`: scenarios US2-1 … US2-5 + edge cases (session refused after sign-out, after 8 h expiry, after account deletion; password equal to email; unknown fields rejected)

### Implementation for User Story 2

- [X] T022 [US2] (Implementer) `src/http/schemas.ts` Register/Login schemas (strict): email ≤ 254, "display name (1–60 characters)", "password (12–128 characters, not equal to the email address)"
- [X] T023 [US2] (Implementer) `src/application/auth-service.ts`: register (lower-case email; `EMAIL_DOMAIN_NOT_ALLOWED`; `PASSWORD_EQUALS_EMAIL`; `EMAIL_TAKEN`; role student; audit `user.registered`), login (FR-002, FR-004: "5 failed attempts within 15 minutes" → refused "for 15 minutes from the last failure" keyed by SHA-256 of normalised email, also for unknown emails; same `INVALID_CREDENTIALS` for unknown email and wrong password, verifying against a dummy hash for unknown emails; session "expires 8 hours after sign-in"; audit success/failure/lock), logout (revoke; audit)
- [X] T024 [US2] (Implementer) `src/http/routes/auth.ts` (`/auth/register`, `/auth/login`, `/auth/logout`) and `src/http/routes/me.ts` (`GET /me`); `429 TOO_MANY_ATTEMPTS` with `Retry-After`
- [X] T025 [US2] (Implementer) UI: register / sign-in / sign-out in `public/index.html`, `public/app.js`, `public/styles.css` (no inline scripts or styles; all user text via `textContent`)

**Checkpoint**: US2 acceptance tests green.

---

## Phase 4: User Story 1 — Book a study room (Priority: P1) 🎯 MVP

**Goal**: find a room, see a day's availability, book a slot under the rules.

**Independent Test**: one room, one student → availability → book → listed in upcoming → busy in availability.

### Tests for User Story 1 ⚠️ (write first, run red)

- [X] T026 [P] [US1] (Verifier) `tests/acceptance/us1-booking.test.ts`: US1-1 … US1-7 + edge cases (start = end, crossing midnight, after 22:00, room out of service, unknown room → 404, party size 0, purpose > 100 chars, unknown field, `<script>` purpose stored and returned as plain text, DST day availability)
- [X] T027 [P] [US1] (Verifier) `tests/integration/concurrency.test.ts`: 20 simultaneous `POST /bookings` for the same slot → exactly 1 × 201 and 19 × 409 `SLOT_UNAVAILABLE` (SC-003, NFR-006)
- [X] T028 [P] [US1] (Implementer, test first) `tests/unit/booking-rules.test.ts` (NFR-008 — rules tested without DB/clock): decision table per role with boundary values (30 min ok / 0 min `TOO_SHORT`; student 120 min ok / 150 `TOO_LONG`; staff 240 ok / 270 `TOO_LONG`; start exactly 7 days ahead ok / +30 min `TOO_FAR_AHEAD`; 3rd upcoming ok / 4th `QUOTA_REACHED`; 21:30–22:00 ok / 21:30–22:30 `OUTSIDE_OPENING_HOURS`)
- [X] T029 [P] [US1] (Implementer, test first) `tests/unit/availability.test.ts`

### Implementation for User Story 1

- [X] T030 [US1] (Implementer) `src/domain/booking-rules.ts`: FR-010 ("start and end on a 30-minute boundary, last at least 30 minutes, start in the future, lie within opening hours (08:00–22:00 campus time) on a single campus-local day, and have a party size between 1 and the room capacity") and FR-012 limits; `overlaps` for FR-011; codes `IN_PAST`, `NOT_ON_SLOT_BOUNDARY`, `TOO_SHORT`, `TOO_LONG`, `OUTSIDE_OPENING_HOURS`, `TOO_FAR_AHEAD`, `QUOTA_REACHED`, `PARTY_TOO_LARGE`; `overlaps(a, b)` on half-open intervals
- [X] T031 [US1] (Implementer) `src/domain/availability.ts`: booked and free intervals inside the campus-local opening window of a date; booked intervals carry no booker identity (NFR-009)
- [X] T032 [US1] (Implementer) `src/application/room-service.ts`: `list` (in-service rooms; filters `minCapacity`, `building`, `equipment` all-of — FR-005), `availability` (FR-006; out-of-service or unknown room → `NOT_FOUND`)
- [X] T033 [US1] (Implementer) `src/application/booking-service.ts` `create`: whole check-and-insert inside `UnitOfWork.transaction` with **no `await`** inside (NFR-006); trigger `BOOKING_OVERLAP` → `SLOT_UNAVAILABLE`; room out of service → `ROOM_OUT_OF_SERVICE`; unknown room → `NOT_FOUND`; `listMine(include = 'upcoming' | 'all')` ordered by start (FR-013)
- [X] T034 [US1] (Implementer) `src/http/routes/rooms.ts` (`GET /rooms`, `GET /rooms/{roomId}/availability`) and `src/http/routes/bookings.ts` (`POST /bookings`, `GET /bookings/mine`) with strict zod schemas from the contract
- [X] T035 [US1] (Implementer) UI: room list with filters, availability view for a date, booking form, "My bookings" list

**Checkpoint**: MVP — US1 + US2 acceptance tests green, concurrency test green.

---

## Phase 5: User Story 3 — Manage my bookings (Priority: P2)

**Independent Test**: book → cancel → slot free and quota restored.

### Tests for User Story 3 ⚠️

- [X] T036 [P] [US3] (Verifier) `tests/acceptance/us3-manage.test.ts`: US3-1 … US3-3 + `include=all` shows cancelled/past bookings with status and reason; cancelling twice → `ALREADY_CANCELLED`; quota restored after cancel

### Implementation for User Story 3

- [X] T037 [US3] (Implementer) `booking-service.cancel` for owners: only before start (`ALREADY_STARTED`), not twice (`ALREADY_CANCELLED`), foreign booking → `NOT_FOUND` exactly like a missing one (FR-014, NFR-003); `cancelledBy: 'owner'`
- [X] T038 [US3] (Implementer) route `POST /bookings/{bookingId}/cancel`; UI cancel button and "show cancelled & past" toggle

---

## Phase 6: User Story 4 — Administer rooms and bookings (Priority: P2)

**Independent Test**: admin creates room → listed → out of service → cannot be booked; future bookings cancelled with reason.

### Tests for User Story 4 ⚠️

- [X] T039 [P] [US4] (Verifier) `tests/acceptance/us4-admin.test.ts`: US4-1 … US4-5 + `ROOM_NAME_TAKEN`; capacity outside 1–50 rejected; admin cancel without reason → `REASON_REQUIRED`; owner sees admin reason; `LAST_ADMIN` on demoting the only admin; audit events newest first and free of passwords, tokens and email addresses

### Implementation for User Story 4

- [X] T040 [US4] (Implementer) `room-service` create/update (FR-007; unique name case-insensitive → `ROOM_NAME_TAKEN`; "capacity (1–50)"; equipment from the four allowed values), `takeOutOfService` (FR-008; cancel confirmed bookings with `start > now`: `cancelledBy: 'system'`, reason "Room taken out of service" — FR-016), `putInService`, `listAll`; audit
- [X] T041 [US4] (Implementer) `booking-service.adminCancel` ("any booking that has not ended" → else `ALREADY_ENDED`; reason "1–200 characters" required when the booking is not the admin's own → `REASON_REQUIRED`; audit `booking.cancelled_by_admin`) and `listForDate` with booker `{ userId, displayName, email }` or `null` if anonymised (FR-015)
- [X] T042 [US4] (Implementer) `src/application/account-service.ts` `changeRole` (FR-017; `LAST_ADMIN`), `findUsers(emailFragment)` (max 100); audit
- [X] T043 [US4] (Implementer) `src/http/routes/admin.ts` (`/admin/rooms`, `/admin/bookings`, `/admin/users`, `/admin/users/{userId}/role`, `/admin/audit-events`) and room admin routes in `rooms.ts` (`POST /rooms`, `PATCH /rooms/{roomId}`, `/out-of-service`, `/in-service`)
- [X] T044 [US4] (Implementer) UI admin panel: rooms (create, edit, service toggle), day bookings with cancel + reason, user role change, audit list

---

## Phase 7: User Story 5 — Control my personal data (Priority: P3)

**Independent Test**: export contains own data only; erase → sign-in fails, bookings anonymous.

### Tests for User Story 5 ⚠️

- [X] T045 [P] [US5] (Verifier) `tests/acceptance/us5-privacy.test.ts`: US5-1 … US5-3 + wrong password → 403 `PASSWORD_INCORRECT`; only admin cannot erase → 409 `LAST_ADMIN`; SC-006 (after erasure no table contains the email or display name)

### Implementation for User Story 5

- [X] T046 [US5] (Implementer) `account-service.export` (FR-018) and `erase` (FR-019: verify password; in one transaction cancel upcoming bookings `cancelledBy: 'system'` reason "Account deleted", set `purpose = NULL` on all the user's bookings, delete the user — sessions cascade, bookings `user_id` → NULL — and delete the user's login-failure rows; audit `user.erased` with id only)
- [X] T047 [US5] (Implementer) routes `GET /me/export`, `POST /me/erase`; UI account section (export download, delete with password)

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T048 [P] (Verifier) `tests/contract/openapi-coverage.test.ts`: every operation in `openapi.yaml` is exercised at least once and every response validates
- [X] T049 [P] (Verifier) `tests/acceptance/security.test.ts`: NFR-004/005/010 — security headers and CSP, unknown fields, malformed JSON without stack trace, body > 10 kB, 301st request in a minute → 429 + `Retry-After`, admin endpoints → 403 for students
- [X] T050 (Implementer, test first) `tests/unit/maintenance.test.ts` then `src/application/maintenance.ts` + `src/cli/purge.ts` (FR-021: delete bookings that ended > 12 months ago and audit events older than 12 months; audit `maintenance.purged`)
- [X] T051 [P] (Implementer) `scripts/seed.ts` (admin from env + 6 demo rooms) and `scripts/perf.ts` (NFR-001, SC-004: 50 rooms, 5,000 bookings, 20 concurrent workers, prints p95 per endpoint)
- [X] T052 (Implementer) `README.md`: run, test, configuration, architecture overview
- [X] T053 (Verifier) Run quality gates (SC-001: all acceptance tests green) and store outputs in `docs/evidence/`: `typecheck`, `lint`, `test:coverage` (≥ 85 % lines), `npm audit --omit=dev`, `perf`

- [X] T054 (Verifier) Independent review (constitution gate 5, SC-005): a fresh AI reviewer with no access to the implementation conversation reviews `src/` against the spec and OWASP ASVS L1 / API Top 10; findings, resolutions and human sign-off recorded in `docs/evidence/audit-log.md`
- [X] T055 (Verifier) Usability verification (NFR-007, SC-002): scripted headless-browser walkthrough at 360 px width using keyboard only — register, sign in, find a room for 4, book tomorrow 10:00–11:00 — timed; confirm field-specific error messages; screenshots in `docs/evidence/`

- [ ] T056 (Implementer, test first) N-1 / issue #1: non-blocking erasure checkpoint with background retry in `src/infrastructure/sqlite/storage-flusher.ts`; regression test `tests/integration/erasure-checkpoint.test.ts` (FR-019, research R15)

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → user stories. **US2 before US1**: every booking operation requires a
  signed-in user, so although both are P1, US2 is implemented first; US1 completes the MVP.
- US3, US4, US5 depend only on Phases 1–2 plus US2 (and US1's booking creation for test setup);
  they can proceed in parallel after the MVP.
- Within each story: Verifier tests (red) → domain → services → routes → UI.
- Phase 8 after all stories.

## Parallel Opportunities

- Phase 2: T006, T007, T008, T012, T013, T014, T020 touch different files.
- All Verifier acceptance files (T021, T026, T027, T036, T039, T045, T048, T049) can be written
  in parallel once T020 exists.
- US3 / US4 / US5 implementation can run in parallel after the MVP checkpoint.

## Implementation Strategy

1. MVP first: Phases 1–4 (US2 + US1) → demo booking end-to-end.
2. Increment: US3 → US4 → US5, each closed by its acceptance tests turning green.
3. Polish: contract coverage, security suite, retention task, perf, quality gates.

## Notes

- Commit after each task or logical group; messages reference task and requirement IDs,
  e.g. `feat(US1): booking rules (T030; FR-010, FR-012)`.
- Never weaken a Verifier test to make it pass — amend the spec first if the test is wrong.
