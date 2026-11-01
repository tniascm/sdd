/** `/bookings` — FR-009 … FR-015. */
import { Router } from 'express';
import type { Container } from '../../container.ts';
import { actorOf, requireAuth } from '../auth-middleware.ts';
import { bookingDto } from '../presenters.ts';
import { BookingCreateRequest, BookingsMineQuery } from '../schemas.ts';

export function bookingRoutes(c: Container): Router {
  const r = Router();
  r.use('/bookings', requireAuth(c.auth));

  r.post('/bookings', (req, res) => {
    const input = BookingCreateRequest.parse(req.body);
    const booking = c.bookings.create(actorOf(req), {
      ...input,
      start: Date.parse(input.start),
      end: Date.parse(input.end),
    });
    res.status(201).json(bookingDto(booking));
  });

  r.get('/bookings/mine', (req, res) => {
    const { include } = BookingsMineQuery.parse(req.query);
    res.json({ bookings: c.bookings.listMine(actorOf(req), include).map(bookingDto) });
  });

  return r;
}
