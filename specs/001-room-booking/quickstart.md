# Quickstart & Validation Guide: RoomBook

## Prerequisites

- Node.js ≥ 24 (developed on 26.8) — `node -v`
- npm ≥ 10

## Install and run

```bash
npm ci
cp .env.example .env            # optional: change ADMIN_EMAIL / ADMIN_PASSWORD / TZ settings
npm run seed                    # creates the first admin (from env) and 6 demo rooms
npm start                       # http://localhost:3000  (UI)  ·  /api/v1 (API)
```

Configuration (environment variables): `PORT` (3000), `DB_FILE` (`data/roombook.db`),
`CAMPUS_TIME_ZONE` (`Europe/Helsinki`), `OPENING_HOURS` (`08:00-22:00`),
`ALLOWED_EMAIL_DOMAINS` (`uni.example`), `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`RATE_LIMIT_PER_MINUTE` (300).

## Validation scenarios

| # | Proves | How | Expected |
|---|---|---|---|
| Q1 | All acceptance scenarios (SC-001) | `npm run test:acceptance` | one passing test per scenario US1-1 … US5-3 |
| Q2 | Contract conformance (NFR-004) | `npm run test:contract` | every documented operation exercised; all responses valid against [openapi.yaml](./contracts/openapi.yaml) |
| Q3 | Concurrency (NFR-006, SC-003) | `npm run test:integration` | "20 parallel bookings → exactly 1 confirmed" passes |
| Q4 | Coverage gate (NFR-008) | `npm run test:coverage` | lines ≥ 85 % |
| Q5 | Performance (NFR-001, SC-004) | `npm run perf` | printed p95 for `/rooms` and `/availability` ≤ 300 ms |
| Q6 | Supply chain | `npm audit --omit=dev` | 0 high / critical |
| Q7 | Static checks | `npm run typecheck && npm run lint` | no errors |
| Q8 | Manual smoke (SC-002) | open the UI, register `you@uni.example`, sign in, filter capacity ≥ 4, open tomorrow's availability, book 10:00–11:00 | booking visible under "My bookings" in < 2 min |
| Q9 | Retention (FR-021) | `npm run purge` | prints numbers of deleted bookings/events |

## Smoke test with curl

```bash
BASE=http://localhost:3000/api/v1
curl -s -X POST $BASE/auth/register -H 'content-type: application/json' \
  -d '{"email":"alice@uni.example","displayName":"Alice","password":"correct horse battery"}'
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'content-type: application/json' \
  -d '{"email":"alice@uni.example","password":"correct horse battery"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s $BASE/rooms -H "authorization: Bearer $TOKEN"
```

Data model: [data-model.md](./data-model.md) · Decisions: [research.md](./research.md)
