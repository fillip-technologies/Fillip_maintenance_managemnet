import { resolveScope } from '../authz/scope.js';

/**
 * Resolves the caller's zone-path authorization scope once per request and
 * hangs it on `req.scope`. Runs after `authenticate`, so `req.user` is set.
 */
export function attachScope(req, _res, next) {
  resolveScope(req.user)
    .then((scope) => {
      req.scope = scope;
      next();
    })
    .catch(next);
}
