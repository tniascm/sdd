/** `/rooms` — FR-005, FR-006 for signed-in users; FR-007, FR-008 for administrators. */
import { Router } from 'express';
import type { Container } from '../../container.ts';
import { actorOf, requireAdmin, requireAuth } from '../auth-middleware.ts';
import { intervalDto, roomDto } from '../presenters.ts';
import { DateQuery, RoomCreateRequest, RoomIdParams, RoomListQuery, RoomUpdateRequest } from '../schemas.ts';

export function roomRoutes(c: Container): Router {
  const r = Router();
  r.use('/rooms', requireAuth(c.auth));

  r.get('/rooms', (req, res) => {
    const filter = RoomListQuery.parse(req.query);
    res.json({ rooms: c.rooms.list(filter).map(roomDto) });
  });

  r.post('/rooms', requireAdmin, (req, res) => {
    const input = RoomCreateRequest.parse(req.body);
    res.status(201).json(roomDto(c.rooms.create(actorOf(req).userId, input)));
  });

  r.patch('/rooms/:roomId', requireAdmin, (req, res) => {
    const { roomId } = RoomIdParams.parse(req.params);
    const patch = RoomUpdateRequest.parse(req.body);
    res.json(roomDto(c.rooms.update(actorOf(req).userId, roomId, patch)));
  });

  r.post('/rooms/:roomId/out-of-service', requireAdmin, (req, res) => {
    const { roomId } = RoomIdParams.parse(req.params);
    const { room, cancelledBookings } = c.rooms.takeOutOfService(actorOf(req).userId, roomId);
    res.json({ room: roomDto(room), cancelledBookings });
  });

  r.post('/rooms/:roomId/in-service', requireAdmin, (req, res) => {
    const { roomId } = RoomIdParams.parse(req.params);
    res.json({ room: roomDto(c.rooms.putInService(actorOf(req).userId, roomId)) });
  });

  r.get('/rooms/:roomId/availability', (req, res) => {
    const { roomId } = RoomIdParams.parse(req.params);
    const { date } = DateQuery.parse(req.query);
    const a = c.rooms.availability(roomId, date);
    res.json({ ...a, booked: a.booked.map(intervalDto), free: a.free.map(intervalDto) });
  });

  return r;
}
