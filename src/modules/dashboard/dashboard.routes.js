import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { dashboardService } from './dashboard.service.js';

export const dashboardRouter = Router();

// Platform-wide super_admin dashboard — one aggregated call for the whole
// overview page (tenancy, device fleet, work orders, alerts, technicians,
// facilities, recent activity). Guarded to super_admin.
dashboardRouter.get(
  '/overview',
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await dashboardService.overview(req.scope));
  })
);

const summarySchema = z.object({
  query: z.object({
    scope: z.enum(['zone', 'client', 'platform']),
    id: z.string().uuid().optional(),
    includeSubzones: z.enum(['true', 'false']).optional(),
  }),
});

dashboardRouter.get(
  '/summary',
  validate(summarySchema),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await dashboardService.summary(req.validatedQuery, req.scope));
  })
);

// Per-zone device health for a scope (real data behind the overview's zone
// distribution). Same scope contract as /summary.
dashboardRouter.get(
  '/zone-breakdown',
  validate(summarySchema),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await dashboardService.zoneBreakdown(req.validatedQuery, req.scope));
  })
);
