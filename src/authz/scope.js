import { prisma } from '../lib/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { zoneService } from '../modules/zones/zone.service.js';

/**
 * Zone-path authorization. Resolves what a user may see/act on into a
 * normalized scope, then exposes per-resource `where` fragments and predicates.
 *
 * Five roles only:
 *   super_admin   — everything
 *   client_admin  — one client (+ all its zones)
 *   zone_incharge — assigned zone(s) AND all sub-zones (cascading, always on)
 *   zone_staff    — same cascading scope as an incharge
 *   technician    — issues assigned to them, or UNASSIGNED issues in coverage
 *
 * Scope shape:
 *   { platform: true }                              // super_admin
 *   { platform:false, clientIds[], zoneIds[], technicianId }
 *
 * A resource is in scope if it belongs to a visible client OR a visible zone.
 * zoneIds are always subtree-expanded — cascading down into sub-zones is the
 * intended behavior for both incharge and staff.
 */
export async function resolveScope(user) {
  if (user.role === 'super_admin') return { platform: true };

  const scope = {
    platform: false,
    clientIds: [],
    zoneIds: [],
    // Organizations whose company-level (in-stock) inventory the caller may see.
    // Only the org head gets this — zone roles are zone-scoped.
    companyIds: [],
    technicianId: user.technicianId ?? null,
  };

  if (user.role === 'client_admin') {
    if (user.clientId) scope.clientIds = [user.clientId];
    if (user.companyId) scope.companyIds = [user.companyId];
    return scope;
  }

  if (user.role === 'technician') {
    if (scope.technicianId) {
      const coverage = await prisma.technicianAssignment.findMany({
        where: { technicianId: scope.technicianId },
        select: {
          clientId: true,
          zoneId: true,
          client: { select: { companyId: true } },
        },
      });
      scope.clientIds = unique(coverage.map((c) => c.clientId).filter(Boolean));
      // Resolve company IDs so the technician can see in-stock units for their
      // assigned orgs — mirrors the client_admin companyIds path.
      scope.companyIds = unique(coverage.map((c) => c.client?.companyId).filter(Boolean));
      const roots = coverage.map((c) => c.zoneId).filter(Boolean);
      scope.zoneIds = await expandZones(roots);
    }
    return scope;
  }

  // zone_incharge / zone_staff — assigned zones ALWAYS cascade into sub-zones.
  const assignments = await prisma.zoneAssignment.findMany({
    where: { userId: user.id, unassignedAt: null },
    select: { zoneId: true },
  });
  const roots = assignments.map((a) => a.zoneId);
  scope.zoneIds = await expandZones(roots);
  return scope;
}

/** Expand each root zone into its full subtree (self + all descendants). */
async function expandZones(roots) {
  const unique_ = unique(roots);
  if (unique_.length === 0) return unique_;
  const sets = await Promise.all(unique_.map((id) => zoneService.subtreeIds(id)));
  return unique(sets.flat());
}

const unique = (arr) => [...new Set(arr)];

// A where fragment that deliberately matches no rows (denied scope).
const MATCH_NONE = { id: { in: [] } };

// ---- Per-resource scope `where` fragments (to be AND-combined) ----

// A technician's device/daily-log visibility stays coverage-wide (they need to
// see the devices they might service); only their ISSUE visibility is narrowed
// to "assigned to me OR unassigned" — see issueScopeWhere.
export function deviceScopeWhere(scope) {
  if (scope.platform) return {};
  const OR = [];
  if (scope.clientIds.length) OR.push({ zone: { clientId: { in: scope.clientIds } } });
  if (scope.zoneIds.length) OR.push({ zoneId: { in: scope.zoneIds } });
  // In-stock units (no zone) are visible to their owning organization's head.
  // Gated on `zoneId: null` so this never widens visibility of DEPLOYED units.
  if (scope.companyIds?.length) {
    OR.push({ AND: [{ zoneId: null }, { companyId: { in: scope.companyIds } }] });
  }
  return OR.length ? { OR } : MATCH_NONE;
}

export function issueScopeWhere(scope) {
  if (scope.platform) return {};

  // Technician: only issues ASSIGNED to them, or UNASSIGNED issues within their
  // coverage (client/zone, cascading). They never see issues another technician
  // is already handling. `assignedTechnicianId: null` == open/never-assigned,
  // since a reopen keeps the technician attached.
  if (scope.technicianId) {
    // Coverage = deployed units in their zones/clients + in-stock units for their orgs.
    const coverage = [];
    if (scope.clientIds.length) coverage.push({ device: { zone: { clientId: { in: scope.clientIds } } } });
    if (scope.zoneIds.length)   coverage.push({ device: { zoneId: { in: scope.zoneIds } } });
    if (scope.companyIds?.length) {
      coverage.push({ device: { AND: [{ zoneId: null }, { companyId: { in: scope.companyIds } }] } });
    }
    // A technician sees: issues assigned to them + open issues anywhere in their coverage.
    const OR = [{ assignedTechnicianId: scope.technicianId }];
    if (coverage.length) OR.push({ AND: [{ assignedTechnicianId: null }, { OR: coverage }] });
    return { OR };
  }

  const OR = [];
  if (scope.clientIds.length) OR.push({ device: { zone: { clientId: { in: scope.clientIds } } } });
  if (scope.zoneIds.length)   OR.push({ device: { zoneId: { in: scope.zoneIds } } });
  // Defects raised on in-stock units (no zone) are visible to the owning
  // organization's head — mirrors deviceScopeWhere, which lets the org head both
  // see and raise defects on its company-level (unzoned) inventory. Without this
  // an org head could raise a defect on a stock unit but never see it listed.
  if (scope.companyIds?.length) {
    OR.push({ device: { AND: [{ zoneId: null }, { companyId: { in: scope.companyIds } }] } });
  }
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
