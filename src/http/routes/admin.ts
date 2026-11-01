/** `/admin/...` — administrator-only operations (NFR-003: every route checks the admin role). */
import { Router } from 'express';
import type { Container } from '../../container.ts';
import { requireAdmin, requireAuth } from '../auth-middleware.ts';
import { auditEventDto } from '../presenters.ts';
import { AuditEventsQuery } from '../schemas.ts';

export function adminRoutes(c: Container): Router {
  const r = Router();
  r.use('/admin', requireAuth(c.auth), requireAdmin);

  /** FR-020: audit events, newest first. */
  r.get('/admin/audit-events', (req, res) => {
    const { limit, beforeId } = AuditEventsQuery.parse(req.query);
    res.json({ events: c.audit.list({ limit, beforeId }).map(auditEventDto) });
  });

  return r;
}
