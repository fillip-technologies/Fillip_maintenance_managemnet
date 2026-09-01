import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess } from '../../utils/response.js';
import { dashboardService } from './dashboard.service.js';

export const dashboardRouter = Router();

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
