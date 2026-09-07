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

const zoneBreakdownSchema = z.object({
  query: z.object({
    scope: z.enum(['zone', 'client', 'platform']),
    id: z.string().uuid().optional(),
    includeSubzones: z.enum(['true', 'false']).optional(),
    categoryId: z.string().uuid().optional(),
  }),
});

dashboardRouter.get(
  '/summary',
  validate(summarySchema),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await dashboardService.summary(req.validatedQuery, req.scope));
  })
);

// Per-zone device health for a scope. Accepts optional categoryId to narrow
// the breakdown to devices of one product category (used by the product-first
// zone section in the client-admin app).
dashboardRouter.get(
  '/zone-breakdown',
  validate(zoneBreakdownSchema),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await dashboardService.zoneBreakdown(req.validatedQuery, req.scope));
  })
);

// Per-product-category device health for a scope — backing the client-admin
// "products first" zone section.
dashboardRouter.get(
  '/product-breakdown',
  validate(summarySchema),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await dashboardService.productBreakdown(req.validatedQuery, req.scope));
  })
);
