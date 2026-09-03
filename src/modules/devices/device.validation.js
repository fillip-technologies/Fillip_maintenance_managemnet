import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

const idParam = z.object({ id: z.string().uuid() });

export const listDevicesSchema = z.object({
  query: paginationQuery.extend({
    zoneId: z.string().uuid().optional(),
    includeSubzones: z.enum(['true', 'false']).optional(),
    status: z.enum(['provisioned', 'active', 'under_maintenance', 'faulty', 'retired']).optional(),
    search: z.string().trim().min(1).optional(),
    // Super-admin org filter: narrow the platform-wide list to one company.
    companyId: z.string().uuid().optional(),
  }),
});

export const getDeviceSchema = z.object({ params: idParam });

// Unified unit ("Product") create: category REQUIRED, zone OPTIONAL (no zone =
// in stock), company optional (locked to own org for a client_admin; required
// for a super_admin unless derived from a zone). Code is generated server-side.
export const createDeviceSchema = z.object({
  body: z.object({
    categoryId: z.string().uuid(),
    companyId: z.string().uuid().optional(),
    zoneId: z.string().uuid().optional(),
    hardwareTypeId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(120),
    location: z.string().trim().max(200).optional(),
    unitPrice: z.coerce.number().nonnegative().optional(),
    purchaseDate: z.coerce.date().optional(),
    installDate: z.coerce.date().optional(),
    imageUrl: z.string().trim().max(2000).optional(),
    isManualEntry: z.boolean().default(false),
    customSpec: z.record(z.any()).optional(),
  }),
});

export const deployDeviceSchema = z.object({
  params: idParam,
  body: z.object({ zoneId: z.string().uuid() }),
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
