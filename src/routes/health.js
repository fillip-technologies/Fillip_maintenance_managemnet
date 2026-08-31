import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const healthRouter = Router();

/** Liveness — is the process up? Cheap, no dependencies. */
healthRouter.get('/live', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/** Readiness — can we actually serve traffic (DB reachable)? */
healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  })
);
