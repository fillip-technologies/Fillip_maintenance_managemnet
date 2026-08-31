import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError.js';
import { isProduction } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Maps known Prisma errors onto ApiErrors so clients get meaningful status
 * codes instead of raw 500s.
 */
function normalize(err) {
  if (err instanceof ApiError) return err;

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        const target = err.meta?.target;
        const fields = Array.isArray(target) ? target.join(', ') : target;
        return ApiError.conflict(`A record with this ${fields ?? 'value'} already exists`);
      }
      case 'P2025':
        return ApiError.notFound('Resource not found');
      case 'P2003':
        return ApiError.badRequest('Related record does not exist');
      default:
        return new ApiError(400, 'Database request error', { code: 'DB_REQUEST_ERROR' });
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return ApiError.badRequest('Invalid data provided');
  }

  return new ApiError(500, err.message || 'Internal server error', { code: 'INTERNAL_ERROR' });
}

// eslint-disable-next-line no-unused-vars -- Express requires the 4-arg signature.
export const errorHandler = (err, req, res, _next) => {
  const apiError = normalize(err);

  if (!apiError.isOperational || apiError.statusCode >= 500) {
    logger.error({ err, reqId: req.id }, 'Unhandled error');
  } else {
    logger.warn({ msg: apiError.message, code: apiError.code, reqId: req.id }, 'Request error');
  }

  res.status(apiError.statusCode).json({
    success: false,
    code: apiError.code,
    message: apiError.statusCode >= 500 && isProduction ? 'Internal server error' : apiError.message,
    ...(apiError.details ? { details: apiError.details } : {}),
    ...(isProduction ? {} : { stack: err.stack }),
  });
};
