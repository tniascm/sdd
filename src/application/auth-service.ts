/**
 * Accounts and sessions: FR-001 register, FR-002 sign in, FR-003 sign out, FR-004 lockout.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { DomainError } from '../domain/errors.ts';
import { LOCKOUT, lockedUntil } from '../domain/lockout.ts';
import type { Actor, User } from '../domain/types.ts';
import type { AuditService } from './audit-service.ts';
import type {
  Clock,
  LoginFailureRepository,
  PasswordHasher,
  SessionRepository,
  TokenService,
  UnitOfWork,
  UserRepository,
} from './ports.ts';

export type AuthServiceDeps = {
  users: UserRepository;
  sessions: SessionRepository;
  loginFailures: LoginFailureRepository;
  tokens: TokenService;
  hasher: PasswordHasher;
  clock: Clock;
  uow: UnitOfWork;
  audit: AuditService;
  config: { allowedEmailDomains: string[]; sessionTtlMs: number };
};

export type RegisterInput = { email: string; displayName: string; password: string };
export type SignedInSession = { token: string; expiresAt: number; user: User };

/** FR-004: unknown email and wrong password get exactly this error. */
const invalidCredentials = () => new DomainError('INVALID_CREDENTIALS', 'Invalid email or password.');

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class AuthService {
  private readonly deps: AuthServiceDeps;
  /** Hash verified for unknown emails so both failure paths cost the same time (FR-004). */
  private dummyHash: Promise<string> | undefined;

  constructor(deps: AuthServiceDeps) {
    this.deps = deps;
  }

  /** SHA-256 of the normalised email: the key for login failures (research R8). */
  emailHash(email: string): string {
    return this.deps.tokens.hash(normaliseEmail(email));
  }

  /** FR-001. New accounts are students; the email is stored lower-cased. */
  async register(input: RegisterInput): Promise<User> {
    const { users, hasher, clock, uow, audit, config } = this.deps;
    const email = normaliseEmail(input.email);
    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (!config.allowedEmailDomains.includes(domain)) {
      const message = `Registration is limited to university addresses (${config.allowedEmailDomains.join(', ')}).`;
      throw new DomainError('EMAIL_DOMAIN_NOT_ALLOWED', message, [{ field: 'email', message }]);
    }
    if (input.password.toLowerCase() === email) {
      const message = 'The password must not be your email address.';
      throw new DomainError('PASSWORD_EQUALS_EMAIL', message, [{ field: 'password', message }]);
    }
    if (users.findByEmail(email)) throw emailTaken();

    const passwordHash = await hasher.hash(input.password);
    const user: User = { id: randomUUID(), email, displayName: input.displayName, role: 'student', createdAt: clock.now() };
    uow.transaction(() => {
      users.insert(user, passwordHash); // the unique index still guards a concurrent duplicate
      audit.record('user.registered', user.id, { type: 'user', id: user.id });
    });
    return user;
  }

  /** FR-002, FR-004. */
  async login(emailInput: string, password: string): Promise<SignedInSession> {
    const { users, sessions, loginFailures, tokens, hasher, clock, uow, audit, config } = this.deps;
    const email = normaliseEmail(emailInput);
    const emailHash = tokens.hash(email);
    const credentials = users.findCredentialsByEmail(email);
    const target = credentials ? { type: 'user', id: credentials.user.id } : null;

    // Refused because of the lock: not checked, not recorded as a failure, audit-logged (data-model.md).
    const now = clock.now();
    const last = loginFailures.lastAt(emailHash);
    const failures = last === null ? 0 : loginFailures.countSince(emailHash, last - LOCKOUT.windowMs);
    const until = lockedUntil(last, failures, now);
    if (until !== null) {
      audit.record('auth.locked', null, target, { emailHash });
      const retryAfterSeconds = Math.max(1, Math.ceil((until - now) / 1000));
      throw new DomainError(
        'TOO_MANY_ATTEMPTS',
        `Too many failed sign-in attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
        undefined,
        { retryAfterSeconds },
      );
    }

    const ok = await hasher.verify(password, credentials?.passwordHash ?? (await this.dummy()));
    if (!credentials || !ok) {
      uow.transaction(() => {
        loginFailures.record(emailHash, clock.now());
        audit.record('auth.login.failed', null, target, { emailHash });
      });
      throw invalidCredentials();
    }

    const token = tokens.generate();
    const createdAt = clock.now();
    const expiresAt = createdAt + config.sessionTtlMs;
    const user = credentials.user;
    uow.transaction(() => {
      loginFailures.clear(emailHash);
      sessions.insert({ tokenHash: tokens.hash(token), userId: user.id, createdAt, expiresAt, revokedAt: null });
      audit.record('auth.login.succeeded', user.id, { type: 'user', id: user.id });
    });
    return { token, expiresAt, user };
  }

  /** FR-003: the session behind `token` is revoked. */
  logout(actor: Actor, token: string): void {
    const { sessions, tokens, clock, uow, audit } = this.deps;
    uow.transaction(() => {
      sessions.revoke(tokens.hash(token), clock.now());
      audit.record('auth.logout', actor.userId, { type: 'user', id: actor.userId });
    });
  }

  /**
   * The caller behind a bearer token, or null. A session is valid ⇔ not revoked, not expired
   * and its user still exists (data-model.md "Session"). The role is read fresh from the user,
   * so role changes apply to the next request.
   */
  authenticate(token: string): Actor | null {
    const { sessions, users, tokens, clock } = this.deps;
    const session = sessions.findByTokenHash(tokens.hash(token));
    if (!session || session.revokedAt !== null || clock.now() >= session.expiresAt) return null;
    const user = users.findById(session.userId);
    return user ? { userId: user.id, role: user.role } : null;
  }

  currentUser(actor: Actor): User {
    const user = this.deps.users.findById(actor.userId);
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue.');
    return user;
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= this.deps.hasher.hash(randomBytes(18).toString('base64'));
    return this.dummyHash;
  }
}

function emailTaken(): DomainError {
  const message = 'An account with this email address already exists.';
  return new DomainError('EMAIL_TAKEN', message, [{ field: 'email', message }]);
}
