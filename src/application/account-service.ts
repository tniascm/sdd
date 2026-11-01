/** Accounts: FR-017 role changes and user search (administrators). Export and erasure come with US5. */
import { DomainError } from '../domain/errors.ts';
import type { Actor, Role, User } from '../domain/types.ts';
import type { AuditService } from './audit-service.ts';
import type { UnitOfWork, UserRepository } from './ports.ts';

export type AccountServiceDeps = {
  users: UserRepository;
  uow: UnitOfWork;
  audit: AuditService;
};

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

  /** Users whose email contains the fragment (case-insensitive), at most 100. */
  findUsers(emailFragment: string | undefined): User[] {
    return this.deps.users.searchByEmail(emailFragment ?? '', USER_SEARCH_LIMIT);
  }
}

export function lastAdmin(): DomainError {
  return new DomainError('LAST_ADMIN', 'RoomBook must always have at least one administrator.');
}
