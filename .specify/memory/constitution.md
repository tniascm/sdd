# RoomBook Constitution

## Core Principles

### I. Specification Is the Source of Truth

- Every behaviour of the system MUST be traceable to a requirement ID (`FR-xxx`, `NFR-xxx`)
  in `specs/<feature>/spec.md`.
- Code, tests and prompts MUST NOT introduce behaviour that the specification does not describe.
  When the AI or a developer discovers a gap, the specification is amended first, then the code.
- Commit messages MUST reference the requirement or task IDs they implement (e.g. `feat(FR-005): …`).

Rationale: AI coding agents fill gaps with plausible guesses; a written, versioned specification
turns those guesses into reviewable decisions.

### II. Test-First (NON-NEGOTIABLE)

- Each acceptance scenario in the specification MUST have an automated test before the code
  that satisfies it is written.
- Tests MUST be run and observed failing (red) before implementation, then passing (green).
  The red and green runs are kept as evidence in `docs/evidence/`.
- Tests are named after the requirement they verify, so the traceability matrix can be generated
  from test titles.

Rationale: tests written from the spec, before code, are the only reliable check that
AI-generated code does what was specified and not merely what was prompted.

### III. Testable Architecture (Ports & Adapters)

- Business rules live in a pure domain layer with no I/O, no framework imports and no direct
  access to the system clock or randomness.
- Time, persistence, password hashing and token generation are reached through interfaces
  (ports) and injected; production adapters and in-memory test doubles implement the same port.
- HTTP handlers contain no business rules; they validate input, call an application service and
  map results to responses.

Rationale: controllability and observability are what make a design testable; injected clocks
and fakes make time- and storage-dependent rules deterministic to test.

### IV. Secure by Default

- The system MUST meet OWASP ASVS v4 Level 1 for the features it implements and MUST address the
  OWASP API Security Top 10 risks that apply (object-level authorisation, broken authentication,
  mass assignment, unrestricted resource consumption).
- Passwords MUST be stored only as salted, memory-hard hashes. Secrets MUST NOT be committed.
- All external input MUST be validated against an explicit schema; unknown fields are rejected.
- Database access MUST use parameterised statements only.
- Error responses MUST NOT leak stack traces, SQL or internal identifiers beyond what the API
  contract defines.

Rationale: security failures carry the highest cost of failure in a risk-driven design approach;
AI-generated code is known to omit authorisation and validation unless they are specified.

### V. Privacy by Design (GDPR)

- Only the personal data needed to run bookings is collected (university email, display name).
- Users MUST be able to export their data and erase their account; erasure removes personal data
  and anonymises historic bookings that are kept for room-usage statistics.
- Security-relevant events are written to an audit log that does not contain passwords or tokens.

Rationale: the system processes personal data of EU university members.

### VI. Simplicity

- Prefer the Node.js standard library over third-party packages; every runtime dependency MUST be
  justified in `plan.md` (research section).
- No speculative features (YAGNI): only what the specification requires.

Rationale: fewer dependencies mean a smaller attack surface and fewer hallucinated or outdated
package APIs from the AI.

## Additional Constraints

- Language and runtime: TypeScript in `strict` mode on Node.js 24 LTS or newer.
- Persistence: an embedded SQL database is sufficient for the course scope; the data layer MUST
  sit behind repository ports so it can be replaced.
- The HTTP API is described by an OpenAPI 3.1 document in `specs/<feature>/contracts/`, and the
  implementation MUST be checked against it by automated contract tests.
- All timestamps are stored and exchanged in UTC (ISO 8601); campus-local rules (opening hours)
  are evaluated in a single configured IANA time zone.

## Development Workflow & Quality Gates

Workflow: `/speckit-constitution` → `/speckit-specify` → `/speckit-clarify` → `/speckit-plan`
→ `/speckit-tasks` → `/speckit-analyze` → tests (red) → `/speckit-implement` (green) → review.

A change may be merged to `main` only when all of the following hold:

1. All automated tests pass (unit, integration, contract, acceptance).
2. Line coverage of `src/` is at least 85 %.
3. `npm audit --omit=dev` reports no high or critical vulnerabilities.
4. The type checker and linter report no errors.
5. An independent review (a fresh AI reviewer that has not seen the implementation conversation,
   followed by a human sign-off) has been carried out and its findings are resolved or recorded
   in the code audit log (`docs/evidence/audit-log.md`).

## Governance

- This constitution supersedes ad-hoc practices and prompts. Where a prompt and the constitution
  disagree, the constitution wins and the prompt is corrected.
- Amendments are made through `/speckit-constitution`, recorded in git with a version bump:
  MAJOR for removing or redefining a principle, MINOR for adding one, PATCH for wording.
- Every review checks compliance with the principles above; deviations require a written
  justification in the Complexity Tracking section of `plan.md`.
- Runtime guidance for AI agents lives in `CLAUDE.md` and MUST stay consistent with this document.

**Version**: 1.0.0 | **Ratified**: 2026-11-01 | **Last Amended**: 2026-11-01
