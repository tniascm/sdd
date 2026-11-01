/** Accounts: FR-017 role changes and user search; FR-018 export; FR-019 erasure. */
import { DomainError } from '../domain/errors.ts';
import type { Actor, Role, User } from '../domain/types.ts';
import type { AuditService } from './audit-service.ts';
import { normaliseEmail } from './auth-service.ts';
import type {
  BookingRepository,
  BookingView,
  Clock,
  LoginFailureRepository,
  PasswordHasher,
  TokenService,
  UnitOfWork,
  UserRepository,
} from './ports.ts';

export type AccountServiceDeps = {
  users: UserRepository;
  bookings: BookingRepository;
  loginFailures: LoginFailureRepository;
  hasher: PasswordHasher;
  tokens: TokenService;
  clock: Clock;
  uow: UnitOfWork;
  audit: AuditService;
};

export type DataExport = { exportedAt: number; user: User; bookings: BookingView[] };

export const ACCOUNT_DELETED_REASON = 'Account deleted';

export const USER_SEARCH_LIMIT = 100;

export class AccountService {
  private readonly deps: AccountServiceDeps;

  constructor(deps: AccountServiceDeps) {
    this.deps = deps;
  }

  /** FR-017: refuses any change that would leave the system without an administrator. */
  changeRole(actor: Actor, userId: string, role: Role): User {
    const { users, uow, audit } = this.deps;
    return uow.transaction(() => {
      const user = users.findById(userId);
      if (!user) throw new DomainError('NOT_FOUND', 'User not found.');
      if (user.role === role) return user;
      if (user.role === 'admin' && users.countByRole('admin') <= 1) throw lastAdmin();
      users.updateRole(user.id, role);
      audit.record('user.role_changed', actor.userId, { type: 'user', id: user.id }, { from: user.role, to: role });
      return { ...user, role };
    });
  }

  /** FR-018: everything held about the caller — profile and all bookings — and nothing else. */
  export(actor: Actor): DataExport {
    const { users, bookings, clock } = this.deps;
    const user = users.findById(actor.userId);
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue.');
    const now = clock.now();
    return { exportedAt: now, user, bookings: bookings.listByUser(user.id, { upcomingOnly: false, now }) };
  }

  /**
   * FR-019 after re-entering the password, in one transaction: upcoming bookings are cancelled
   * ("Account deleted"), purposes of all the user's bookings are cleared, the user is deleted
   * (sessions cascade, bookings keep userId = null) and their login-failure rows are removed.
   */
  async erase(actor: Actor, password: string): Promise<void> {
    const { users, bookings, loginFailures, hasher, tokens, clock, uow, audit } = this.deps;
    const stored = users.findPasswordHash(actor.userId);
    if (!stored) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue.');
    if (!(await hasher.verify(password, stored))) {
      const message = 'The password is not correct.';
      throw new DomainError('PASSWORD_INCORRECT', message, [{ field: 'password', message }]);
    }
    uow.transaction(() => {
      const user = users.findById(actor.userId);
      if (!user) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue.');
      if (user.role === 'admin' && users.countByRole('admin') <= 1) throw lastAdmin();
      const now = clock.now();
      bookings.cancelUpcomingForUser(user.id, now, { at: now, by: 'system', reason: ACCOUNT_DELETED_REASON });
      bookings.clearPurposeForUser(user.id);
      loginFailures.clear(tokens.hash(normaliseEmail(user.email)));
      users.delete(user.id);
      audit.record('user.erased', user.id, { type: 'user', id: user.id });
    });
  }

  /** Users whose email contains the fragment (case-insensitive), at most 100. */
  findUsers(emailFragment: string | undefined): User[] {
    return this.deps.users.searchByEmail(emailFragment ?? '', USER_SEARCH_LIMIT);
  }
}

export function lastAdmin(): DomainError {
  return new DomainError('LAST_ADMIN', 'RoomBook must always have at least one administrator.');
}
