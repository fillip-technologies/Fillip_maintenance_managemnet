import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

const idParam = z.object({ id: z.string().uuid() });
const priority = z.enum(['low', 'medium', 'high', 'critical']);
const status = z.enum([
  'open',
  'assigned',
  'in_progress',
  'on_hold',
  'resolved',
  'closed',
  'reopened',
]);

export const listIssuesSchema = z.object({
  query: paginationQuery.extend({
    deviceId: z.string().uuid().optional(),
    zoneId: z.string().uuid().optional(),
    includeSubzones: z.enum(['true', 'false']).optional(),
    // Comma-separated list, e.g. `assigned,in_progress`.
    status: z.string().trim().min(1).optional(),
    priority: priority.optional(),
    assignedTechnicianId: z.string().uuid().optional(),
    raisedByMe: z.enum(['true', 'false']).optional(),
    scope: z.enum(['technician']).optional(),
  }),
});

export const getIssueSchema = z.object({ params: idParam });

export const createIssueSchema = z.object({
  body: z.object({
    deviceId: z.string().uuid(),
    categoryId: z.string().uuid(),
    // Normally derived from the authenticated user; accepted as a fallback.
    raisedByUserId: z.string().uuid().optional(),
    priority: priority.default('medium'),
    description: z.string().trim().min(1),
  }),
});

export const updateIssueSchema = z.object({
  params: idParam,
  body: z
    .object({
      priority: priority.optional(),
      description: z.string().trim().min(1).optional(),
    })
    .refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' }),
});

export const transitionIssueSchema = z.object({
  params: idParam,
  body: z.object({
    status,
    notes: z.string().trim().optional(),
    changedByUserId: z.string().uuid().optional(),
  }),
});

export const assignIssueSchema = z.object({
  params: idParam,
  body: z.object({
    technicianId: z.string().uuid(),
    notes: z.string().trim().optional(),
    changedByUserId: z.string().uuid().optional(),
  }),
});

export const createBulkIssueSchema = z.object({
  body: z.object({
    deviceIds:   z.array(z.string().uuid()).min(1).max(50),
    categoryId:  z.string().uuid(),
    raisedByUserId: z.string().uuid().optional(),
    priority:    priority.default('medium'),
    description: z.string().trim().min(1),
  }),
});
