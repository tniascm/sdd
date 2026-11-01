/** `/me` — the signed-in user. Export and erasure (FR-018, FR-019) are added with US5. */
import { Router } from 'express';
import type { Container } from '../../container.ts';
import { actorOf, requireAuth } from '../auth-middleware.ts';
import { userDto } from '../presenters.ts';

export function meRoutes(c: Container): Router {
  const r = Router();
  r.use('/me', requireAuth(c.auth));

  r.get('/me', (req, res) => {
    res.json(userDto(c.auth.currentUser(actorOf(req))));
  });

  return r;
}
