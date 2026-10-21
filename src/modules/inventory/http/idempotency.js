import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { InventoryError } from './errors.js';

/**
 * `Idempotency-Key` for writes that must never happen twice (goods receipt,
 * dispatch, repair dispatch; integration plan §5.4). The first request with a
 * key runs and its 2xx answer is stored; a retry with the same key and body gets
 * that answer back, a different body with the same key is refused. A request
 * that fails leaves no record, so it can be retried.
 */
const hashOf = (body) => createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');

export function requireIdempotencyKey(req, res, next) {
  const key = req.get('idempotency-key');
  if (!key || key.length > 120) {
    return next(new InventoryError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (up to 120 characters) with this request'));
  }
  const scope = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path} ${req.params.id ?? ''} ${req.actor?.userId ?? ''}`.slice(0, 200);
  const requestHash = hashOf(req.body);

  (async () => {
    const existing = await prisma.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new InventoryError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request');
      }
      if (existing.responseStatus == null) {
        throw new InventoryError(409, 'IDEMPOTENCY_IN_PROGRESS', 'The first request with this Idempotency-Key is still running');
      }
      res.set('Idempotent-Replayed', 'true');
      return res.status(existing.responseStatus).json(existing.responseBody);
    }
    let row;
    try {
      row = await prisma.idempotencyKey.create({ data: { scope, key, requestHash } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new InventoryError(409, 'IDEMPOTENCY_IN_PROGRESS', 'The first request with this Idempotency-Key is still running');
      }
      throw err;
    }
    const json = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode;
      const save = status < 300
        ? prisma.idempotencyKey.update({ where: { id: row.id }, data: { responseStatus: status, responseBody: body } })
        : prisma.idempotencyKey.delete({ where: { id: row.id } });
      save.catch(() => {}).finally(() => json(body));
      return res;
    };
    return next();
  })().catch(next);
}
requireIdempotencyKey.isIdempotency = true;
