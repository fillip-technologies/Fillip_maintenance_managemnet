import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

const idParam = z.object({ id: z.string().uuid() });

export const listClientsSchema = z.object({
  query: paginationQuery.extend({
    search: z.string().trim().min(1).optional(),
    companyId: z.string().uuid().optional(),
  }),
});

export const getClientSchema = z.object({ params: idParam });

export const createClientSchema = z.object({
  body: z.object({
    companyId: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    type: z.string().trim().max(60).optional(),
    facilityName: z.string().trim().max(200).optional(),
    location: z.string().trim().max(200).optional(),
    imageUrl: z.string().trim().nullable().optional(),
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
    mapX: z.coerce.number().min(0).max(100).nullable().optional(),
    mapY: z.coerce.number().min(0).max(100).nullable().optional(),
    pinColor: z.string().trim().max(20).nullable().optional(),
  }),
});

export const updateClientSchema = z.object({
  params: idParam,
  body: z
    .object({
      companyId: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(160).optional(),
      type: z.string().trim().max(60).nullable().optional(),
      facilityName: z.string().trim().max(200).nullable().optional(),
      location: z.string().trim().max(200).nullable().optional(),
      imageUrl: z.string().trim().nullable().optional(),
      latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
      longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
      mapX: z.coerce.number().min(0).max(100).nullable().optional(),
      mapY: z.coerce.number().min(0).max(100).nullable().optional(),
      pinColor: z.string().trim().max(20).nullable().optional(),
    })
    .refine((d) => Object.keys(d).length > 0, { message: 'At least one field must be provided' }),
});

export const deleteClientSchema = z.object({ params: idParam });
