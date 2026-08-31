import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { zoneService } from '../modules/zones/zone.service.js';

/**
 * Zone-path authorization (spec §2). Resolves what a user may see/act on into a
 * normalized scope, then exposes per-resource `where` fragments and predicates.
 *
 * Scope shape:
 *   { platform: true }                         // super_admin — everything
 *   { platform:false, companyId?, clientIds[], zoneIds[], technicianId }
 *
 * A resource is in scope if it belongs to a visible client OR a visible zone
 * (zoneIds are already subtree-expanded where cascading applies).
 */
export async function resolveScope(user) {
  if (user.role === 'super_admin') return { platform: true };

  const scope = {
    platform: false,
    companyId: null,
    clientIds: [],
    zoneIds: [],
    technicianId: user.technicianId ?? null,
  };

  if (user.role === 'company_admin') {
    if (user.companyId) {
      scope.companyId = user.companyId;
      const clients = await prisma.client.findMany({
        where: { companyId: user.companyId },
        select: { id: true },
      });
      scope.clientIds = clients.map((c) => c.id);
    }
    return scope;
  }

  if (user.role === 'client_admin') {
    if (user.clientId) scope.clientIds = [user.clientId];
    return scope;
  }

  if (user.role === 'technician') {
    if (scope.technicianId) {
      const coverage = await prisma.technicianAssignment.findMany({
        where: { technicianId: scope.technicianId },
        select: { clientId: true, zoneId: true },
      });
      scope.clientIds = unique(coverage.map((c) => c.clientId).filter(Boolean));
      const roots = coverage.map((c) => c.zoneId).filter(Boolean);
      scope.zoneIds = await expandZones(roots, true); // coverage includes sub-zones
    }
    return scope;
  }

  // zone_incharge / zone_staff — visibility from active assignments.
  const assignments = await prisma.zoneAssignment.findMany({
    where: { userId: user.id, unassignedAt: null },
    select: { zoneId: true },
  });
  const roots = assignments.map((a) => a.zoneId);
  const cascade = env.CASCADING_VISIBILITY && user.role === 'zone_incharge';
  scope.zoneIds = await expandZones(roots, cascade);
  return scope;
}

async function expandZones(roots, cascade) {
  const unique_ = unique(roots);
  if (!cascade || unique_.length === 0) return unique_;
  const sets = await Promise.all(unique_.map((id) => zoneService.subtreeIds(id)));
  return unique(sets.flat());
}

const unique = (arr) => [...new Set(arr)];

// A where fragment that deliberately matches no rows (denied scope).
const MATCH_NONE = { id: { in: [] } };

// ---- Per-resource scope `where` fragments (to be AND-combined) ----

export function deviceScopeWhere(scope) {
  if (scope.platform) return {};
  const OR = [];
  if (scope.clientIds.length) OR.push({ zone: { clientId: { in: scope.clientIds } } });
  if (scope.zoneIds.length) OR.push({ zoneId: { in: scope.zoneIds } });
  return OR.length ? { OR } : MATCH_NONE;
}

export function issueScopeWhere(scope) {
  if (scope.platform) return {};
  const OR = [];
  if (scope.clientIds.length) OR.push({ device: { zone: { clientId: { in: scope.clientIds } } } });
  if (scope.zoneIds.length) OR.push({ device: { zoneId: { in: scope.zoneIds } } });
  if (scope.technicianId) OR.push({ assignedTechnicianId: scope.technicianId });
  return OR.length ? { OR } : MATCH_NONE;
}

export function dailyLogScopeWhere(scope) {
  if (scope.platform) return {};
  const OR = [];
  if (scope.clientIds.length) OR.push({ device: { zone: { clientId: { in: scope.clientIds } } } });
  if (scope.zoneIds.length) OR.push({ device: { zoneId: { in: scope.zoneIds } } });
  return OR.length ? { OR } : MATCH_NONE;
}

export function zoneScopeWhere(scope) {
  if (scope.platform) return {};
  const OR = [];
  if (scope.clientIds.length) OR.push({ clientId: { in: scope.clientIds } });
  if (scope.zoneIds.length) OR.push({ id: { in: scope.zoneIds } });
  return OR.length ? { OR } : MATCH_NONE;
}

export function clientScopeWhere(scope) {
  if (scope.platform) return {};
  return scope.clientIds.length ? { id: { in: scope.clientIds } } : MATCH_NONE;
}

export function userScopeWhere(scope) {
  if (scope.platform) return {};
  if (scope.companyId) {
    return { OR: [{ companyId: scope.companyId }, { client: { companyId: scope.companyId } }] };
  }
  return scope.clientIds.length ? { clientId: { in: scope.clientIds } } : MATCH_NONE;
}

/** AND-combine a scope fragment with a filter fragment without key clobbering. */
export function combine(scopeWhere, base) {
  const scopeEmpty = !scopeWhere || Object.keys(scopeWhere).length === 0;
  const baseEmpty = !base || Object.keys(base).length === 0;
  if (scopeEmpty) return base ?? {};
  if (baseEmpty) return scopeWhere;
  return { AND: [scopeWhere, base] };
}

// ---- Sync predicates for write-time checks (caller already has the row) ----

export function clientInScope(scope, clientId) {
  return scope.platform || scope.clientIds.includes(clientId);
}

export function zoneInScope(scope, { id, clientId }) {
  if (scope.platform) return true;
  if (clientId && scope.clientIds.includes(clientId)) return true;
  return scope.zoneIds.includes(id);
}

export function deviceInScope(scope, { zoneId, clientId }) {
  if (scope.platform) return true;
  if (clientId && scope.clientIds.includes(clientId)) return true;
  return scope.zoneIds.includes(zoneId);
}

export function assertInScope(inScope, message = 'You do not have access to this resource') {
  if (!inScope) throw ApiError.forbidden(message);
}
