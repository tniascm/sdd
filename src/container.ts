/**
 * Composition root: wires the production adapters into the application services.
 * Tests build it with ':memory:', a fake Clock and cheap scrypt parameters.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AccountService } from './application/account-service.ts';
import { AuditService } from './application/audit-service.ts';
import { AuthService } from './application/auth-service.ts';
import { BookingService } from './application/booking-service.ts';
import type { Clock, PasswordHasher, Repositories, TokenService, UnitOfWork } from './application/ports.ts';
import { RoomService } from './application/room-service.ts';
import type { Config } from './config.ts';
import { ScryptHasher, type ScryptParams } from './infrastructure/scrypt-hasher.ts';
import { openDatabase } from './infrastructure/sqlite/database.ts';
import { createSqliteRepositories } from './infrastructure/sqlite/repositories.ts';
import { SqliteUnitOfWork } from './infrastructure/sqlite/unit-of-work.ts';
import { CryptoTokenService } from './infrastructure/token-service.ts';

export type BuildContainerOptions = {
  dbFile: string;
  clock: Clock;
  config: Config;
  /** scrypt parameters; production defaults (research R4) when omitted */
  hasherParams?: ScryptParams;
};

export type Container = {
  config: Config;
  clock: Clock;
  /** The SQLite handle (tests inspect stored data through it). */
  db: DatabaseSync;
  repos: Repositories;
  uow: UnitOfWork;
  hasher: PasswordHasher;
  tokens: TokenService;
  audit: AuditService;
  auth: AuthService;
  rooms: RoomService;
  bookings: BookingService;
  accounts: AccountService;
  /** Creates the administrator from `config.admin` unless an account with that email exists. */
  bootstrapAdmin(): Promise<void>;
  close(): void;
};

export function buildContainer(opts: BuildContainerOptions): Container {
  const { clock, config } = opts;
  const db = openDatabase(opts.dbFile);
  const repos = createSqliteRepositories(db);
  const uow = new SqliteUnitOfWork(db);
  const hasher = new ScryptHasher(opts.hasherParams);
  const tokens = new CryptoTokenService();
  const audit = new AuditService(repos.auditEvents, clock);
  const auth = new AuthService({
    users: repos.users,
    sessions: repos.sessions,
    loginFailures: repos.loginFailures,
    tokens,
    hasher,
    clock,
    uow,
    audit,
    config,
  });
  const rooms = new RoomService({ rooms: repos.rooms, bookings: repos.bookings, uow, audit, clock, config });
  const bookings = new BookingService({ rooms: repos.rooms, bookings: repos.bookings, uow, audit, clock, config });
  const accounts = new AccountService({
    users: repos.users,
    bookings: repos.bookings,
    loginFailures: repos.loginFailures,
    hasher,
    tokens,
    clock,
    uow,
    audit,
  });

  async function bootstrapAdmin(): Promise<void> {
    const admin = config.admin;
    if (!admin) return;
    const email = admin.email.trim().toLowerCase();
    if (repos.users.findByEmail(email)) return;
    const passwordHash = await hasher.hash(admin.password);
    uow.transaction(() => {
      if (repos.users.findByEmail(email)) return;
      repos.users.insert(
        { id: randomUUID(), email, displayName: admin.displayName.trim(), role: 'admin', createdAt: clock.now() },
        passwordHash,
      );
    });
  }

  function close(): void {
    if (db.isOpen) db.close();
  }

  return { config, clock, db, repos, uow, hasher, tokens, audit, auth, rooms, bookings, accounts, bootstrapAdmin, close };
}
