import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

export const listLogsSchema = z.object({
  query: paginationQuery.extend({
    deviceId: z.string().uuid().optional(),
    zoneId: z.string().uuid().optional(),
    includeSubzones: z.enum(['true', 'false']).optional(),
    date: z.coerce.date().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }),
});

export const createLogSchema = z.object({
  body: z.object({
    deviceId: z.string().uuid(),
    // Normally derived from the authenticated user; accepted as a fallback.
    loggedByUserId: z.string().uuid().optional(),
    status: z.enum(['working', 'not_working', 'needs_attention']),
    logDate: z.coerce.date().optional(),
    notes: z.string().trim().optional(),
    // When true, replace an existing same-day log instead of 409-ing.
    overwrite: z.boolean().default(false),
  }),
});
