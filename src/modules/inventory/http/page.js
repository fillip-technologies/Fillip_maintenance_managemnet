import { z } from 'zod';
import { InventoryError } from './errors.js';

/**
 * FBOS cursor pages: `?limit=&cursor=` in, `{ data, page: { next_cursor, has_more, limit } }`
 * out (fbos_services schemas/common.py PageResponse). The cursor is an opaque
 * offset; `total` is added for registers that show a count.
 */
export const pageQuery = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
};

export function pageWindow({ limit, cursor }) {
  let offset = 0;
  if (cursor) {
    try {
      offset = JSON.parse(Buffer.from(cursor, 'base64url').toString()).o;
    } catch {
      throw new InventoryError(400, 'INVALID_CURSOR', 'The page cursor is not valid');
    }
    if (!Number.isInteger(offset) || offset < 0) throw new InventoryError(400, 'INVALID_CURSOR', 'The page cursor is not valid');
  }
  return { skip: offset, take: limit + 1, offset, limit };
}

export function pageOf(rows, window, total) {
  const hasMore = rows.length > window.limit;
  const data = hasMore ? rows.slice(0, window.limit) : rows;
  const nextCursor = hasMore ? Buffer.from(JSON.stringify({ o: window.offset + window.limit })).toString('base64url') : null;
  return { data, page: { next_cursor: nextCursor, has_more: hasMore, limit: window.limit, ...(total !== undefined ? { total } : {}) } };
}
