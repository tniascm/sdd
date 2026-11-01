/**
 * `npm run perf` (T051; NFR-001, SC-004): 50 rooms, 5,000 bookings, 20 concurrent clients.
 * Measures every request to GET /rooms and GET /rooms/{id}/availability over real HTTP and
 * prints the 95th percentile per endpoint (computed directly — research R10).
 *
 * Runs against a throw-away database file with the real stack (Express, SQLite in WAL mode).
 * The load generator is one network address, so the per-client limit (NFR-010) is raised for
 * this run; scrypt uses cheap parameters because sign-in is not measured.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.ts';
import { buildContainer } from '../src/container.ts';
import { localDate, localToUtc, nextLocalDate } from '../src/domain/campus-time.ts';
import type { Equipment } from '../src/domain/types.ts';
import { createApp } from '../src/http/app.ts';
import { systemClock } from '../src/infrastructure/system-clock.ts';

const ROOMS = 50;
const BOOKINGS = 5_000;
const CLIENTS = 20;
const REQUESTS_PER_ENDPOINT = 2_000;
const WARM_UP = 100;
const TARGET_P95_MS = 300;
const EQUIPMENT: Equipment[] = ['whiteboard', 'projector', 'display-screen', 'video-conferencing'];

const dir = mkdtempSync(join(tmpdir(), 'roombook-perf-'));
const config = { ...loadConfig({}), dbFile: join(dir, 'perf.db'), rateLimitPerMinute: 1_000_000, admin: null };
const container = buildContainer({ dbFile: config.dbFile, clock: systemClock, config, hasherParams: { N: 1024, r: 8, p: 1 } });
const server = createApp(container).listen(0);

try {
  // ------------------------------------------------------------ data set
  const rooms = Array.from({ length: ROOMS }, (_, i) =>
    container.rooms.create(null, {
      name: `Perf Room ${String(i + 1).padStart(2, '0')}`,
      building: `Building ${String.fromCharCode(65 + (i % 5))}`,
      capacity: 2 + (i % 20),
      equipment: EQUIPMENT.filter((_, k) => (i >> k) & 1),
    }),
  );

  const tokens: string[] = [];
  const users: string[] = [];
  for (let i = 0; i < CLIENTS; i++) {
    const email = `perf${i}@uni.example`;
    const user = await container.auth.register({ email, displayName: `Perf User ${i}`, password: 'perf-password-123' });
    users.push(user.id);
    tokens.push((await container.auth.login(email, 'perf-password-123')).token);
  }

  // 100 one-hour bookings per room: 10 campus days (3 past, today, 6 ahead) × 10 slots from 08:00.
  const tz = config.timeZone;
  let day = localDate(systemClock.now() - 3 * 86_400_000, tz);
  const days: string[] = [];
  for (let d = 0; d < 10; d++, day = nextLocalDate(day)) days.push(day);
  const perRoom = BOOKINGS / ROOMS;
  container.uow.transaction(() => {
    let n = 0;
    for (const room of rooms) {
      for (let k = 0; k < perRoom; k++, n++) {
        const date = days[Math.floor(k / 10)];
        const hour = 8 + (k % 10);
        const start = localToUtc(date, `${String(hour).padStart(2, '0')}:00`, tz);
        container.repos.bookings.insert({
          id: randomUUID(), roomId: room.id, userId: users[n % CLIENTS], start, end: start + 3_600_000,
          partySize: 1, purpose: n % 3 === 0 ? 'Study group' : null, status: 'confirmed',
          cancelledAt: null, cancelledBy: null, cancelReason: null, createdAt: systemClock.now(),
        });
      }
    }
  });
  const stored = (container.db.prepare('SELECT COUNT(*) AS n FROM bookings').get() as { n: number }).n;

  // ------------------------------------------------------------ load
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/v1`;
  const endpoints = {
    'GET /rooms': () => `${base}/rooms`,
    'GET /rooms/{id}/availability': () =>
      `${base}/rooms/${rooms[Math.floor(Math.random() * ROOMS)].id}/availability?date=${days[Math.floor(Math.random() * days.length)]}`,
  };
  type Name = keyof typeof endpoints;
  const names = Object.keys(endpoints) as Name[];
  const latencies: Record<Name, number[]> = { 'GET /rooms': [], 'GET /rooms/{id}/availability': [] };
  let errors = 0;

  async function hit(name: Name, token: string, record: boolean) {
    const started = performance.now();
    const res = await fetch(endpoints[name](), { headers: { authorization: `Bearer ${token}` } });
    await res.arrayBuffer();
    const ms = performance.now() - started;
    if (res.status !== 200) errors += 1;
    if (record) latencies[name].push(ms);
  }

  async function run(total: number, record: boolean) {
    let next = 0;
    await Promise.all(
      tokens.map(async (token) => {
        while (next < total * names.length) {
          const i = next++;
          await hit(names[i % names.length], token, record);
        }
      }),
    );
  }

  await run(WARM_UP, false);
  const t0 = performance.now();
  await run(REQUESTS_PER_ENDPOINT, true);
  const seconds = (performance.now() - t0) / 1000;

  // ------------------------------------------------------------ report
  const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  console.log(`RoomBook performance (NFR-001): ${ROOMS} rooms, ${stored} bookings, ${CLIENTS} concurrent clients`);
  console.log(`${REQUESTS_PER_ENDPOINT} measured requests per endpoint in ${seconds.toFixed(1)} s; non-200 responses: ${errors}`);
  console.log('');
  console.log('endpoint                        requests   p50 ms   p95 ms   p99 ms   max ms');
  let pass = errors === 0;
  for (const name of names) {
    const sorted = [...latencies[name]].sort((a, b) => a - b);
    const p95 = pct(sorted, 95);
    if (p95 > TARGET_P95_MS) pass = false;
    console.log(
      `${name.padEnd(30)} ${String(sorted.length).padStart(9)} ${pct(sorted, 50).toFixed(1).padStart(8)} ` +
        `${p95.toFixed(1).padStart(8)} ${pct(sorted, 99).toFixed(1).padStart(8)} ${sorted[sorted.length - 1].toFixed(1).padStart(8)}`,
    );
  }
  console.log('');
  console.log(`${pass ? 'PASS' : 'FAIL'}: p95 target ≤ ${TARGET_P95_MS} ms for both endpoints${errors ? `, ${errors} errors` : ''}`);
  process.exitCode = pass ? 0 : 1;
} finally {
  server.close();
  container.close();
  rmSync(dir, { recursive: true, force: true });
}
