import { timingSafeEqual } from 'node:crypto';
import { env } from '../../../config/env.js';
import { InventoryError } from '../http/errors.js';
import { resolveActor } from './identityClient.js';
import { fixlyActorFromToken } from './fixlyActor.js';
import { actorContext } from './context.js';

/** Every /api/inventory/v1 request: who is calling, in the operator's organization. */
export async function authenticateActor(req, _res, next) {
  try {
    const authorization = req.get('authorization');
    if (!authorization?.toLowerCase().startsWith('bearer ')) {
      throw new InventoryError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    // A Fixly token (Fixly web / mobile) is checked here; anything else goes to FBOS Identity.
    const fixly = await fixlyActorFromToken(authorization.slice(7).trim());
    if (fixly) {
      req.actor = fixly;
      return actorContext.run({ legacyUserId: fixly.legacyUserId }, next);
    }
    const actor = await resolveActor(authorization, req.get('x-organization-id'));
    // This service only holds the operator organization's inventory. Another
    // organization's caller is told nothing exists, so ids cannot be probed.
    if (env.FBOS_ORGANIZATION_ID && actor.organizationId !== env.FBOS_ORGANIZATION_ID) {
      throw new InventoryError(404, 'ORGANIZATION_NOT_SERVED', 'This organization has no inventory here');
    }
    req.actor = actor;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Route guard: the caller must hold `code`. Marked so the unguarded-route test
 * (scripts/inventory_routes.test.mjs) can find it on every route.
 */
export function requirePermission(code) {
  const guard = (req, _res, next) => {
    if (!req.actor?.has(code)) {
      return next(
        new InventoryError(403, 'PERMISSION_DENIED', `You need the '${code}' permission to do this`, {
          meta: { required_permission: code },
        }),
      );
    }
    return next();
  };
  guard.isPermissionGuard = true;
  guard.requiredPermission = code;
  return guard;
}

/** Internal service-to-service routes (Documents → inventory): the shared token. */
export function requireInternalCaller(req, _res, next) {
  if (env.FBOS_INTERNAL_TOKEN && req.get('x-fbos-internal-token') !== env.FBOS_INTERNAL_TOKEN) {
    return next(new InventoryError(403, 'INTERNAL_CALLER_REQUIRED', 'Only FBOS services may call this'));
  }
  return next();
}
requireInternalCaller.isPermissionGuard = true;

/**
 * Whether a service-to-service call with no user behind it may go ahead. Unlike
 * requireInternalCaller (whose routes still check the forwarded user), nothing else guards
 * these routes, so a missing FBOS_INTERNAL_TOKEN refuses everyone outside development.
 */
export function serviceTokenAccepted(expected, given, nodeEnv) {
  if (!expected) return nodeEnv === 'development';
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Internal routes no user is behind (the gateway's nightly snapshots): the shared token, always. */
export function requireServiceCaller(req, _res, next) {
  if (!serviceTokenAccepted(env.FBOS_INTERNAL_TOKEN, req.get('x-fbos-internal-token'), env.NODE_ENV)) {
    return next(new InventoryError(403, 'INTERNAL_CALLER_REQUIRED', 'Only FBOS services may call this'));
  }
  return next();
}
requireServiceCaller.isPermissionGuard = true;
