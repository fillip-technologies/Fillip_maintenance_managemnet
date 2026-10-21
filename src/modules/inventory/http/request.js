import { InventoryError } from './errors.js';

/** Wraps an async handler so a rejection reaches the inventory error handler. */
export const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Validate `{ params, query, body }` against a zod object schema. Parsed values
 * land on req.params / req.input.query / req.input.body. Failures answer 422
 * with one entry per problem, like FastAPI's validation errors.
 */
export const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse({ params: req.params, query: req.query, body: req.body });
  if (!result.success) {
    return next(
      new InventoryError(422, 'VALIDATION_ERROR', 'The request is not valid', {
        details: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      }),
    );
  }
  req.input = { query: result.data.query ?? {}, body: result.data.body ?? {} };
  if (result.data.params) req.params = result.data.params;
  return next();
};

/** `If-Match: 3` (or "3", W/"3") → 3. Undefined when absent; 428 is the caller's choice. */
export function ifMatchVersion(req) {
  const raw = req.get('if-match');
  if (!raw) return undefined;
  const version = Number(raw.replace(/^W\//, '').replace(/"/g, ''));
  if (!Number.isInteger(version)) throw new InventoryError(400, 'INVALID_IF_MATCH', 'If-Match must be a version number');
  return version;
}

export function assertVersion(record, expected) {
  if (expected !== undefined && record.version !== expected) {
    throw new InventoryError(409, 'VERSION_MISMATCH', 'Someone else changed this record. Reload and try again.', {
      meta: { expected_version: expected, current_version: record.version },
    });
  }
}
