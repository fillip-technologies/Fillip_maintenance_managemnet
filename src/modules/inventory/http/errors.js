import { Prisma } from '@prisma/client';
import { ApiError } from '../../../utils/ApiError.js';
import { logger } from '../../../config/logger.js';

/**
 * Errors on /api/inventory/v1 use the FBOS wire shape (integration plan §5.4):
 *   { "detail": { "code", "message", "status", "meta"?, "details"? } }
 * so the FBOS console handles them like any other service's errors. The legacy
 * /api/v1 keeps its own shape; the two routers never share an error handler.
 */
export class InventoryError extends Error {
  constructor(status, code, message, { meta, details } = {}) {
    super(message);
    this.name = 'InventoryError';
    this.status = status;
    this.code = code;
    this.meta = meta;
    this.details = details;
  }
}

export const notFound = (what, meta) =>
  new InventoryError(404, `${what.toUpperCase().replace(/ /g, '_')}_NOT_FOUND`, `${what[0].toUpperCase()}${what.slice(1)} not found`, { meta });

export const conflict = (code, message, meta) => new InventoryError(409, code, message, { meta });
export const unprocessable = (code, message, meta) => new InventoryError(422, code, message, { meta });

function toInventoryError(err) {
  if (err instanceof InventoryError) return err;
  if (err instanceof ApiError) {
    // Domain helpers shared with the legacy API throw ApiError; keep their code.
    return new InventoryError(err.statusCode, err.code, err.message, { meta: err.details });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return new InventoryError(409, 'DUPLICATE', 'A record with these values already exists', { meta: { target: err.meta?.target } });
    }
    if (err.code === 'P2025') return new InventoryError(404, 'NOT_FOUND', 'Record not found');
    if (err.code === 'P2003') {
      return new InventoryError(409, 'IN_USE', 'Other records still refer to this one', { meta: { field: err.meta?.field_name } });
    }
  }
  if (err?.type === 'entity.parse.failed') return new InventoryError(400, 'INVALID_JSON', 'The request body is not valid JSON');
  return null;
}

// eslint-disable-next-line no-unused-vars
export function inventoryErrorHandler(err, req, res, _next) {
  const known = toInventoryError(err);
  if (!known) {
    logger.error({ err, reqId: req.id, path: req.originalUrl }, 'Inventory API error');
    return res.status(500).json({ detail: { code: 'INTERNAL_ERROR', message: 'Something went wrong', status: 500 } });
  }
  if (known.status >= 500) logger.error({ err, reqId: req.id }, 'Inventory API error');
  const detail = { code: known.code, message: known.message, status: known.status };
  if (known.meta !== undefined) detail.meta = known.meta;
  if (known.details !== undefined) detail.details = known.details;
  return res.status(known.status).json({ detail });
}
