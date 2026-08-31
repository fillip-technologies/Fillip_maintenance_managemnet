import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { verticalService } from './vertical.service.js';

// --- /verticals (catalogue) ---
export const verticalRouter = Router();

verticalRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const items = await verticalService.listVerticals();
    sendSuccess(res, listPayload(items, { page: 1, limit: items.length, totalItems: items.length, totalPages: 1 }));
  })
);

verticalRouter.post(
  '/',
  requireRole('super_admin'),
  validate(z.object({ body: z.object({ key: z.string().trim().min(1).max(60), name: z.string().trim().min(1).max(120) }) })),
  asyncHandler(async (req, res) => {
    sendCreated(res, await verticalService.create(req.body));
  })
);

// --- /client-verticals (per-client toggle) ---
export const clientVerticalRouter = Router();

clientVerticalRouter.get(
  '/',
  validate(z.object({ query: z.object({ clientId: z.string().uuid() }) })),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await verticalService.listForClient(req.validatedQuery.clientId));
  })
);

clientVerticalRouter.patch(
  '/',
  requireRole('super_admin', 'company_admin'),
  validate(
    z.object({
      body: z.object({
        clientId: z.string().uuid(),
        verticalId: z.string().uuid(),
        active: z.boolean(),
      }),
    })
  ),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await verticalService.setActive(req.body));
  })
);
