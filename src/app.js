import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';

import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { apiRouter } from './routes/index.js';
import { healthRouter } from './routes/health.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

/**
 * Builds and configures the Express application. Kept free of any `listen`
 * call so it can be imported directly by tests.
 */
export function createApp() {
  const app = express();

  // Behind a load balancer / reverse proxy (needed for correct client IPs).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Security & performance middleware.
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    })
  );
  app.use(compression());

  // Body parsing with sane limits.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Request id + structured request logging.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const existing = req.headers['x-request-id'];
        const id = existing || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
    })
  );

  // Health checks are unauthenticated and rate-limit exempt.
  app.use('/health', healthRouter);

  // Rate limiting for the public API.
  app.use(
    '/api',
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.use('/api/v1', apiRouter);

  // 404 + centralized error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
