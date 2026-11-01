/** `/auth/register`, `/auth/login`, `/auth/logout` (FR-001 … FR-004). */
import { Router } from 'express';
import type { Container } from '../../container.ts';
import { actorOf, bearerToken, requireAuth } from '../auth-middleware.ts';
import { sessionDto, userDto } from '../presenters.ts';
import { LoginRequest, RegisterRequest } from '../schemas.ts';

export function authRoutes(c: Container): Router {
  const r = Router();

  r.post('/auth/register', async (req, res) => {
    const input = RegisterRequest.parse(req.body);
    const user = await c.auth.register(input);
    res.status(201).json(userDto(user));
  });

  r.post('/auth/login', async (req, res) => {
    const { email, password } = LoginRequest.parse(req.body);
    res.json(sessionDto(await c.auth.login(email, password)));
  });

  r.post('/auth/logout', requireAuth(c.auth), (req, res) => {
    c.auth.logout(actorOf(req), bearerToken(req) ?? '');
    res.status(204).end();
  });

  return r;
}
