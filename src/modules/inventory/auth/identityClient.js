import { env } from '../../../config/env.js';
import { InventoryError } from '../http/errors.js';

/**
 * Who is calling, asked of FBOS Identity on every request (integration plan §5.1).
 * The caller's `Authorization` and `X-Organization-Id` are forwarded to
 * `/internal/authz/actor`; nothing else about the caller is ever trusted (the
 * gateway forwards every header). Identity's own 401/404 are relayed; if
 * Identity cannot answer, the request is refused with 503, never allowed.
 * Answers are reused for FBOS_ACTOR_CACHE_SECONDS, like the legacy authenticate.
 */
const ACTOR_PATH = '/api/identity/v1/internal/authz/actor';
const PEOPLE_PATH = '/api/identity/v1/internal/people';
const cache = new Map();

export class Actor {
  constructor(body) {
    this.userId = body.user_id;
    this.organizationId = body.organization_id;
    this.userType = body.user_type;
    this.name = body.name;
    this.isSuperuser = Boolean(body.is_superuser);
    this.permissions = new Set(body.permissions ?? []);
    this.ownRecordsOnly = new Set(body.own_records_only ?? []);
    this.unitScopes = Object.fromEntries(Object.entries(body.unit_scopes ?? {}).map(([code, ids]) => [code, new Set(ids)]));
  }

  has(code) {
    return this.isSuperuser || this.permissions.has(code);
  }

  onlyOwn(code) {
    return !this.isSuperuser && this.ownRecordsOnly.has(code);
  }

  /** Units the code is held within, or null when it is not limited to units. */
  unitsFor(code) {
    return this.isSuperuser ? null : this.unitScopes[code] ?? null;
  }
}

export const unavailable = () =>
  new InventoryError(503, 'AUTH_SERVICE_UNAVAILABLE', 'Sign-in could not be checked right now. Try again shortly.');

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.FBOS_IDENTITY_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch {
    throw unavailable();
  } finally {
    clearTimeout(timer);
  }
}

function internalHeaders() {
  return env.FBOS_INTERNAL_TOKEN ? { 'X-FBOS-Internal-Token': env.FBOS_INTERNAL_TOKEN } : {};
}

export async function resolveActor(authorization, organizationId) {
  const key = `${authorization}|${organizationId ?? ''}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.actor;

  const url = new URL(ACTOR_PATH, env.FBOS_IDENTITY_URL);
  url.searchParams.set('with_units', 'true');
  const response = await fetchWithTimeout(url, {
    headers: {
      Authorization: authorization,
      ...(organizationId ? { 'X-Organization-Id': organizationId } : {}),
      ...internalHeaders(),
    },
  });
  if (response.status >= 500) throw unavailable();
  const body = await response.json().catch(() => null);
  if (response.status >= 400) {
    // Relay Identity's own answer (expired token, unknown organization) when it gave one.
    const detail = body?.detail && typeof body.detail === 'object' ? body.detail : null;
    if (!detail?.code && !body?.code) throw unavailable();
    throw new InventoryError(response.status, detail?.code ?? body.code, detail?.message ?? body.detail ?? body.title ?? 'Not allowed', {
      meta: detail?.meta,
    });
  }

  const actor = new Actor(body);
  if (env.FBOS_ACTOR_CACHE_SECONDS > 0) {
    cache.set(key, { actor, expiresAt: Date.now() + env.FBOS_ACTOR_CACHE_SECONDS * 1000 });
    if (cache.size > 5000) cache.delete(cache.keys().next().value);
  }
  return actor;
}

/** Names for user ids (technicians, approvers), from Identity's internal people list. */
export async function peopleNames(organizationId) {
  const url = new URL(PEOPLE_PATH, env.FBOS_IDENTITY_URL);
  url.searchParams.set('organization_id', organizationId);
  const response = await fetchWithTimeout(url, { headers: internalHeaders() });
  if (!response.ok) return new Map();
  const body = await response.json();
  return new Map((body.people ?? body.data ?? []).map((p) => [p.id, p.name]));
}

export function clearActorCache() {
  cache.clear();
}
