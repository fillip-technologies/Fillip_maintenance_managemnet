import { z } from 'zod';

const idParam = z.object({ id: z.string().uuid() });

export const listProductTypesSchema = z.object({
  query: z.object({
    categoryId: z.string().uuid().optional(),
  }),
});

export const createProductTypeSchema = z.object({
  body: z.object({
    categoryId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
  }),
});

export const uploadProductTypeLogoSchema = z.object({
  params: idParam,
});

export const deleteProductTypeSchema = z.object({
  params: idParam,
});
