/** Accounts: FR-017 role changes and user search; FR-018 export; FR-019 erasure. */
import { DomainError } from '../domain/errors.ts';
import type { Actor, Role, User } from '../domain/types.ts';
import type { AuditService } from './audit-service.ts';
import type { PasswordAttempts } from './password-attempts.ts';
import type {
  BookingRepository,
  BookingView,
  Clock,
  PasswordHasher,
  StorageFlusher,
  UnitOfWork,
  UserRepository,
} from './ports.ts';

export type AccountServiceDeps = {
  users: UserRepository;
  bookings: BookingRepository;
  attempts: PasswordAttempts;
  hasher: PasswordHasher;
  clock: Clock;
  uow: UnitOfWork;
  audit: AuditService;
  storage: StorageFlusher;
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
   * FR-019 after re-entering the password. Wrong passwords count towards the FR-004 lock (R-7).
   * Then, in one transaction: all free text on the user's bookings (purpose, cancellation
   * reason) is erased (R-10), upcoming bookings are cancelled ("Account deleted"), the user is
   * deleted (sessions cascade, bookings keep userId = null) and their login failures are removed.
   * Finally the storage is flushed so no copy survives in the database files (R-2).
   */
  async erase(actor: Actor, password: string): Promise<void> {
    const { users, bookings, attempts, hasher, clock, uow, audit, storage } = this.deps;
    const account = users.findById(actor.userId);
    const stored = account && users.findPasswordHash(account.id);
    if (!account || !stored) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue.');

    attempts.begin(account.email, { type: 'user', id: account.id }); // throws TOO_MANY_ATTEMPTS while locked
    if (!(await hasher.verify(password, stored))) {
      const message = 'The password is not correct.';
      throw new DomainError('PASSWORD_INCORRECT', message, [{ field: 'password', message }]);
    }
    attempts.clear(account.email);

    uow.transaction(() => {
      const user = users.findById(actor.userId);
      if (!user) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue.');
      if (user.role === 'admin' && users.countByRole('admin') <= 1) throw lastAdmin();
      const now = clock.now();
      bookings.erasePersonalTextForUser(user.id);
      bookings.cancelUpcomingForUser(user.id, now, { at: now, by: 'system', reason: ACCOUNT_DELETED_REASON });
      attempts.clear(user.email);
      users.delete(user.id);
      audit.record('user.erased', user.id, { type: 'user', id: user.id });
    });
    storage.flush();
  }

  /** Users whose email contains the fragment (case-insensitive), at most 100. */
  findUsers(emailFragment: string | undefined): User[] {
    return this.deps.users.searchByEmail(emailFragment ?? '', USER_SEARCH_LIMIT);
  }
}

export function lastAdmin(): DomainError {
  return new DomainError('LAST_ADMIN', 'RoomBook must always have at least one administrator.');
}
