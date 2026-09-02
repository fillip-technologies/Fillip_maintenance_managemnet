import { z } from 'zod';
import { paginationQuery } from '../../utils/pagination.js';

const idParam = z.object({ id: z.string().uuid() });

export const listProductsSchema = z.object({
  query: paginationQuery.extend({
    // super_admin may filter by company; ignored for a client_admin (locked to
    // their own company server-side).
    companyId: z.string().uuid().optional(),
    search: z.string().trim().min(1).optional(),
  }),
});

export const createProductSchema = z.object({
  body: z.object({
    // Required for super_admin (they pick the org); for a client_admin it's
    // derived server-side and any mismatching value is rejected.
    companyId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().max(100).optional(),
    serialNumber: z.string().trim().max(120).optional(),
    quantity: z.coerce.number().int().min(0).default(0),
    unitPrice: z.coerce.number().nonnegative().optional(),
    purchaseDate: z.coerce.date().optional(),
    installationDate: z.coerce.date().optional(),
    imageUrl: z.string().trim().max(2000).optional(),
  }),
});

export const deleteProductSchema = z.object({ params: idParam });

export const productAuditSchema = z.object({
  query: paginationQuery.extend({
    companyId: z.string().uuid().optional(),
  }),
});
