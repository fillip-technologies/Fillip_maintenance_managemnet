import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

const idParam = z.object({ id: z.string().uuid() });

export const listDevicesSchema = z.object({
  query: paginationQuery.extend({
    zoneId: z.string().uuid().optional(),
    includeSubzones: z.enum(['true', 'false']).optional(),
    status: z.enum(['provisioned', 'active', 'under_maintenance', 'faulty', 'retired']).optional(),
    search: z.string().trim().min(1).optional(),
  }),
});

export const getDeviceSchema = z.object({ params: idParam });

export const createDeviceSchema = z.object({
  body: z
    .object({
      zoneId: z.string().uuid(),
      hardwareTypeId: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(120),
      location: z.string().trim().max(200).optional(),
      installDate: z.coerce.date().optional(),
      isManualEntry: z.boolean().default(false),
      customSpec: z.record(z.any()).optional(),
      // Normally derived from the authenticated user; accepted as a fallback.
      addedById: z.string().uuid().optional(),
    })
    .refine((d) => d.isManualEntry || !!d.hardwareTypeId, {
      message: 'hardwareTypeId is required unless isManualEntry is true',
      path: ['hardwareTypeId'],
    }),
});

export const updateDeviceSchema = z.object({
  params: idParam,
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      location: z.string().trim().max(200).nullable().optional(),
      installDate: z.coerce.date().nullable().optional(),
      hardwareTypeId: z.string().uuid().nullable().optional(),
      customSpec: z.record(z.any()).nullable().optional(),
    })
    .refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' }),
});

export const setDeviceStatusSchema = z.object({
  params: idParam,
  // under_maintenance / faulty are managed automatically by the domain.
  body: z.object({ status: z.enum(['active', 'retired']) }),
});
