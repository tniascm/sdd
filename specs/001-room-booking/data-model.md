# Data Model: RoomBook

Times are UTC epoch milliseconds in storage and ISO 8601 UTC strings (`2026-11-02T08:00:00.000Z`)
in the API. Identifiers are random UUID v4 strings (not guessable, but ownership is still checked —
NFR-003).

## User

| Field | Type | Rules | Source |
|---|---|---|---|
| id | uuid | generated | — |
| email | text | unique (case-insensitive), lower-cased, domain in `ALLOWED_EMAIL_DOMAINS`, ≤ 254 chars | FR-001 |
| displayName | text | 1–60 chars after trimming, no control characters | FR-001 |
| role | enum | `student` \| `staff` \| `admin`; new accounts `student` | FR-001, FR-017 |
| passwordHash | text | scrypt string (research R4); never leaves the persistence layer | NFR-002 |
| createdAt | ms | | — |

Password (input only): 12–128 chars, not equal to the email (case-insensitive).

**Invariants**: at least one user with role `admin` always exists (FR-017, edge case).
**Erasure (FR-019)**: the row is deleted; sessions cascade; bookings are anonymised (below).

## Session

| Field | Type | Rules |
|---|---|---|
| tokenHash | text (PK) | SHA-256 hex of the bearer token; the token itself is never stored |
| userId | uuid → User | `ON DELETE CASCADE` |
| createdAt / expiresAt | ms | `expiresAt = createdAt + 8 h` (FR-002) |
| revokedAt | ms \| null | set on sign-out (FR-003) |

Valid ⇔ `revokedAt IS NULL AND now < expiresAt AND user exists`.

## LoginFailure (FR-004)

| Field | Type | Rules |
|---|---|---|
| emailHash | text | SHA-256 hex of the normalised (trimmed, lower-cased) email — also for unknown emails |
| at | ms | time of the failed attempt |

Locked ⇔ ≥ 5 failures with `at > now − 15 min`; the lock lasts until 15 min after the most recent
failure. A successful sign-in deletes the account's failures. Attempts refused *because of* the
lock are not checked and not recorded as failures (otherwise a retrying user would stay locked
forever); each refusal is audit-logged as `auth.locked`. *(Amended 2026-11-01 by the Verifier
while writing US2-4 — the original text did not say whether refused attempts count.)*

## Room

| Field | Type | Rules | Source |
|---|---|---|---|
| id | uuid | | |
| name | text | 1–60 chars, unique (case-insensitive) | FR-007 |
| building | text | 1–60 chars | FR-007 |
| capacity | int | 1–50 | FR-007, FR-010 |
| equipment | set | subset of `whiteboard`, `projector`, `display-screen`, `video-conferencing` | FR-007 |
| inService | bool | default `true`; `false` hides the room from the list and blocks booking | FR-008 |
| createdAt / updatedAt | ms | | |

**State transitions**: `inService: true → false` cancels every *confirmed* booking of the room
with `start > now` (cancelledBy `system`, reason "Room taken out of service") — FR-016.
`false → true` changes nothing else.

## Booking

| Field | Type | Rules | Source |
|---|---|---|---|
| id | uuid | | |
| roomId | uuid → Room | | |
| userId | uuid → User \| null | `ON DELETE SET NULL` (anonymised after erasure) | FR-019 |
| start / end | ms | 30-min boundaries (campus time), `end − start ≥ 30 min`, within 08:00–22:00 of one campus-local date, `start > now` | FR-010 |
| partySize | int | 1 … room.capacity | FR-010 |
| purpose | text \| null | ≤ 100 chars, plain text; set to null on erasure (may contain personal data) | FR-009, FR-019 |
| status | enum | `confirmed` \| `cancelled` | |
| cancelledAt | ms \| null | | |
| cancelledBy | enum \| null | `owner` \| `admin` \| `system` | FR-013 |
| cancelReason | text \| null | required (1–200) when `cancelledBy = admin`; fixed text for `system` | FR-015, FR-016, FR-019 |
| createdAt | ms | | |

**Role limits (FR-012)**

| Role | Max duration | Max start ahead | Max upcoming |
|---|---|---|---|
| student | 2 h | 7 days | 3 |
| staff, admin | 4 h | 30 days | 10 |

"Upcoming" = `status = confirmed AND end > now`.

**Overlap (FR-011)**: two confirmed bookings of the same room overlap ⇔
`a.start < b.end AND b.start < a.end` (half-open intervals, so back-to-back is allowed).
Enforced (1) by the domain check inside the booking transaction and (2) by a SQLite
`BEFORE INSERT` trigger that aborts with `BOOKING_OVERLAP`.

**State transitions**

```text
confirmed ──(owner, before start)────────────▶ cancelled [cancelledBy=owner]
confirmed ──(admin, before end, reason)──────▶ cancelled [cancelledBy=admin, reason]
confirmed ──(room out of service, before start)▶ cancelled [cancelledBy=system]
confirmed ──(owner erased, before end)───────▶ cancelled [cancelledBy=system, "Account deleted"]
cancelled ── (terminal)
```

## AuditEvent (FR-020)

| Field | Type | Rules |
|---|---|---|
| id | integer | auto-increment (gives a stable "newest first" order) |
| at | ms | |
| actorUserId | uuid \| null | pseudonymous id only; never email, password or token |
| action | enum | `user.registered`, `auth.login.succeeded`, `auth.login.failed`, `auth.locked`, `auth.logout`, `user.erased`, `user.role_changed`, `room.created`, `room.updated`, `room.out_of_service`, `room.in_service`, `booking.cancelled_by_admin`, `maintenance.purged` |
| targetType / targetId | text \| null | e.g. `room` / room id |
| details | JSON | small structured facts (e.g. `{ "from": "student", "to": "staff" }`, `{ "emailHash": "…" }` for failed sign-in) — never raw email |

**Retention (FR-021)**: maintenance task deletes bookings with `end < now − 365 days` and audit
events with `at < now − 365 days`.

## Relationships

```text
User 1 ──── * Session
User 1 ──── * Booking (nullable after erasure)
Room 1 ──── * Booking
User 1 ──── * AuditEvent (as actor, pseudonymous)
```
