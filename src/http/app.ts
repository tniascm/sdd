/**
 * The Express application: security headers (NFR-005, research R9; base-uri and form-action
 * restricted after review R-12), no-store caching for the API (R-5), per-client rate limit
 * (NFR-010), 10 kB JSON bodies (NFR-004), the `/api/v1` API, the static UI and error mapping.
 */
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import type { Container } from '../container.ts';
import { apiNotFound, createErrorHandler } from './error-handler.ts';
import { createRateLimit } from './rate-limit.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { bookingRoutes } from './routes/bookings.ts';
import { meRoutes } from './routes/me.ts';
import { roomRoutes } from './routes/rooms.ts';

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));

export function createApp(container: Container): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
        },
      },
      frameguard: { action: 'deny' },
    }),
  );
  // NFR-002 (R-5): API responses (session tokens, personal data) must not be cached.
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(createRateLimit({ clock: container.clock, limitPerMinute: container.config.rateLimitPerMinute }));
  app.use(express.json({ limit: '10kb' }));

  app.use('/api/v1', apiRouter(container));
  app.use('/api', apiNotFound);

  app.use(express.static(PUBLIC_DIR));
  app.use(createErrorHandler());
  return app;
}

function apiRouter(c: Container): express.Router {
  const api = express.Router();
  // The UI reads the campus time zone from here before showing any time (R-11).
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', timeZone: c.config.timeZone });
  });
  api.use(authRoutes(c));
  api.use(meRoutes(c));
  api.use(roomRoutes(c));
  api.use(bookingRoutes(c));
  api.use(adminRoutes(c));
  return api;
}
