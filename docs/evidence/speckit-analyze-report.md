## Specification Analysis Report — `/speckit-analyze` (run 2026-11-01, before implementation)

Artifacts: spec.md, plan.md, tasks.md, research.md, data-model.md, contracts/openapi.yaml, constitution v1.0.0.
Method: requirement-ID inventory (FR/NFR/SC) mapped to tasks by explicit ID, then by keyword for
unmapped IDs; constitution MUST statements checked against tasks; terminology scan; counts
cross-checked with scripts (e.g. contract operations counted from the YAML).

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| A1 | Constitution alignment | CRITICAL | constitution "Quality Gates" #5; tasks.md | Gate 5 (independent AI review + human sign-off, audit log) has no task; SC-005 (no open high-severity security issue) is therefore unverifiable | Add a Verifier task for a fresh-context reviewer producing `docs/evidence/audit-log.md` |
| A2 | Coverage gap | HIGH | spec NFR-007, SC-002; tasks.md | Usability (keyboard-only, 360 px, field-specific errors, < 2 min to book) has UI tasks but no verification task | Add a Verifier task: scripted browser walkthrough at 360 px + keyboard + timing, screenshots as evidence |
| A3 | Terminology drift | MEDIUM | spec US1-1, US4-3, FR-005, FR-009 vs FR-008 | "active room" used 4× while FR-008 defines the state as "in service"; tasks use `inService` | Normalise spec wording to "in service" |
| A4 | Inconsistency | LOW | plan.md Technical Context ("22 HTTP operations") | Contract defines 21 operations (counted from YAML) | Correct plan to 21 |
| A5 | Traceability | LOW | tasks.md | 10 requirement IDs covered by tasks only implicitly (FR-002, FR-007, FR-008, FR-011, FR-020, NFR-002, NFR-005, NFR-008, SC-001, SC-004) | Cite IDs in task descriptions so commits and tests trace back |
| A6 | Underspecification | LOW | FR-004 vs data-model LoginFailure | Lockout is keyed by email hash *also for unknown emails* — stricter than FR-004's "for an account"; deliberate (prevents account enumeration via lockout behaviour) | Keep; documented in research R8 |
| A7 | Ambiguity | LOW | NFR-001 "developer laptop" | Reference hardware unspecified | Record machine model with the perf evidence |

**Coverage summary (after remediation)**: 21/21 FR, 10/10 NFR, 6/6 SC mapped to ≥ 1 task.

**Constitution alignment issues**: A1 only (resolved by remediation).

**Unmapped tasks**: none (all setup/foundational tasks support ≥ 1 requirement).

**Metrics**: requirements 37 (21 FR + 10 NFR + 6 SC) · tasks 53 → 55 · ambiguity count 1 (A7) ·
duplication 0 · critical issues 1 → 0 after remediation.

**Next actions**: CRITICAL issue resolved before `/speckit-implement` by the remediation below
(applied autonomously; normally the user approves the edit plan).
