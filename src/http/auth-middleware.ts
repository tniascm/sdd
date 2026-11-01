/**
 * `Authorization: Bearer <token>` → `req.actor` (research R5). Missing or invalid sessions get
 * 401 UNAUTHENTICATED; `requireAdmin` refuses non-administrators with 403 FORBIDDEN (NFR-003).
 */
import type { Request, RequestHandler } from 'express';
import { DomainError } from '../domain/errors.ts';
import type { Actor } from '../domain/types.ts';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `requireAuth` for authenticated requests. */
    actor?: Actor;
  }
}

export interface Authenticator {
  authenticate(token: string): Actor | null;
}

const BEARER = /^Bearer[ ]+([A-Za-z0-9\-._~+/]+=*)[ ]*$/i;

/** The bearer token of the request, or null when the header is missing or malformed. */
export function bearerToken(req: Request): string | null {
  const header = req.get('authorization');
  if (header === undefined || header.length > 1024) return null;
  return BEARER.exec(header)?.[1] ?? null;
}

const unauthenticated = () => new DomainError('UNAUTHENTICATED', 'Sign in to continue.');

export function requireAuth(auth: Authenticator): RequestHandler {
  return (req, _res, next) => {
    const token = bearerToken(req);
    const actor = token === null ? null : auth.authenticate(token);
    if (!actor) return next(unauthenticated());
    req.actor = actor;
    next();
  };
}

/** Use after `requireAuth`. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.actor) return next(unauthenticated());
  if (req.actor.role !== 'admin') return next(new DomainError('FORBIDDEN', 'Administrator role required.'));
  next();
};

/** The authenticated actor of a request handled behind `requireAuth`. */
export function actorOf(req: Request): Actor {
  if (!req.actor) throw unauthenticated();
  return req.actor;
}
