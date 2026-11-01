# Implementation Plan: RoomBook — Campus Study-Room Booking

**Branch**: `001-room-booking` | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-room-booking/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

RoomBook lets university members register, sign in, browse rooms, see a room's free and booked
intervals for a campus-local day, and book or cancel 30-minute-aligned slots under role-based
limits. Administrators manage rooms, roles and any booking; users can export and erase their data.

Technical approach (see [research.md](./research.md)): a TypeScript service running natively on
Node.js 26, Express 5 HTTP layer over a pure domain core (ports & adapters), embedded SQLite via
`node:sqlite`, scrypt password hashing and opaque hashed session tokens, zod validation mirroring the
OpenAPI 3.1 contract, and a dependency-free static web UI. Every acceptance scenario becomes an
automated test written before the code.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (type-check only, `erasableSyntaxOnly`), executed natively by Node.js 26 (≥ 24 LTS)

**Primary Dependencies**: express 5.3.0, zod 4.6.7, helmet 8.3.0 (runtime); vitest 5.0.5, @vitest/coverage-v8 5.0.5, supertest 7.3.1, ajv 8.20.0, yaml 2.9.1, eslint 10.14.0, typescript-eslint 8.72.1 (dev)

**Storage**: SQLite 3.53 through built-in `node:sqlite`; file `data/roombook.db`, `:memory:` in tests

**Testing**: Vitest (unit, integration, contract, acceptance), supertest over the real Express app, coverage-v8 with 85 % line threshold, custom p95 load script

**Target Platform**: Linux or macOS server; any modern browser for the UI

**Project Type**: web-service with a small static web front end served by the same process

**Performance Goals**: room list and availability ≤ 300 ms p95 with 50 rooms, 5,000 bookings, 20 concurrent clients (NFR-001)

**Constraints**: exactly one winner for concurrent same-slot bookings (NFR-006); 300 req/min/client (NFR-010); JSON bodies ≤ 10 kB; no inline scripts (CSP)

**Scale/Scope**: one campus, ≤ a few thousand users, ≤ 50 rooms; 20 FRs + FR-021, 10 NFRs, 21 HTTP operations

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Pre-research | Post-design |
|---|---|---|---|
| I. Spec is source of truth | Every endpoint and table maps to FR/NFR IDs | ✅ | ✅ contract operations cite FR IDs; data-model fields cite sources |
| II. Test-first | Acceptance tests per scenario written and run red before implementation | ✅ planned (tasks phase 2) | ✅ test layout below; red/green logs to `docs/evidence/` |
| III. Ports & adapters | Domain has no I/O; clock/hasher/tokens/repos injected | ✅ | ✅ `src/domain` imports nothing outside itself; `Clock` port (research R7) |
| IV. Secure by default | ASVS L1 / API Top 10 addressed | ✅ | ✅ scrypt (R4), hashed tokens (R5), strict schemas (R6), helmet CSP (R9), rate limit (R8), parameterised SQL, 404-on-foreign-object |
| V. Privacy by design | Minimal data, export, erasure, audit without secrets | ✅ | ✅ purpose nulled + userId set null on erasure; emails only hashed in failures/audit |
| VI. Simplicity | Each runtime dependency justified | ✅ | ✅ 3 runtime deps (express, zod, helmet) — justified in R2, R6, R9; SQLite, crypto, TS execution from Node itself |
| Constraints | TS strict, Node ≥ 24, OpenAPI 3.1 contract + contract tests, UTC storage | ✅ | ✅ |

No violations → Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-room-booking/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── openapi.yaml     # Phase 1 output (/speckit-plan command)
├── checklists/
│   └── requirements.md  # /speckit-specify quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── domain/                 # pure, no I/O (Principle III)
│   ├── errors.ts           # DomainError + error codes (mirrors contract codes)
│   ├── types.ts            # User, Room, Booking, Role, Equipment, AuditAction …
│   ├── campus-time.ts      # UTC ⇄ campus-local conversions (Intl), DST-safe
│   ├── booking-rules.ts    # FR-010 … FR-012 validation, overlap, role limits
│   └── availability.ts     # FR-006 booked/free interval computation
├── application/
│   ├── ports.ts            # Clock, PasswordHasher, TokenService, repositories, UnitOfWork
│   ├── auth-service.ts     # FR-001 … FR-004
│   ├── room-service.ts     # FR-005 … FR-008, FR-016
│   ├── booking-service.ts  # FR-009 … FR-015
│   ├── account-service.ts  # FR-017 … FR-019
│   ├── audit-service.ts    # FR-020
│   └── maintenance.ts      # FR-021
├── infrastructure/
│   ├── sqlite/             # schema.ts (DDL + overlap trigger), repositories.ts, unit-of-work.ts
│   ├── scrypt-hasher.ts    # NFR-002
│   ├── token-service.ts    # random tokens + SHA-256
│   └── system-clock.ts
├── http/
│   ├── app.ts              # createApp(deps): helmet, json limit, rate limit, routes, errors
│   ├── schemas.ts          # zod request schemas (strict)
│   ├── auth-middleware.ts
│   ├── rate-limit.ts       # NFR-010
│   ├── error-handler.ts    # DomainError → status/code; no internals leaked (NFR-004)
│   └── routes/             # auth.ts, me.ts, rooms.ts, bookings.ts, admin.ts
├── config.ts
├── container.ts            # composition root (wires adapters into services)
├── server.ts               # entry point
└── cli/purge.ts            # FR-021 maintenance task

public/                     # static UI (no inline scripts): index.html, app.js, styles.css
scripts/perf.ts             # NFR-001 p95 load test

tests/
├── support/                # FixedClock (stub), fast hasher config, app factory, fixtures
├── unit/                   # domain rules, campus time, availability, services with test doubles
├── integration/            # SQLite repositories, overlap trigger, concurrency (NFR-006)
├── contract/               # every response validated against openapi.yaml
└── acceptance/             # US1 … US5 scenarios through HTTP, one test per scenario
```

**Structure Decision**: single project (Option 1) — the web UI is static files served by the API
process, so a separate front-end project would add tooling without benefit (Principle VI).
Layering follows ports & adapters so the booking rules can be tested without database, network or
real clock (NFR-008).

## Error Mapping

| DomainError code | HTTP |
|---|---|
| VALIDATION_FAILED | 400 |
| UNAUTHENTICATED, INVALID_CREDENTIALS | 401 |
| FORBIDDEN, PASSWORD_INCORRECT | 403 |
| NOT_FOUND | 404 |
| EMAIL_TAKEN, ROOM_NAME_TAKEN, SLOT_UNAVAILABLE, LAST_ADMIN | 409 |
| rule codes (EMAIL_DOMAIN_NOT_ALLOWED … REASON_REQUIRED) | 422 |
| TOO_MANY_ATTEMPTS, RATE_LIMITED (+ `Retry-After`) | 429 |
| anything else | 500 `INTERNAL` with a generic message; details only in the server log |

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None.
