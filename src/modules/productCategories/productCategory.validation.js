import { z } from 'zod';

export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(100),
    code: z.string().trim().min(1).max(12),
  }),
});

export const deleteCategorySchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});
