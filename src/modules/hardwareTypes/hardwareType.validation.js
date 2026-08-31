import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

const idParam = z.object({ id: z.string().uuid() });

export const listHardwareTypesSchema = z.object({
  query: paginationQuery.extend({ search: z.string().trim().min(1).optional() }),
});

export const getHardwareTypeSchema = z.object({ params: idParam });

export const createHardwareTypeSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(80),
    specFields: z.record(z.any()).default({}),
  }),
});

export const updateHardwareTypeSchema = z.object({
  params: idParam,
  body: z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      specFields: z.record(z.any()).optional(),
    })
    .refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' }),
});

export const deleteHardwareTypeSchema = z.object({ params: idParam });

export const createCategorySchema = z.object({
  params: idParam,
  body: z.object({ name: z.string().trim().min(1).max(100) }),
});

export const deleteCategorySchema = z.object({
  params: z.object({ id: z.string().uuid(), categoryId: z.string().uuid() }),
});
