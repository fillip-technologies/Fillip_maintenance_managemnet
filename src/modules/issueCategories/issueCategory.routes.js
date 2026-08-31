import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, listPayload } from '../../utils/response.js';

export const issueCategoryRouter = Router();

const listSchema = z.object({
  query: z.object({ hardwareTypeId: z.string().uuid().optional() }),
});

// Flat category lookup, primarily filtered by hardware type for the
// "raise issue" category dropdown.
issueCategoryRouter.get(
  '/',
  validate(listSchema),
  asyncHandler(async (req, res) => {
    const { hardwareTypeId } = req.validatedQuery;
    const items = await prisma.issueCategory.findMany({
      where: hardwareTypeId ? { hardwareTypeId } : {},
      orderBy: { name: 'asc' },
    });
    sendSuccess(res, listPayload(items, { page: 1, limit: items.length, totalItems: items.length, totalPages: 1 }));
  })
);
