import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/authenticate.js';
import { attachScope } from '../middleware/attachScope.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { userRouter } from '../modules/users/user.routes.js';
import { companyRouter } from '../modules/companies/company.routes.js';
import { clientRouter } from '../modules/clients/client.routes.js';
import { zoneRouter } from '../modules/zones/zone.routes.js';
import { hardwareTypeRouter } from '../modules/hardwareTypes/hardwareType.routes.js';
import { issueCategoryRouter } from '../modules/issueCategories/issueCategory.routes.js';
import { deviceRouter } from '../modules/devices/device.routes.js';
import { issueRouter } from '../modules/issues/issue.routes.js';
import { dailyLogRouter } from '../modules/dailyLogs/dailyLog.routes.js';
import { technicianRouter } from '../modules/technicians/technician.routes.js';
import { verticalRouter, clientVerticalRouter } from '../modules/verticals/vertical.routes.js';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes.js';
import { productRouter } from '../modules/products/product.routes.js';

/**
 * Versioned API surface. `/auth` is public (login/refresh); everything below
 * `authenticate` requires a valid access token. The version prefix (/api/v1)
 * lets web and mobile clients evolve independently.
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) => {
  res.json({ success: true, data: { message: 'Maintenance Management API v1' } });
});

apiRouter.use('/auth', authRouter);

// --- Everything past here requires authentication + a resolved scope ---
apiRouter.use(authenticate);
apiRouter.use(attachScope);

apiRouter.use('/companies', requireRole('super_admin'), companyRouter);
apiRouter.use('/clients', requireRole('super_admin'), clientRouter);
apiRouter.use('/verticals', verticalRouter);
apiRouter.use('/client-verticals', clientVerticalRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/zones', zoneRouter);
apiRouter.use('/hardware-types', hardwareTypeRouter);
apiRouter.use('/issue-categories', issueCategoryRouter);
apiRouter.use('/devices', deviceRouter);
apiRouter.use('/issues', issueRouter);
apiRouter.use('/daily-logs', dailyLogRouter);
apiRouter.use('/technicians', technicianRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/products', productRouter);
