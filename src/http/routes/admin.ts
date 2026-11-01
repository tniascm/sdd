/** `/admin/...` — administrator-only operations (NFR-003: every route checks the admin role). */
import { Router } from 'express';
import type { Container } from '../../container.ts';
import { actorOf, requireAdmin, requireAuth } from '../auth-middleware.ts';
import { adminBookingDto, auditEventDto, roomDto, userDto } from '../presenters.ts';
import { AdminUsersQuery, AuditEventsQuery, DateQuery, RoleChangeRequest, UserIdParams } from '../schemas.ts';

export function adminRoutes(c: Container): Router {
  const r = Router();
  r.use('/admin', requireAuth(c.auth), requireAdmin);

  /** All rooms, including those out of service (FR-008). */
  r.get('/admin/rooms', (_req, res) => {
    res.json({ rooms: c.rooms.listAll().map(roomDto) });
  });

  /** FR-015: every booking of a campus-local date with its booker. */
  r.get('/admin/bookings', (req, res) => {
    const { date } = DateQuery.parse(req.query);
    const day = c.bookings.listForDate(date);
    res.json({ date: day.date, timeZone: day.timeZone, bookings: day.bookings.map(adminBookingDto) });
  });

  r.get('/admin/users', (req, res) => {
    const { email } = AdminUsersQuery.parse(req.query);
    res.json({ users: c.accounts.findUsers(email).map(userDto) });
  });

  /** FR-017. */
  r.put('/admin/users/:userId/role', (req, res) => {
    const { userId } = UserIdParams.parse(req.params);
    const { role } = RoleChangeRequest.parse(req.body);
    res.json(userDto(c.accounts.changeRole(actorOf(req), userId, role)));
  });

  /** FR-020: audit events, newest first. */
  r.get('/admin/audit-events', (req, res) => {
    const { limit, beforeId } = AuditEventsQuery.parse(req.query);
    res.json({ events: c.audit.list({ limit, beforeId }).map(auditEventDto) });
  });

  return r;
}
