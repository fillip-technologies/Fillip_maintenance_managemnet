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
import { procurementRouter } from './routes/procurement.js';
import { transfersRouter } from './routes/transfers.js';
import { installationsRouter } from './routes/installations.js';
import { serviceRouter } from './routes/service.js';
import { reportsRouter } from './routes/reports.js';

/**
 * /api/inventory/v1: the FBOS-conformant inventory service (integration plan §7).
 * Mounted beside the legacy /api/v1 and sharing no middleware with it: callers
 * are FBOS users resolved through Identity, every route is guarded by an
 * `inventory.*` permission (scripts/inventory_routes.test.mjs fails otherwise),
 * errors and pages use FBOS shapes.
 */
// /me shows only the caller's own permissions (signed in, no permission needed).
export const OPEN_PATHS = ['/health', '/ready', '/me'];

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
  router.get('/me', (req, res) => {
    const a = req.actor;
    res.json({
      platform: a.platform ?? 'fbos',
      user_id: a.userId ?? null,
      legacy_user_id: a.legacyUserId ?? null,
      name: a.name,
      role: a.role ?? a.userType,
      technician_id: a.technicianId ?? null,
      permissions: a.isSuperuser && a.platform !== 'fixly' ? ['*'] : [...a.permissions].sort(),
      own_records_only: [...(a.ownRecordsOnly ?? [])].sort(),
    });
  });
  router.use(organizationRouter);
  router.use(catalogRouter);
  router.use(stockRouter);
  router.use(devicesRouter);
  router.use(procurementRouter);
  router.use(transfersRouter);
  router.use(installationsRouter);
  router.use(serviceRouter);
  router.use(reportsRouter);

  router.use((req, _res, next) => next(new InventoryError(404, 'NOT_FOUND', `No route ${req.method} ${req.path}`)));
  router.use(inventoryErrorHandler);
  return router;
}
