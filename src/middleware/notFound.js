import { ApiError } from '../utils/ApiError.js';

/** Catch-all for unmatched routes → forwarded to the error handler as 404. */
export const notFound = (req, _res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};
