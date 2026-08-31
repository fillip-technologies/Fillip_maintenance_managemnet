import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/jwt.js';

/**
 * Requires a valid Bearer access token. Populates `req.user` with the token's
 * identity + scope claims: `{ id, role, companyId, clientId, technicianId }`.
 */
export function authenticate(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }
  try {
    const claims = verifyAccessToken(token);
    req.user = {
      id: claims.sub,
      role: claims.role,
      companyId: claims.companyId ?? null,
      clientId: claims.clientId ?? null,
      technicianId: claims.technicianId ?? null,
    };
    return next();
  } catch {
    return next(ApiError.unauthorized('Invalid or expired token', 'TOKEN_INVALID'));
  }
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
