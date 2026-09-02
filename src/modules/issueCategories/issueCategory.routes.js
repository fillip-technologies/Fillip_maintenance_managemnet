import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { validate } from '../../middleware/validate.js';
import { requireRole } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCreated, listPayload } from '../../utils/response.js';
import { ApiError } from '../../utils/ApiError.js';

export const issueCategoryRouter = Router();

const listSchema = z.object({
  query: z.object({
    categoryId: z.string().uuid().optional(),
    // Convenience: resolve categories valid for a specific unit (device).
    deviceId: z.string().uuid().optional(),
  }),
});

// Defect categories for the "raise a defect" dropdown. Returns GLOBAL categories
// (categoryId null) plus, when a categoryId/deviceId is given, that product
// category's specific ones.
issueCategoryRouter.get(
  '/',
  validate(listSchema),
  asyncHandler(async (req, res) => {
    let { categoryId, deviceId } = req.validatedQuery;
    if (!categoryId && deviceId) {
      const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { categoryId: true } });
      categoryId = device?.categoryId ?? undefined;
    }
    const where = categoryId ? { OR: [{ categoryId: null }, { categoryId }] } : {};
    const items = await prisma.issueCategory.findMany({ where, orderBy: { name: 'asc' } });
    sendSuccess(res, listPayload(items, { page: 1, limit: items.length, totalItems: items.length, totalPages: 1 }));
  })
);

const createSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(100),
    // Omit for a GLOBAL category (applies to any unit); set to scope it to one
    // product category.
    categoryId: z.string().uuid().nullish(),
  }),
});

// Only the CEO curates the defect-category list (global, shared).
issueCategoryRouter.post(
  '/',
  requireRole('super_admin'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { name, categoryId } = req.body;
    if (categoryId) {
      const cat = await prisma.productCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
      if (!cat) throw ApiError.badRequest('Product category does not exist');
    }
    const created = await prisma.issueCategory.create({ data: { name: name.trim(), categoryId: categoryId ?? null } });
    sendCreated(res, created);
  })
);
