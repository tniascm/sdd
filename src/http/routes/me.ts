/** `/me` — the signed-in user, data export (FR-018) and account erasure (FR-019). */
import { Router } from 'express';
import type { Container } from '../../container.ts';
import { actorOf, requireAuth } from '../auth-middleware.ts';
import { bookingDto, iso, userDto } from '../presenters.ts';
import { EraseRequest } from '../schemas.ts';

export function meRoutes(c: Container): Router {
  const r = Router();
  r.use('/me', requireAuth(c.auth));

  r.get('/me', (req, res) => {
    res.json(userDto(c.auth.currentUser(actorOf(req))));
  });

  r.get('/me/export', (req, res) => {
    const data = c.accounts.export(actorOf(req));
    res.set('Content-Disposition', 'attachment; filename="roombook-export.json"');
    res.json({ exportedAt: iso(data.exportedAt), user: userDto(data.user), bookings: data.bookings.map(bookingDto) });
  });

  r.post('/me/erase', async (req, res) => {
    const { password } = EraseRequest.parse(req.body);
    await c.accounts.erase(actorOf(req), password);
    res.status(204).end();
  });

  return r;
}
