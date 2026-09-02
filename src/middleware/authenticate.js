import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { prisma } from '../lib/prisma.js';

/**
 * Requires a valid Bearer access token AND that the account it points at still
 * exists and is active. The token's signature is necessary but not sufficient:
 * we re-load the user every request so a deleted, removed, or suspended account
 * can't keep acting on a still-unexpired access token (a 15-min window
 * otherwise). Role/clientId are taken from the DB row — never the token — so a
 * stale token can't retain a privilege the account no longer has.
 *
 * Populates `req.user` with `{ id, role, clientId, technicianId }`.
 */
export function authenticate(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }
  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    return next(ApiError.unauthorized('Invalid or expired token', 'TOKEN_INVALID'));
  }
  prisma.user
    .findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        role: true,
        clientId: true,
        accountStatus: true,
        technicianProfile: { select: { id: true } },
      },
    })
    .then((user) => {
      // Missing (hard-deleted) or soft-removed → the session is dead.
      if (!user || user.accountStatus === 'removed') {
        return next(ApiError.unauthorized('Account no longer active', 'ACCOUNT_INACTIVE'));
      }
      if (user.accountStatus === 'suspended') {
        return next(ApiError.forbidden('Account suspended', 'ACCOUNT_SUSPENDED'));
      }
      req.user = {
        id: user.id,
        role: user.role,
        clientId: user.clientId ?? null,
        technicianId: user.technicianProfile?.id ?? null,
      };
      return next();
    })
    .catch(next);
}

/** Restrict a route to one of the given roles. Assumes `authenticate` ran first. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have access to this resource'));
    }
    return next();
  };
}
