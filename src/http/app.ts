/**
 * The Express application: security headers (NFR-005, research R9), per-client rate limit
 * (NFR-010), 10 kB JSON bodies (NFR-004), the `/api/v1` API, the static UI and error mapping.
 */
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import type { Container } from '../container.ts';
import { apiNotFound, createErrorHandler } from './error-handler.ts';
import { createRateLimit } from './rate-limit.ts';

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
        },
      },
      frameguard: { action: 'deny' },
    }),
  );
  app.use(createRateLimit({ clock: container.clock, limitPerMinute: container.config.rateLimitPerMinute }));
  app.use(express.json({ limit: '10kb' }));

  app.use('/api/v1', apiRouter());
  app.use('/api', apiNotFound);

  app.use(express.static(PUBLIC_DIR));
  app.use(createErrorHandler());
  return app;
}

function apiRouter(): express.Router {
  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  return api;
}
