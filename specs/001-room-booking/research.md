# Phase 0 Research: RoomBook

All entries were checked on the development machine (macOS) rather than
taken from memory: package versions with `npm view`, runtime features with small `node -e` probes.

## R1. Runtime and language

- **Decision**: Node.js 26 (≥ 24 LTS per constitution) running TypeScript **natively** (type
  stripping), with `tsc --noEmit` used only as a type checker. TypeScript pinned to **6.0.3**.
- **Rationale**: `process.features.typescript === "strip"` on Node 26, so `.ts` files run without a
  build step or `tsx` (Simplicity, Principle VI). Code must use erasable syntax only (no `enum`,
  no parameter properties) — enforced by `erasableSyntaxOnly` in `tsconfig.json`.
- **Alternatives considered**: TypeScript **7.0.2** (latest, native Go compiler) — **rejected**:
  `typescript-eslint@8.72.1` declares `typescript: ">=4.8.4 <6.1.0"` as a peer dependency, so the
  newest compiler would break linting. This is exactly the kind of "install latest" mistake an
  unconstrained AI agent makes; pinning it here makes it a reviewed decision.

## R2. HTTP framework

- **Decision**: Express **5.3.0**.
- **Rationale**: Express 5 forwards rejected promises from async handlers to the error handler
  (no wrapper needed), it is the most widely documented Node framework (lower hallucination risk
  for AI-generated code), and `supertest` integrates directly.
- **Alternatives considered**: Fastify (built-in JSON-schema validation, faster) — rejected because
  validation is done once with zod and the performance target (NFR-001: 300 ms p95) is far from
  Express's limits; Node `http` only — rejected, too much routing boilerplate.

## R3. Persistence

- **Decision**: built-in `node:sqlite` (`DatabaseSync`, SQLite 3.53.4), one file database
  (`:memory:` in tests). Times stored as INTEGER epoch milliseconds (UTC).
- **Rationale**: no native add-on to compile, no server to run, zero runtime dependency. A probe on
  Node 26 opened a database, ran `BEGIN IMMEDIATE … COMMIT` and printed no experimental warning.
  The synchronous API lets the booking check-and-insert run inside one transaction with no `await`
  in between, which makes NFR-006 (exactly one winner) hold inside the process; a database
  `BEFORE INSERT` trigger rejecting overlaps is a second, independent guard.
- **Alternatives considered**: `better-sqlite3` (native build step, extra dependency);
  PostgreSQL with an exclusion constraint (strongest guarantee, but needs a server — out of scope
  per spec Assumptions).

## R4. Password hashing (NFR-002)

- **Decision**: `node:crypto` `scrypt` with N = 2^15, r = 8, p = 3, 16-byte random salt, 64-byte
  key, stored as `scrypt$N$r$p$salt$hash`; verified with `timingSafeEqual`. `maxmem` raised to
  64 MiB because the default (32 MiB) equals 128·N·r and would reject these parameters
  (verified: default → `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`; 64 MiB → OK, 137 ms per hash).
- **Rationale**: one of the parameter sets listed in the OWASP Password Storage Cheat Sheet;
  memory-hard; built in. The async API keeps hashing off the event loop, and libuv's 4-thread pool
  caps concurrent memory use at about 4 × 32 MiB.
- **Test-only setting**: tests construct the hasher with N = 2^10, p = 1 for speed. Production
  parameters are covered by one dedicated test.
- **Alternatives considered**: bcrypt / argon2 packages (native add-ons, extra dependencies).

## R5. Sessions (FR-002, FR-003)

- **Decision**: opaque 256-bit random token (`randomBytes(32)`, base64url) sent as
  `Authorization: Bearer <token>`; only its SHA-256 hash is stored, with `expires_at` (8 h) and
  `revoked_at`.
- **Rationale**: sign-out and account deletion must invalidate sessions immediately, which is a
  single row update here. Bearer headers are not sent automatically by browsers, so there is no
  CSRF exposure.
- **Alternatives considered**: JWT (cannot be revoked without a deny-list, larger attack surface);
  cookie sessions (need CSRF defence).
- **Trade-off**: the browser UI keeps the token in `sessionStorage`; XSS would expose it. This is
  mitigated by a strict CSP without inline scripts (NFR-005) and rendering all user text with
  `textContent`. Recorded as a threat to validity.

## R6. Input validation (NFR-004)

- **Decision**: zod **4.6.7** with strict object schemas (unknown keys rejected); one schema per
  request type, mirroring `contracts/openapi.yaml`.
- **Alternatives considered**: validating with ajv directly from the OpenAPI document (single
  source, but weaker TypeScript types and worse error messages for NFR-007).

## R7. Campus time and daylight-saving time (FR-010, edge cases)

- **Decision**: `Intl.DateTimeFormat(…, { timeZone })` to read the local wall-clock time of a UTC
  instant; local→UTC conversion by the two-pass offset method. A `Clock` port supplies "now".
- **Rationale**: `Temporal` is not available on Node 26 by default (`typeof Temporal ===
  "undefined"` in the probe); `Intl` is built in and handles DST.
- **Alternatives considered**: date-fns-tz / Luxon (extra dependency for one conversion).

## R8. Rate limiting (NFR-010) and sign-in lockout (FR-004)

- **Decision**: a small fixed-window limiter keyed by client address (300 req/min) using the
  injected `Clock`; lockout computed from a `login_failures` table keyed by a SHA-256 hash of the
  normalised email — for unknown emails too, so lockout behaviour does not reveal whether an
  account exists, and the table never stores an address in clear text (SC-006).
- **Alternatives considered**: `express-rate-limit` (extra dependency; harder to drive with a fake
  clock in tests).

## R9. Security headers (NFR-005)

- **Decision**: helmet **8.3.0** with CSP `default-src 'self'; script-src 'self'; style-src 'self';
  object-src 'none'; frame-ancestors 'none'`; JSON body limit 10 kB.

## R10. Testing (Principle II, NFR-008)

- **Decision**: Vitest **5.0.5** + `@vitest/coverage-v8` 5.0.5 (coverage threshold 85 % lines),
  supertest **7.3.1** for HTTP-level acceptance tests, ajv **8.20.0** (JSON Schema 2020-12, the
  dialect of OpenAPI 3.1) + yaml **2.9.1** for contract tests.
- **Test levels**: unit (pure domain rules, no I/O) → integration (SQLite repositories,
  concurrency, trigger) → contract (every response validated against the OpenAPI schemas; every
  documented operation exists) → acceptance (one test per acceptance scenario, named with the
  story and scenario number).
- **Performance (NFR-001)**: a dependency-free load script (`scripts/perf.ts`) with 20 concurrent
  workers that records each latency and computes the 95th percentile directly (autocannon was
  considered and rejected — it reports p90/p97.5, not p95).

## R11. Linting

- **Decision**: ESLint **10.14.0** + typescript-eslint **8.72.1** (recommended, non-type-aware
  rules) — the reason TypeScript is pinned in R1.

## R12. Identifiers and the bootstrap administrator (decided after Phase 2, Implementer questions)

- **IDs**: `crypto.randomUUID()` is called in the application layer; no `IdGenerator` port.
  Principle III keeps *rules* free of randomness; no rule depends on an ID's value and no test
  asserts one, so a port would add indirection without improving testability.
- **Bootstrap administrator**: created only when no account with `ADMIN_EMAIL` exists; an existing
  account is never modified. Its display name comes from `ADMIN_DISPLAY_NAME` (default
  `Administrator`). Creation is not audit-logged — FR-020 lists self-registration, and this is an
  installation step.

## R13. Interpretations made during implementation (reported by the Implementer, accepted by the Verifier)

| Topic | Interpretation | Basis |
|---|---|---|
| Admin cancelling **own** booking | allowed until it ends, no reason needed; `cancelledBy: owner`; audited as `booking.cancelled_by_admin` with `own: true` | Clarification Q3 requires a reason only for *someone else's* booking |
| Admin day view | whole campus day [00:00, next 00:00), all statuses, ordered by start then room name | FR-015 silent on order/status |
| Availability | one booked interval per booking (back-to-back not merged) | FR-006 silent |
| Unknown query parameters | rejected with 400 | NFR-004 "every request body and parameter" |
| Equipment filter with unknown value | empty list (value matches contract pattern) | FR-005 |
| Several rule violations at once | first failing rule reported, in order: slot boundary → too short → in past → opening hours → too long → too far ahead → party size → quota | FR-010 says "naming the violated rule" |
| `auth.locked` | logged on every refused attempt (not when the lock begins) | data-model amendment VF-2 |
| Lockout rule | pure domain function `src/domain/lockout.ts` | Principle III |

## R14. Decisions after the independent review (`docs/evidence/review-findings.md`)

- **Lockout under concurrency (R-1)**: record the attempt as a failure before the asynchronous
  password check (in the same synchronous step as the lock check) and delete it on success.
- **On-disk erasure (R-2)**: `PRAGMA secure_delete = ON` and a `wal_checkpoint(TRUNCATE)` after erasure.
- **Audit pseudonymisation (R-3)**: failed sign-in events carry the account id as target (if any) and
  no email hash; `login_failures` keeps the hash only for ≤ 24 h (R-9) and loses it on erasure.
- **Admin password (R-4)**: `.env.example` ships an empty `ADMIN_PASSWORD`; `loadConfig` rejects empty
  values and the old placeholder.
- **Rate limiter (R-6)**: expired windows are evicted so memory stays bounded. *Accepted risk*: behind a
  reverse proxy every client shares one address (deployment must set Express `trust proxy`), and
  rotating IPv6 addresses evade per-address limits; FR-004 still caps guesses per account.
- **R-13 / R-14** accepted and recorded in the audit log (no UPDATE path to `confirmed` exists; breached-
  password check, password change and email verification deferred to a later version — needs a decision
  from the team).
