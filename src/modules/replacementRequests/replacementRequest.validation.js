import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

const idParam = z.object({ id: z.string().uuid() });
const coordLatitude = z.coerce.number().min(-90).max(90).optional().nullable();
const coordLongitude = z.coerce.number().min(-180).max(180).optional().nullable();

export const REPLACEMENT_REASONS = ['physical_damage', 'burnt_water', 'unrepairable', 'obsolete'];
export const REPLACEMENT_CHOICES = ['in_stock', 'new_device', 'none'];

export const listReplacementRequestsSchema = z.object({
  query: paginationQuery.extend({
    // Comma-separated, e.g. `pending,approved`.
    status: z.string().trim().min(1).optional(),
    issueId: z.string().uuid().optional(),
  }),
});

export const getReplacementRequestSchema = z.object({ params: idParam });

export const createReplacementRequestSchema = z.object({
  body: z
    .object({
      issueId: z.string().uuid(),
      reason: z.enum(['physical_damage', 'burnt_water', 'unrepairable', 'obsolete']),
      replacementChoice: z.enum(['in_stock', 'new_device', 'none']),
      spareDeviceId: z.string().uuid().optional().nullable(),
      newDeviceName: z.string().trim().max(160).optional().nullable(),
      notes: z.string().trim().max(2000).optional().nullable(),
    })
    .refine((d) => d.replacementChoice !== 'in_stock' || !!d.spareDeviceId, {
      message: 'spareDeviceId is required when using an in-stock spare',
      path: ['spareDeviceId'],
    }),
});

export const reviewReplacementRequestSchema = z.object({
  params: idParam,
  body: z.object({ reviewNote: z.string().trim().max(2000).optional().nullable() }),
});

export const completeReplacementRequestSchema = z.object({
  params: idParam,
  body: z.object({
    latitude: coordLatitude,
    longitude: coordLongitude,
    notes: z.string().trim().max(2000).optional().nullable(),
  }),
});
