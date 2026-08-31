import { ApiError } from '../utils/ApiError.js';

/**
 * Validates and coerces `req.body`, `req.query`, and `req.params` against a Zod
 * schema shaped like `{ body, query, params }`. Parsed values replace the raw
 * input so downstream handlers work with typed, sanitized data.
 */
export const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params,
  });

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return next(ApiError.badRequest('Validation failed', details, 'VALIDATION_ERROR'));
  }

  if (result.data.body !== undefined) req.body = result.data.body;
  if (result.data.query !== undefined) req.validatedQuery = result.data.query;
  if (result.data.params !== undefined) req.params = result.data.params;

  return next();
};
