/**
 * Operational error with an associated HTTP status code and a stable machine
 * `code` the frontend can branch on (e.g. INVALID_TRANSITION). Anything thrown
 * as an ApiError is "expected" and safe to surface; unexpected errors → 500.
 */
export class ApiError extends Error {
  constructor(statusCode, message, { code, details, cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code ?? defaultCode(statusCode);
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(message = 'Bad request', details, code = 'BAD_REQUEST') {
    return new ApiError(400, message, { code, details });
  }

  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    return new ApiError(401, message, { code });
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
    return new ApiError(403, message, { code });
  }

  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new ApiError(404, message, { code });
  }

  static conflict(message = 'Conflict', details, code = 'CONFLICT') {
    return new ApiError(409, message, { code, details });
  }
}

function defaultCode(statusCode) {
  return (
    {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
    }[statusCode] ?? 'INTERNAL_ERROR'
  );
}
