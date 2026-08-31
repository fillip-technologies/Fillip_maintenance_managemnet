import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

const idParam = z.object({ id: z.string().uuid() });

export const listTechniciansSchema = z.object({
  query: paginationQuery.extend({ search: z.string().trim().min(1).optional() }),
});

export const getTechnicianSchema = z.object({ params: idParam });

export const createTechnicianSchema = z.object({
  body: z.object({
    userId: z.string().uuid(),
    specialization: z.string().trim().max(100).optional(),
  }),
});

export const updateTechnicianSchema = z.object({
  params: idParam,
  body: z.object({ specialization: z.string().trim().max(100).nullable() }),
});

export const deleteTechnicianSchema = z.object({ params: idParam });

export const addAssignmentSchema = z.object({
  params: idParam,
  body: z
    .object({
      clientId: z.string().uuid().optional(),
      zoneId: z.string().uuid().optional(),
    })
    .refine((d) => d.clientId || d.zoneId, {
      message: 'At least one of clientId or zoneId is required',
    }),
});

export const removeAssignmentSchema = z.object({
  params: z.object({ id: z.string().uuid(), assignmentId: z.string().uuid() }),
});
