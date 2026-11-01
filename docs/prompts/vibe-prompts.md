# Vibe-Coding Prompt Log

AI tool: Claude Code, model `claude-opus-5-5`, run as a fresh sub-agent with **no access to the
specification** (it never saw `specs/` or the constitution). Every prompt below is verbatim.
The text in parentheses is the fixed "workspace rules" wrapper sent with each prompt so the agent
stayed inside its folder; it carries no product requirements.

| ID | Time (EET) | Purpose |
|----|------------|---------|
| V1 | 2026-11-01 17:41 | Single-line prompt, as in the "Vibe Coding Lifecycle" (prompt → solution based on assumptions) |
| V2 | 2026-11-01 18:12 | Review-and-feedback prompt after trying V1 (feature gaps found by use) |

## V1 — initial prompt

```text
Build a web app where students at our university can book study rooms. Use Node.js. Keep it simple and make it work.

(Workspace rules: work only inside <repo>/vibe-prototype — do not touch anything outside that folder and do not run git commands. Don't ask me questions; make whatever assumptions you need. When you're done, tell me how to run it and briefly what you built.)
```

Expectation: a runnable app with a room list and a booking form. Deliberately no mention of
authentication, conflicts, time rules, or security — the point of vibe coding is to see which
assumptions the AI makes on its own.

### V1 — outcome (agent run: 38 tool calls)

What the AI built on its own assumptions: Express 5 + built-in `node:sqlite`, server-rendered HTML,
sign-up/login with scrypt-hashed passwords and cookie sessions with CSRF tokens, a day grid of
30-minute slots, booking rules it invented (08:00–22:00, ≤ 2 h, ≤ 14 days ahead, ≤ 3 upcoming,
no double booking, no two rooms at once), "My bookings" with cancel, 19 passing `node:test` tests.

| Expectation | Met? | Note |
|---|---|---|
| Runnable app | ✅ | `npm install && npm start`; 19/19 own tests pass (re-run by us) |
| Sensible booking rules | ⚠️ | plausible, but *invented*: 14-day horizon, "two rooms at once" rule — nobody asked for them |
| Rooms manageable | ❌ | rooms come from `rooms.json`; changing them requires **deleting the database (all users and bookings)** |
| University-only sign-up | ❌ | any email accepted unless an env var is set |
| Brute-force protection | ❌ | none (agent listed it as "left out") |
| Time zone | ⚠️ | uses the server's local time zone |
| Session storage | ⚠️ | session tokens stored in plain text in the DB; booking ids sequential integers |
| Cancellation history | ⚠️ | cancel = `DELETE` row — no record of who cancelled or why |
| Workspace rules respected | ❌ | its browser-automation tool wrote logs to `Personal/Soft/.playwright-mcp/` (outside the folder); the agent noticed and deleted them |

Failure mode observed: **silent scope decisions** — the AI filled every gap with a guess and
reported most of them honestly, but the guesses (e.g. rooms only via JSON file) would have been
unacceptable to the facilities stakeholder, and nothing forced that decision to be reviewed.

## V2 — feedback prompt (same chat, agent resumed)

```text
Looks good! A few things from trying it: the facilities office needs an admin page to add rooms and close a room for maintenance without wiping everyone's data; only @uni.example emails should be able to sign up; people should be able to download their data and delete their account (GDPR). Also stop people guessing passwords.

(Workspace rules: work only inside <repo>/vibe-prototype — do not create, modify or delete anything outside that folder, including files written by tools you use (e.g. browser-automation logs); prefer curl and your test suite for checking. No git commands. Don't ask me questions. When done, tell me what changed and how to run it.)
```

Refinement made to the *wrapper* after V1's failure: the rule now explicitly covers files written
by tools (browser logs) and steers the agent to curl/tests instead of a browser.
