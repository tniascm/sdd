# Specification-Driven Development Prompt Log

SDD toolkit: GitHub Spec Kit v1.2.5 (commands installed as Claude Code skills `/speckit-*`).
AI tool: Claude Code, model `claude-opus-5-5` (orchestrating agent), plus fresh sub-agents for
independent tasks where noted. Prompts are verbatim; outcomes are recorded as they happened.

## SDD-P1 — `/speckit-constitution`

```text
/speckit-constitution RoomBook is a campus study-room booking system built for a software-construction
course. Principles: (1) the specification is the single source of truth — every change traces to a
requirement ID; (2) test-first — acceptance tests derived from the spec's acceptance scenarios are
written and observed failing before implementation; (3) testable architecture — pure domain core,
ports & adapters, injectable clock, no I/O in the domain; (4) secure by default — OWASP ASVS L1 /
OWASP API Top 10, hashed passwords, object-level authorisation, schema validation, parameterised SQL;
(5) privacy by design (GDPR) — data minimisation, export, erasure; (6) simplicity — minimal
dependencies, YAGNI. Quality gates: all tests green, >= 85 % line coverage, no high/critical
npm audit findings, independent AI review + human sign-off. Runtime: TypeScript strict on Node.js 24+.
```

- Purpose: fix non-negotiable rules *before* any feature prompt, so later prompts can say
  "follow the constitution" instead of repeating security/testing instructions.
- Output: `.specify/memory/constitution.md` v1.0.0 (6 principles, constraints, quality gates, governance).
- Assessment: met expectations. The template's five principle slots were extended to six
  (allowed by the command: "the user might require less or more principles").

## SDD-P2 — `/speckit-specify`

```text
/speckit-specify Build RoomBook, a web application and HTTP API that lets members of a university book
shared study rooms. Actors: students, staff, facilities administrators. Students and staff register with
their university email address and a password, sign in, browse rooms (name, building, capacity,
equipment), see a room's free and booked times for a given day, book a room for a time slot, see their
upcoming bookings and cancel them. Booking rules: bookings are in 30-minute steps inside opening hours
(08:00–22:00 campus time), cannot start in the past, cannot overlap another booking of the same room,
party size cannot exceed room capacity, and students have tighter limits than staff on booking length,
how far ahead they can book and how many upcoming bookings they can hold. Facilities administrators
manage rooms (add, edit, take out of service) and can see and cancel any booking. Because the system
stores personal data of EU users, users can download their data and delete their account. Repeated
failed sign-ins must be throttled, and security-relevant events must be audit-logged.
```

- Purpose: describe **what** and **why** only (no technology), as Spec Kit requires at this stage.
- Reasoning: every rule a vibe-coding agent would otherwise guess (overlaps, limits, privacy, lockout)
  is stated up front, so it becomes a testable requirement instead of an AI assumption.
- Output: `spec.md` with 5 prioritised user stories, 23 acceptance scenarios, 20 FRs, 9 NFRs,
  6 success criteria, explicit assumptions; plus `checklists/requirements.md`.
- What did not go to plan: the built-in quality validation (iteration 1) caught a contradiction that
  the agent itself had written — FR-013 listed only *upcoming* bookings while the Assumptions promised
  users could see why an administrator cancelled their booking. Fixed in iteration 2 by widening FR-013.
  Lesson: the self-validation checklist is worth running even on AI-written specs.
- Two `[NEEDS CLARIFICATION]` markers were left on purpose (FR-016, FR-019) — decisions with no safe default.

## SDD-P3 — `/speckit-clarify`

```text
/speckit-clarify
```

- Purpose: structured ambiguity scan (functional scope, data, UX, non-functional, integration, edge
  cases, constraints, terminology, completion signals) and at most 5 targeted questions.
- Normally interactive (the human answers each question). In this autonomous run the agent answered
  each question with the option the command itself recommended, and the spec labels the answers as
  agent decisions for the team to review.
- Questions and answers (recorded in the spec's `## Clarifications` section):
  1. Room taken out of service → its not-yet-started bookings are cancelled with a reason (FR-016).
  2. Account deletion with upcoming bookings → cancel them, then erase (FR-019).
  3. Administrator cancellation → mandatory reason of 1–200 characters (FR-015).
  4. Retention → anonymous bookings and audit events deleted after 12 months (new FR-021).
  5. General request limit → 300 requests/minute/client address (new NFR-010; OWASP API4).
- Outcome: 0 markers left; spec quality checklist 15/16 → 16/16.

## SDD-P4 — `/speckit-plan`

```text
/speckit-plan Use TypeScript on Node.js 24+ with as few dependencies as possible: Express for HTTP,
the built-in SQLite module for storage, built-in crypto for password hashing and session tokens, zod
for request validation, and a plain HTML/CSS/JS front end with no build step served by the same
process. Keep business rules in a pure domain layer behind ports (ports & adapters) with an
injectable clock. Test with Vitest and supertest; describe the API in OpenAPI 3.1 and test the
implementation against it.
```

- Purpose: the **how** — technology choices and architecture, kept out of the spec on purpose.
- Output: `plan.md` (technical context, constitution gate table, source layout, error mapping),
  `research.md` (11 decisions with rationale and rejected alternatives), `data-model.md`
  (5 entities, invariants, state transitions), `contracts/openapi.yaml` (21 operations — first written as "22" in plan.md; corrected by `/speckit-analyze`),
  `quickstart.md` (9 validation scenarios).
- What did not go to plan, and how it was handled:
  1. **Dependency compatibility.** "Use the latest TypeScript" would have installed 7.0.2, but
     `typescript-eslint@8.72.1` requires `typescript < 6.1`. Found by running `npm view … peerDependencies`
     during research rather than trusting memory; TypeScript pinned to 6.0.3 (research R1).
  2. **Runtime API assumption.** scrypt with N = 2^15, r = 8 fails with Node's default `maxmem`
     (`ERR_CRYPTO_INVALID_SCRYPT_PARAMS`). Verified with a probe; `maxmem` set to 64 MiB (R4).
  3. **Contract defect.** The first OpenAPI draft composed `AdminBooking` with `allOf: [Booking]`
     while `Booking` had `additionalProperties: false` — every admin response would have failed
     validation. Fixed with a `BookingBase` + `unevaluatedProperties: false` (JSON Schema 2020-12).
- Assessment: the research step paid off — two of the three defects were "plausible but wrong"
  facts of the kind an AI states confidently; probing the real environment caught them.

## SDD-P5 — `/speckit-tasks`

```text
/speckit-tasks Tests are required (constitution Principle II). Separate two roles: a Verifier who
writes acceptance/contract tests and test support from the spec, and an Implementer who writes
production code and may not edit the Verifier's tests. Quote data-model constraints verbatim in
task descriptions. Implement US2 (auth) before US1 because booking needs a signed-in user.
```

- Purpose: turn the plan into small, ordered, file-specific tasks an AI agent can execute one by one.
- Reasoning for the Verifier/Implementer split: if the same AI writes code *and* adjusts the tests
  until they pass, the tests stop being an independent check. The split makes "weakening a test"
  a visible process violation rather than a silent fix.
- Output: `tasks.md` — 53 tasks in 8 phases (setup, foundational, US2, US1, US3, US4, US5, polish).

## SDD-P6 — `/speckit-analyze`

```text
/speckit-analyze
```

- Purpose: read-only cross-artifact consistency check before any code exists.
- Result (`docs/evidence/speckit-analyze-report.md`): 7 findings — **1 CRITICAL** (constitution
  quality gate 5 "independent review" had no task), **1 HIGH** (usability NFR-007 / SC-002 never
  verified), 1 MEDIUM (terminology drift "active room" vs "in service"), 4 LOW (operation count
  22 → 21 in plan.md; 10 requirement IDs only implicitly covered; lockout scope note; vague
  "developer laptop").
- Remediation applied: tasks T054 (independent review → audit log) and T055 (usability walkthrough)
  added; spec wording normalised; plan corrected; IDs cited in tasks → 55 tasks, 37/37 requirements mapped.
- Assessment: this step found defects in artifacts written minutes earlier by the same AI — evidence
  that an AI-written plan still needs an explicit consistency pass before implementation.

## SDD-P7 — `/speckit-implement` (Phase 1–2, fresh Implementer sub-agent)

```text
/speckit-implement Phase 1 and Phase 2 only — tasks T001–T019. (T020 belongs to the Verifier.)

You are the **Implementer** in a Spec-Driven Development project that uses GitHub Spec Kit. […]
1. Read and follow `.claude/skills/speckit-implement/SKILL.md` (that file IS the `/speckit-implement`
   command). Its inputs are in `specs/001-room-booking/` […] Treat these as the source of truth.
   Don't add behaviour they don't describe. If something in them looks wrong or contradictory,
   don't silently deviate — implement the closest faithful reading and list the problem in your report.
2. Execute T001–T019 in order, test-first where the task says so […] Mark each finished task [X].
3. Use Node 26 […] install the exact versions listed in plan.md with `npm install --save-exact`.
   TypeScript must be 6.0.3 (see research R1).

Fixed interface — the Verifier is writing acceptance tests against this in parallel, so match it exactly:
- ports.ts: `export interface Clock { now(): number }` …
- config.ts: `export type Config = { port; dbFile; timeZone; opensAt; closesAt; allowedEmailDomains;
  rateLimitPerMinute; sessionTtlMs; admin }` and `loadConfig(env)` …
- container.ts: `buildContainer({ dbFile, clock, config, hasherParams? })` exposing config, clock, db,
  bootstrapAdmin(), close() and the services …
- http/app.ts: `createApp(container)`; routes under /api/v1; unknown /api paths → JSON 404 NOT_FOUND …

Boundaries: write only package/config files, src/**, public/**, scripts/**, tests/unit/**,
tests/integration/** (except concurrency.test.ts) and the [X] boxes in tasks.md. Do NOT edit
tests/acceptance, tests/contract, tests/support, docs, vibe-prototype, .specify, .claude or other spec
files. Commit per logical group with `git add <explicit paths>`, messages `feat(foundation): … (T0xx; FR-xxx)`.
Report: tasks done, test summary, typecheck/lint, commits, spec problems found, deviations.
```

(Full text in the session transcript; elided parts are the file lists repeated from tasks.md.)

- Reasoning: (1) the agent gets *the command file*, not a hand-written summary, so the Spec Kit workflow
  itself drives it; (2) a **fixed interface** lets Verifier and Implementer work in parallel without
  seeing each other's code; (3) explicit write-boundaries + "never `git add -A`" protect the
  Verifier's tests and the parallel vibe agent's folder; (4) "report, don't silently deviate" turns
  spec defects into amendments instead of hidden code decisions.

## Verifier findings while writing tests from the spec (before any code existed)

| # | Found while writing | Defect | Resolution |
|---|---|---|---|
| VF-1 | test harness (contract checker) | NFR-010 limits *every* operation, but the contract documented `429` only on register/login → a correct `429` elsewhere would be a contract violation | `429 TooManyRequests` added to all 21 operations in `openapi.yaml` |
| VF-2 | US2-4 lockout test | data-model did not say whether attempts refused *during* a lock count as new failures — if they did, a user who keeps retrying would be locked forever | data-model amended: refused attempts are not failures, but are audit-logged |
| VF-3 | US4-4 admin day view | first draft of the test asserted an ordering that FR-015 never specifies | test made order-independent (tests must not invent requirements either) |
