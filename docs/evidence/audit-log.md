# Code & Specification Audit Log — RoomBook (SDD build)

Constitution quality gate 5 and success criterion SC-005. Every defect found during the SDD build is
listed: where it was found, by which technique, and how it was resolved. Detailed evidence is in the
linked files. "AI" = a Claude Code agent. In this autonomous run the human roles (product owner,
reviewer) were played by the orchestrating agent; the <mark>**human sign-off at the end is still open**</mark>.

## 1. Specification and design defects (caught before code existed)

| ID | Found by (technique) | Issue | Resolution | Status |
|---|---|---|---|---|
| S-1 | AI — `/speckit-specify` self-validation checklist | FR-013 listed only upcoming bookings while Assumptions promised users see admin cancellation reasons | FR-013 widened (`include=all`) | Fixed |
| S-2 | AI — environment probe (`npm view … peerDependencies`) | "Latest" TypeScript 7.0.2 incompatible with typescript-eslint 8.72.1 (`<6.1`) | TypeScript pinned to 6.0.3 (research R1) | Fixed |
| S-3 | AI — runtime probe (`node -e scryptSync…`) | OWASP scrypt parameters rejected by Node's default `maxmem` (`ERR_CRYPTO_INVALID_SCRYPT_PARAMS`) | `maxmem` 64 MiB (research R4) | Fixed |
| S-4 | AI — contract compiled with ajv | `AdminBooking = allOf[Booking]` with `additionalProperties:false` would reject every admin response | `BookingBase` + `unevaluatedProperties:false` | Fixed |
| A1 | AI — `/speckit-analyze` | CRITICAL: constitution gate 5 (independent review) had no task | T054 added | Fixed |
| A2 | AI — `/speckit-analyze` | HIGH: NFR-007/SC-002 usability never verified | T055 added | Fixed |
| A3–A7 | AI — `/speckit-analyze` | terminology drift, wrong operation count, implicit traceability, lockout scope note, vague hardware | spec/plan/tasks edited; A6/A7 documented | Fixed |
| VF-1 | AI Verifier — writing the contract checker | 429 (NFR-010) undocumented on 19 operations | contract amended | Fixed |
| VF-2 | AI Verifier — writing US2-4 | unclear whether lock-refused attempts count as failures (risk: permanent lock) | data-model amended | Fixed |
| VF-3 | AI Verifier — self-review of test | test asserted an order FR-015 never specifies | test made order-independent | Fixed |

## 2. Defects in the tests (the Verifier's own mistakes)

| ID | Found by | Issue | Resolution | Status |
|---|---|---|---|---|
| VF-4 | AI Implementer report | NFR-010 test ignored the harness's own 2 requests → a *correct* limiter failed it | test starts in a fresh window | Fixed |
| VF-5 | AI Implementer report (+ its own proving test) | 3 US3 tests reused a session across a 25-h clock jump; FR-002 correctly expired it | tests sign in again (`h.relogin`) | Fixed |
| L-1 | AI Implementer (lint) | 28 `no-explicit-any` errors in Verifier test files | `any` allowed in `tests/**` only | Fixed |

## 3. Implementation defects

| ID | Sev. | Found by (technique) | Issue | Resolution | Status |
|---|---|---|---|---|---|
| I-1 | Medium | AI Implementer — own 360-px browser walkthrough | CSS `display` overrode the `hidden` attribute → "Sign out" visible when signed out; same rule could expose admin-only UI | `[hidden]{display:none!important}` | Fixed |
| I-2 | Low | same | audit/session times shown in browser time zone | campus time | Fixed |
| I-3 | Low | same | sign-out left the previous user's data on screen | UI reset on sign-out | Fixed |
| D-1 | Low | AI Implementer report | data-model lockout wording self-contradictory | wording corrected | Fixed |
| **R-1** | **High** | **Independent AI reviewer (fresh context) — concurrency probe on a real server, production scrypt** | FR-004 lockout bypassed by parallel attempts: lock checked before `await verify`, failure recorded after (100 parallel → 99×401 + **1×200**, 0 lock events) | spec FR-004 + data-model amended → red regression tests (10- and 30-request bursts) → attempt recorded as failure *before* verifying in one synchronous step (`password-attempts.ts`) | Fixed — re-review: 100 parallel logins (prod scrypt) → 5×401, 95×429, no session |
| R-2 | Medium | reviewer — on-disk byte search after erasure | email/name survived in `.db`/WAL free pages (SC-006 fails on disk) | `PRAGMA secure_delete=ON` + WAL checkpoint after erasure | Fixed — re-review: no email/name in .db or WAL (see N-1) |
| R-3 | Medium | reviewer — code reading | unsalted SHA-256 of email in audit details, readable by admins, survives erasure | audit events carry account id only | Fixed — residual: `login_failures` keeps unsalted hash ≤ 24 h, not exposed (accepted, R14) |
| R-4 | Medium | reviewer — config reading | example admin password accepted at start-up | empty in `.env.example`; placeholder rejected | Fixed |
| R-5 | Low | reviewer | no `Cache-Control: no-store` on token / personal-data responses | `no-store` on all `/api` responses | Fixed |
| R-6 | Low | reviewer — 200k-address probe | rate-limit map unbounded; proxy/IPv6 weaknesses | expired windows evicted; proxy/IPv6 = **accepted risk** (R14) | Fixed partially — memory bounded per window, not capped; proxy/IPv6 accepted |
| R-7 | Low | reviewer | password re-entry for erasure not throttled | counts towards FR-004 lock | Fixed — 30 parallel wrong passwords → 5×403, 25×429 |
| R-8 | Low | reviewer — boundary probe | years 0000–0099 → 500 (`Date.UTC` maps 0–99 to 1900+) | dates limited to 2000–2099; campus-time bug fixed | Fixed |
| R-9 | Low | reviewer | `login_failures`/`sessions` never purged | purge after 24 h (FR-021) | Fixed |
| R-10 | Low | reviewer | admin free-text cancel reason survives erasure | reasons erased on erasure | Fixed |
| R-11 | Low | reviewer | UI used browser time zone before availability loaded | `/health` exposes campus zone; UI waits for it | Fixed — verified in a real browser with a different campus time zone |
| R-12 | Info | reviewer | CSP without `base-uri` / `form-action` | added | Fixed |
| R-13 | Info | reviewer | overlap trigger covers INSERT only | **accepted** — no code path re-confirms a booking | Accepted |
| R-14 | Info | reviewer | ASVS L1 items outside the spec: breached-password check, password change, email verification; per-account lockout allows targeted lock-out | <mark>**accepted risk — needs your decision**</mark> (research R14) | Accepted |
| U-1 | Medium | Verifier — keyboard-only 360-px walkthrough | End list not updated when Start changes → error on first try | End rebuilt after Start, Start + 1 h preselected | Fixed |
| U-2 | Low | same | dates in browser locale ((non-English month name)) in an English UI | `en-GB` formatting, campus time | Fixed |
| U-3 | Low | same | `favicon.ico` 404 on every load | `favicon.svg` + `<link rel=icon>` | Fixed |
| U-4 | Info | same | deletion password form without username field | hidden read-only username + visible "Account:" line | Fixed |

## 4. How the flaws were resolved — technique

1. **Spec first** (constitution Principle I): every accepted behaviour change was written into
   `spec.md` / `data-model.md` / `research.md` before code changed (markers "Amended after …").
2. **Red regression test** by the Verifier, observed failing for the right reason
   (`docs/evidence/test-run-3-review-regressions-red.txt`; e.g. "expected 10 to be ≤ 5").
3. **Fix by the Implementer** without touching Verifier tests; the Implementer also wrote its own
   lower-level test first (e.g. `tests/integration/sign-in-race.test.ts` counts `verify` calls) and
   checked that the R-2 test fails with the fix disabled (guarding against a test that passes by accident).
4. **Independent re-run of all gates** by the Verifier (`docs/evidence/final-gates/`).
5. **Re-review by the same independent reviewer** with its own probes (results below).

## 5. Re-review and verdict

Re-review by the same independent reviewer, with its own probes rather than the new tests, on
2026-11-01 (details: `docs/evidence/review-findings.md`, section "Re-review"):

**Verdict: SC-005 MET** — no High-severity issue open. SC-006 holds in normal operation.

New findings from the re-review — **open at release**, recorded per constitution gate 5:

| ID | Sev. | Finding | Planned resolution | Owner |
|---|---|---|---|---|
| N-1 | Low | After erasure, `wal_checkpoint(TRUNCATE)` blocks the server for the 5 s busy timeout if another connection (backup, `sqlite3` shell, `npm run purge`) is reading; the "busy" result is ignored and the WAL keeps the erased email/name until the next checkpoint (measured: 5,171 ms erase, 416 KB WAL containing both strings) | check the checkpoint result; retry in the background with a short timeout; document that backups must use SQLite's online backup API; add a regression test with a concurrent reader | <mark>[Your name]</mark> |
| N-2 | Info | Rate-limiter eviction assumes a monotonic clock; after the system clock steps back by J s, an expired window can keep refusing a client for up to J s | keep the per-key expiry check in `hit()` or use `performance.now()` | <mark>[Your name]</mark> |

## 6. Human sign-off

One-person team — the sole member signs for all roles.

| Role | Name | Decision on accepted risks R-6 (proxy/IPv6), R-13, R-14 and open N-1, N-2 | Date | Signature |
|---|---|---|---|---|
| Specifier · Prompt engineer · Verifier | <mark>[Your name]</mark> | <mark>[accept / schedule each]</mark> | <mark>[date]</mark> | <mark>[signature]</mark> |
