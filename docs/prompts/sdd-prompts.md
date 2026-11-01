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
