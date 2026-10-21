import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { authenticateActor } from './auth/middleware.js';
import { inventoryErrorHandler, InventoryError } from './http/errors.js';
import { devicesRouter } from './routes/devices.js';
import { organizationRouter } from './routes/organization.js';
import { stockRouter } from './routes/stock.js';
import { catalogRouter } from './routes/catalog.js';
import { internalRouter } from './routes/internal.js';

/**
 * /api/inventory/v1: the FBOS-conformant inventory service (integration plan §7).
 * Mounted beside the legacy /api/v1 and sharing no middleware with it: callers
 * are FBOS users resolved through Identity, every route is guarded by an
 * `inventory.*` permission (scripts/inventory_routes.test.mjs fails otherwise),
 * errors and pages use FBOS shapes.
 */
export const OPEN_PATHS = ['/health', '/ready'];

export function inventoryRouter() {
  const router = Router();

  router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'inventory' }));
  router.get('/ready', async (_req, res) => {
    const checks = {};
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'unavailable';
    }
    try {
      const r = await fetch(new URL('/health', env.FBOS_IDENTITY_URL), { signal: AbortSignal.timeout(2000) });
      checks.identity = r.ok ? 'ok' : 'unavailable';
    } catch {
      checks.identity = 'unavailable';
    }
    const ready = Object.values(checks).every((v) => v === 'ok');
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
  });

  router.use(internalRouter);

  router.use(authenticateActor);
  router.use(organizationRouter);
  router.use(catalogRouter);
  router.use(stockRouter);
  router.use(devicesRouter);

  router.use((req, _res, next) => next(new InventoryError(404, 'NOT_FOUND', `No route ${req.method} ${req.path}`)));
  router.use(inventoryErrorHandler);
  return router;
}
