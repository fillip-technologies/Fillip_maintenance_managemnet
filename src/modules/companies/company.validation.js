import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

const idParam = z.object({ id: z.string().uuid() });

export const listCompaniesSchema = z.object({
  query: paginationQuery.extend({ search: z.string().trim().min(1).optional() }),
});

export const getCompanySchema = z.object({ params: idParam });

export const createCompanySchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(160),
    status: z.enum(['active', 'inactive']).optional(),
  }),
});

export const updateCompanySchema = z.object({
  params: idParam,
  body: z
    .object({
      name: z.string().trim().min(1).max(160).optional(),
      status: z.enum(['active', 'inactive']).optional(),
    })
    .refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' }),
});

export const deleteCompanySchema = z.object({ params: idParam });
