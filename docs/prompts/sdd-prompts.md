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
