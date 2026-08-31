import { z } from 'zod';

/** Reusable pagination query shape → `{ page, limit }` with sane bounds. */
export const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/** Build a Prisma skip/take + a pagination meta object from parsed query. */
export function paginate({ page, limit }, total) {
  return {
    skip: (page - 1) * limit,
    take: limit,
    meta: { page, limit, totalItems: total, totalPages: Math.ceil(total / limit) },
  };
}
