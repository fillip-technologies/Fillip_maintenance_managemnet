import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { prisma } from '../lib/prisma.js';

// Short-lived in-memory cache so the authenticate middleware doesn't hit the
// DB on every single request. Cached for 30 s — accounts suspended/deleted
// in that window retain access briefly, which is acceptable given 7-day token TTL.
const _userCache = new Map();
const CACHE_TTL_MS = 30_000;

function getCachedUser(sub) {
  const hit = _userCache.get(sub);
  if (!hit) return null;
  if (Date.now() > hit.exp) { _userCache.delete(sub); return null; }
  return hit.profile;
}

function setCachedUser(sub, profile) {
  _userCache.set(sub, { profile, exp: Date.now() + CACHE_TTL_MS });
}

/** Call this immediately when a user is deleted or suspended so they can't ride the cache. */
export function evictUserCache(userId) {
  _userCache.delete(userId);
}

/**
 * Requires a valid Bearer access token AND that the account it points at still
 * exists and is active. Role/clientId are always taken from the DB row so a
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

  // Cache hit — skip DB round-trip.
  const cached = getCachedUser(claims.sub);
  if (cached) {
    req.user = cached;
    return next();
  }

  prisma.user
    .findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        role: true,
        clientId: true,
        companyId: true,
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
      const profile = {
        id: user.id,
        role: user.role,
        clientId: user.clientId ?? null,
        companyId: user.companyId ?? null,
        technicianId: user.technicianProfile?.id ?? null,
      };
      setCachedUser(claims.sub, profile);
      req.user = profile;
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
