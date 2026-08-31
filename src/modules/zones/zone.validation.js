import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

const idParam = z.object({ id: z.string().uuid() });

export const listZonesSchema = z.object({
  query: paginationQuery.extend({
    clientId: z.string().uuid().optional(),
    parentZoneId: z.string().uuid().optional(),
    // `null` (string) filters to top-level zones only.
    topLevel: z.enum(['true', 'false']).optional(),
    status: z.enum(['draft', 'active', 'inactive']).optional(),
    search: z.string().trim().min(1).optional(),
  }),
});

export const getZoneSchema = z.object({ params: idParam });

export const createZoneSchema = z.object({
  body: z.object({
    clientId: z.string().uuid(),
    parentZoneId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(120),
    // Normally derived from the authenticated user; accepted as a fallback.
    createdById: z.string().uuid().optional(),
  }),
});

export const descendantsSchema = z.object({ params: idParam });

export const updateZoneSchema = z.object({
  params: idParam,
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      parentZoneId: z.string().uuid().nullable().optional(),
    })
    .refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' }),
});

export const setZoneStatusSchema = z.object({
  params: idParam,
  body: z.object({ status: z.enum(['draft', 'active', 'inactive']) }),
});

export const deleteZoneSchema = z.object({ params: idParam });

export const assignSchema = z.object({
  params: idParam,
  body: z.object({
    userId: z.string().uuid(),
    role: z.enum(['incharge', 'staff']),
  }),
});

export const unassignSchema = z.object({
  params: z.object({ id: z.string().uuid(), assignmentId: z.string().uuid() }),
});
