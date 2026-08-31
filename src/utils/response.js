/**
 * Response envelope helpers — the frontend contract is:
 *   success: { "success": true, "data": ... }
 *   list:    { "success": true, "data": { items, page, limit, totalItems, totalPages } }
 *   error:   { "success": false, "code": "...", "message": "...", "details"?: ... }
 */

export function sendSuccess(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function sendCreated(res, data) {
  return sendSuccess(res, data, 201);
}

/** Wraps a page of items + pagination meta into the contract's list shape. */
export function listPayload(items, meta) {
  return { items, ...meta };
}
