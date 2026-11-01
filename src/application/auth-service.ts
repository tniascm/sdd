/**
 * Authentication (FR-001 … FR-004). This phase provides session validation for the HTTP
 * middleware; registration, sign-in and sign-out are added with User Story 2 (T023).
 */
import type { Actor } from '../domain/types.ts';
import type { Clock, SessionRepository, TokenService, UserRepository } from './ports.ts';

export type AuthServiceDeps = {
  users: UserRepository;
  sessions: SessionRepository;
  tokens: TokenService;
  clock: Clock;
};

export class AuthService {
  private readonly deps: AuthServiceDeps;

  constructor(deps: AuthServiceDeps) {
    this.deps = deps;
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
}
