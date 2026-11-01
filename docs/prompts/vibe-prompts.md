# Vibe-Coding Prompt Log

AI tool: Claude Code, model `claude-opus-5-5`, run as a fresh sub-agent with **no access to the
specification** (it never saw `specs/` or the constitution). Every prompt below is verbatim.
The text in parentheses is the fixed "workspace rules" wrapper sent with each prompt so the agent
stayed inside its folder; it carries no product requirements.

| ID | Time (EET) | Purpose |
|----|------------|---------|
| V1 | 2026-11-01 17:41 | Single-line prompt, as in the "Vibe Coding Lifecycle" (prompt → solution based on assumptions) |

## V1 — initial prompt

```text
Build a web app where students at our university can book study rooms. Use Node.js. Keep it simple and make it work.

(Workspace rules: work only inside <repo>/vibe-prototype — do not touch anything outside that folder and do not run git commands. Don't ask me questions; make whatever assumptions you need. When you're done, tell me how to run it and briefly what you built.)
```

Expectation: a runnable app with a room list and a booking form. Deliberately no mention of
authentication, conflicts, time rules, or security — the point of vibe coding is to see which
assumptions the AI makes on its own.
