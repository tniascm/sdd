/**
 * Acceptance-test harness (Verifier, T020).
 * Builds the real application (in-memory SQLite, fake clock, fast password hashing) and gives
 * tests an HTTP client whose every response is checked against the OpenAPI contract.
 * Tests talk to the system only through HTTP — they do not call services directly.
 */
import request from 'supertest';
import { buildContainer } from '../../src/container.ts';
import { createApp } from '../../src/http/app.ts';
import type { Config } from '../../src/config.ts';
import { FixedClock } from './fixed-clock.ts';
import { checkContract } from './contract.ts';

export const TEST_ADMIN = {
  email: 'admin@uni.example',
  password: 'admin-password-123',
  displayName: 'Facilities Admin',
};
export const PASSWORD = 'correct horse battery';

/** Monday 2026-11-02 08:00 campus time (Europe/Helsinki = UTC+2 in November). */
export const DEFAULT_NOW = '2026-11-02T06:00:00.000Z';
export const TODAY = '2026-11-02';
export const TOMORROW = '2026-11-03';

/** Campus-local wall time → UTC ISO string, with the offset stated explicitly by the test. */
export function at(date: string, time: string, offset = '+02:00'): string {
  return new Date(`${date}T${time}:00${offset}`).toISOString();
}

export interface Res {
  status: number;
  body: any;
  headers: Record<string, string>;
  text: string;
}

type Body = object | string | undefined;

export class Client {
  private readonly app: ReturnType<typeof createApp>;
  readonly token: string | undefined;
  constructor(app: ReturnType<typeof createApp>, token?: string) {
    this.app = app;
    this.token = token;
  }

  async send(method: string, path: string, body?: Body, opts: { contentType?: string } = {}): Promise<Res> {
    const url = `/api/v1${path}`;
    let req = (request(this.app) as any)[method.toLowerCase()](url);
    if (this.token) req = req.set('authorization', `Bearer ${this.token}`);
    if (opts.contentType) req = req.set('content-type', opts.contentType);
    if (body !== undefined) req = req.send(body);
    const r = await req;
    const res: Res = { status: r.status, body: r.body, headers: r.headers, text: r.text };
    checkContract(method, url, res.status, res.status === 204 ? undefined : res.body);
    return res;
  }

  get(path: string) { return this.send('GET', path); }
  post(path: string, body?: Body) { return this.send('POST', path, body); }
  put(path: string, body?: Body) { return this.send('PUT', path, body); }
  patch(path: string, body?: Body) { return this.send('PATCH', path, body); }
}

export interface TestUser {
  email: string;
  password: string;
  displayName: string;
  id: string;
  token: string;
  api: Client;
}

export interface Harness {
  clock: FixedClock;
  container: ReturnType<typeof buildContainer>;
  app: ReturnType<typeof createApp>;
  anon: Client;
  admin: TestUser;
  as(token: string): Client;
  newUser(opts?: { role?: 'student' | 'staff' | 'admin'; email?: string; displayName?: string }): Promise<TestUser>;
  login(email: string, password?: string): Promise<string>;
  /** Sign in again (sessions expire 8 h after sign-in — FR-002) and return the user with a fresh client. */
  relogin(user: TestUser): Promise<TestUser>;
  createRoom(input?: Partial<{ name: string; building: string; capacity: number; equipment: string[] }>): Promise<any>;
  book(user: TestUser, input: { roomId: string; start: string; end: string; partySize?: number; purpose?: string }): Promise<Res>;
  close(): void;
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    dbFile: ':memory:',
    timeZone: 'Europe/Helsinki',
    opensAt: '08:00',
    closesAt: '22:00',
    allowedEmailDomains: ['uni.example'],
    rateLimitPerMinute: 100_000,
    sessionTtlMs: 8 * 60 * 60 * 1000,
    admin: TEST_ADMIN,
    ...overrides,
  };
}

let userCounter = 0;
let roomCounter = 0;

export async function startHarness(opts: { now?: string; config?: Partial<Config>; dbFile?: string } = {}): Promise<Harness> {
  const clock = new FixedClock(opts.now ?? DEFAULT_NOW);
  const dbFile = opts.dbFile ?? ':memory:';
  const config = testConfig({ dbFile, ...opts.config });
  const container = buildContainer({ dbFile, clock, config, hasherParams: { N: 1024, r: 8, p: 1 } });
  await container.bootstrapAdmin();
  const app = createApp(container);
  const anon = new Client(app);

  async function login(email: string, password = PASSWORD): Promise<string> {
    const r = await anon.post('/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${r.text}`);
    return r.body.token;
  }

  const adminToken = await login(TEST_ADMIN.email, TEST_ADMIN.password);
  const adminMe = await new Client(app, adminToken).get('/me');
  const admin: TestUser = {
    ...TEST_ADMIN,
    id: adminMe.body.id,
    token: adminToken,
    api: new Client(app, adminToken),
  };

  const h: Harness = {
    clock,
    container,
    app,
    anon,
    admin,
    as: (token) => new Client(app, token),
    login,
    async relogin(user) {
      const token = await login(user.email, user.password);
      return { ...user, token, api: new Client(app, token) };
    },
    async newUser(o = {}) {
      userCounter += 1;
      const email = o.email ?? `user${userCounter}@uni.example`;
      const displayName = o.displayName ?? `User ${userCounter}`;
      const reg = await anon.post('/auth/register', { email, displayName, password: PASSWORD });
      if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${reg.text}`);
      if (o.role && o.role !== 'student') {
        const r = await admin.api.put(`/admin/users/${reg.body.id}/role`, { role: o.role });
        if (r.status !== 200) throw new Error(`role change failed: ${r.status} ${r.text}`);
      }
      const token = await login(email);
      return { email, password: PASSWORD, displayName, id: reg.body.id, token, api: new Client(app, token) };
    },
    async createRoom(input = {}) {
      roomCounter += 1;
      const r = await admin.api.post('/rooms', {
        name: input.name ?? `Room ${roomCounter}`,
        building: input.building ?? 'Main Library',
        capacity: input.capacity ?? 6,
        equipment: input.equipment ?? ['whiteboard'],
      });
      if (r.status !== 201) throw new Error(`createRoom failed: ${r.status} ${r.text}`);
      return r.body;
    },
    book(user, input) {
      return user.api.post('/bookings', { partySize: 2, ...input });
    },
    close() {
      container.close();
    },
  };
  return h;
}
