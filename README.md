# RoomBook — Campus Study-Room Booking System

Course project: *An Experience Report on a Specification-Driven, AI-Assisted Software Construction Project*.

This repository contains two builds of the same idea so they can be compared:

| Folder | How it was built |
|---|---|
| `vibe-prototype/` | Vibe coding: short natural-language prompts, accept-and-iterate |
| repository root (`src/`, `tests/`, `specs/`) | Specification-Driven Development with GitHub Spec Kit v1.2.5 |

**Report and evidence**

| What | Where |
|---|---|
| Experience report | [`docs/report/REPORT.pdf`](docs/report/REPORT.pdf) |
| Prompt logs (verbatim, with outcomes) | [`docs/prompts/vibe-prompts.md`](docs/prompts/vibe-prompts.md), [`docs/prompts/sdd-prompts.md`](docs/prompts/sdd-prompts.md) |
| Audit log (all defects found and how they were fixed) | [`docs/evidence/audit-log.md`](docs/evidence/audit-log.md) |
| Independent review, vibe audit, usability walkthrough | `docs/evidence/review-findings.md`, `docs/evidence/vibe-audit.md`, `docs/evidence/usability/` |
| Test runs (red → green) and quality gates | `docs/evidence/test-run-*.txt`, `docs/evidence/final-gates/` |

Spec Kit files (`.specify/`, `.claude/skills/speckit-*`) are © GitHub, Inc., used under the MIT licence — see
[`.specify/LICENSE-spec-kit.txt`](.specify/LICENSE-spec-kit.txt).

The rest of this file describes the specification-driven build. Students and staff register
with a university email address, find a room, see its free and booked times for a day and
book a slot under role-based limits. Facilities administrators manage rooms, roles and any
booking. Users can download their data and delete their account.

The specification is the source of truth: [spec](specs/001-room-booking/spec.md) ·
[plan](specs/001-room-booking/plan.md) · [data model](specs/001-room-booking/data-model.md) ·
[API contract (OpenAPI 3.1)](specs/001-room-booking/contracts/openapi.yaml) ·
[decisions](specs/001-room-booking/research.md) · [tasks](specs/001-room-booking/tasks.md) ·
[constitution](.specify/memory/constitution.md).

## Run it

Requires Node.js 24 or newer (developed on 26.8). Node runs the TypeScript sources directly;
there is no build step.

```bash
npm ci
cp .env.example .env     # REQUIRED: set ADMIN_PASSWORD (start-up refuses an empty or example value)
npm run seed             # first administrator + 6 demo rooms (safe to run again)
npm start                # UI on http://localhost:3000, API under /api/v1
```

Sign in with the administrator account to add rooms, or register a user with an address in an
allowed domain (`you@uni.example` by default).

### Configuration

Environment variables (read from `.env` when present):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_FILE` | `data/roombook.db` | SQLite database file (created on first start) |
| `CAMPUS_TIME_ZONE` | `Europe/Helsinki` | IANA time zone for opening hours and dates |
| `OPENING_HOURS` | `08:00-22:00` | campus-local opening hours, full or half hours |
| `ALLOWED_EMAIL_DOMAINS` | `uni.example` | comma-separated domains allowed to register |
| `RATE_LIMIT_PER_MINUTE` | `300` | requests per minute per client address |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | — | first administrator, created if no account with that email exists; both or neither, and the password must not be empty or the old example value |
| `ADMIN_DISPLAY_NAME` | `Administrator` | display name of that administrator |

Invalid values stop the server at start-up with a message naming the variable. Sessions last
8 hours.

### Operations

| Command | What it does |
|---|---|
| `npm run purge` | deletes bookings that ended, and audit events recorded, more than 12 months ago; sign-in failure records and expired or revoked sessions after 24 hours (FR-021) |
| `npm run perf` | load test: 50 rooms, 5,000 bookings, 20 concurrent clients; prints p95 per endpoint (NFR-001) |
| `npm audit --omit=dev` | supply-chain check of the 3 runtime dependencies |

## Test it

| Command | Scope |
|---|---|
| `npm test` | everything |
| `npm run test:unit` | domain rules, campus time, hashing, rate limiter, services with test doubles |
| `npm run test:integration` | SQLite schema and repositories, auth middleware, app wiring, concurrency (20 parallel bookings → exactly 1) |
| `npm run test:contract` | every operation in the OpenAPI contract is exercised and every response validates |
| `npm run test:acceptance` | one test per acceptance scenario in the spec (US1-1 … US5-3) plus edge cases |
| `npm run test:coverage` | all tests with line coverage of `src/` (gate: 85 %) |
| `npm run typecheck`, `npm run lint` | `tsc` (strict) and ESLint with typescript-eslint |

The acceptance and contract tests were written by a separate Verifier role from the spec,
before the code; they drive the real HTTP app with a fake clock and check each response
against the contract. Test runs kept as evidence are in `docs/evidence/`.

## Architecture

A single Node.js process serves the JSON API and a static single-page UI. The code follows
ports and adapters, so business rules can be tested without a database, network or real clock.

```text
src/
├── domain/          pure rules, no I/O: booking rules (FR-010…FR-012), availability,
│                    campus time (DST-safe, Intl), sign-in lockout, errors, types
├── application/     services that orchestrate the rules: auth, rooms, bookings, accounts,
│                    audit, maintenance; ports.ts declares what they need from outside
├── infrastructure/  adapters: SQLite (node:sqlite) schema + repositories + unit of work,
│                    scrypt password hasher, token service, system clock
├── http/            Express app: helmet/CSP, rate limit, strict zod schemas, routes,
│                    presenters (domain → contract JSON), error mapping
├── config.ts        environment → validated configuration
├── container.ts     composition root
├── server.ts        entry point
└── cli/purge.ts     retention task
public/              UI: index.html, app.js, styles.css (no framework, no inline scripts)
scripts/             seed.ts, perf.ts
tests/               unit/, integration/, contract/, acceptance/, support/
```

A request passes helmet (security headers), the per-client rate limiter, the 10 kB JSON body
parser, then a route. The route validates input with a strict schema (unknown fields are
rejected), checks the session and role, calls one application service and turns the result
into the contract shape. Errors become the contract's `Error` body; unexpected errors are
logged and answered with a generic 500.

Key decisions (details in [research.md](specs/001-room-booking/research.md)):

- **No double bookings.** Creating a booking checks the rules and inserts in one synchronous
  SQLite transaction (`BEGIN IMMEDIATE`, no `await` inside). A database trigger rejecting
  overlapping confirmed bookings is a second guard.
- **Campus time.** Times are stored as UTC epoch milliseconds and exchanged as ISO 8601 UTC.
  Opening hours, slot boundaries and dates are evaluated in the configured campus time zone,
  so they stay correct on daylight-saving change days.
- **Credentials.** Passwords are stored as scrypt hashes (N = 2^15, r = 8, p = 3). Sessions are
  random 256-bit bearer tokens; only their SHA-256 hash is stored, so sign-out and account
  deletion take effect immediately. After 5 failed sign-ins within 15 minutes, sign-in for
  that email is refused for 15 minutes, the same way for unknown emails. Each attempt is
  counted *before* its password is checked, so a burst of parallel requests still gets at most
  5 checks; wrong passwords entered to delete an account count too.
- **Privacy.** Availability never shows who booked. Account deletion cancels upcoming
  bookings, clears booking purposes and cancellation reasons, deletes the user and their
  sessions, and keeps past bookings only as anonymous room-usage records. SQLite runs with
  `secure_delete` and the write-ahead log is checkpointed after an erasure, so the deleted
  email and name do not remain in the database files. Audit events hold pseudonymous ids,
  never emails, email hashes, passwords or tokens. API responses are sent with
  `Cache-Control: no-store`.
- **Browser security.** Content-Security-Policy without inline scripts or styles, no framing,
  `base-uri 'none'`, `form-action 'self'`, no MIME sniffing; the UI renders all user text with
  `textContent`.

## Known limitations

- No email verification or password reset (no mail service in the course environment).
- The UI keeps the session token in `sessionStorage`; the strict CSP is the mitigation.
- The rate limiter keeps its counters in memory, per process; RoomBook runs as one process
  with an embedded database and is not built for horizontal scaling. Behind a reverse proxy
  every client shares the proxy's address unless Express `trust proxy` is configured, and
  rotating IPv6 addresses evade a per-address limit (accepted risks, research R14; the
  per-account sign-in lock still applies).
- Erasure cannot reach copies outside the database files, such as backups taken earlier.
