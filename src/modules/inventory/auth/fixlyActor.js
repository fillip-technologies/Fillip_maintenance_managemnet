import { prisma } from '../../../lib/prisma.js';
import { verifyAccessToken } from '../../../utils/jwt.js';
import { resolveScope } from '../../../authz/scope.js';
import { InventoryError } from '../http/errors.js';
import { P } from '../permissions.js';

/**
 * Fixly is its own platform: the Fixly web and mobile apps sign in with Fixly's
 * users and roles, not FBOS Identity. Their tokens are accepted on
 * /api/inventory/v1 too, so both platforms share one inventory API and one set
 * of rules. A Fixly role becomes a fixed permission set (the design doc §8 role
 * matrix), and Fixly's zone-path scope becomes the record scope.
 */
const ALL = Object.values(P);

export const ROLE_PERMISSIONS = {
  // The operator (CEO / platform): everything.
  super_admin: ALL,
  // The customer organization's head: their organization's devices, stores,
  // zones, issues and replacements; moving their stock between their stores.
  // No prices, purchasing, repairs (vendor costs), disposals or cross-customer reports.
  client_admin: [
    P.DEVICE_READ, P.DEVICE_WRITE, P.SETUP_MANAGE, P.CATALOG_READ, P.WARRANTY_READ,
    P.TRANSFER_READ, P.TRANSFER_WRITE, P.TRANSFER_APPROVE, P.TRANSFER_DISPATCH, P.TRANSFER_RECEIVE,
    P.ISSUE_READ, P.ISSUE_WRITE, P.ISSUE_ASSIGN, P.REPLACEMENT_WRITE, P.REPLACEMENT_APPROVE,
    P.MAINTENANCE_READ,
  ],
  // Zone officers: their zones' devices, raising and following issues, daily status.
  zone_incharge: [P.DEVICE_READ, P.WARRANTY_READ, P.ISSUE_READ, P.ISSUE_WRITE],
  zone_staff: [P.DEVICE_READ, P.WARRANTY_READ, P.ISSUE_READ, P.ISSUE_WRITE],
  // Technicians: devices in their coverage, installing and swapping them, their issues.
  technician: [
    P.DEVICE_READ, P.DEVICE_WRITE, P.CATALOG_READ, P.WARRANTY_READ,
    P.TRANSFER_READ, P.TRANSFER_RECEIVE,
    P.ISSUE_READ, P.ISSUE_WRITE, P.REPLACEMENT_WRITE, P.MAINTENANCE_READ,
  ],
};

// Codes that, for a technician, cover only their own records (assigned to
// them, or open in their coverage), like Identity's "own records only".
const TECHNICIAN_OWN_ONLY = new Set([P.ISSUE_READ, P.ISSUE_WRITE]);

export class FixlyActor {
  constructor(user, scope) {
    this.platform = 'fixly';
    this.legacyUserId = user.id;
    this.userId = user.fbosUserId ?? null; // FBOS id when linked; v2 columns hold FBOS ids
    this.role = user.role;
    this.name = user.name;
    this.userType = user.role;
    this.isSuperuser = user.role === 'super_admin';
    this.permissions = new Set(ROLE_PERMISSIONS[user.role] ?? []);
    this.ownRecordsOnly = new Set(user.role === 'technician' ? TECHNICIAN_OWN_ONLY : []);
    this.scope = scope;
    this.technicianId = user.technicianProfile?.id ?? null;
  }

  has(code) {
    return this.permissions.has(code);
  }

  onlyOwn(code) {
    return this.ownRecordsOnly.has(code);
  }

  unitsFor() {
    return null;
  }
}

/** A Fixly token, or null when the bearer token is not one (it may be an FBOS token). */
export async function fixlyActorFromToken(token) {
  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: {
      id: true, name: true, role: true, clientId: true, companyId: true, accountStatus: true, fbosUserId: true,
      technicianProfile: { select: { id: true } },
    },
  });
  if (!user || user.accountStatus === 'removed') throw new InventoryError(401, 'ACCOUNT_INACTIVE', 'Account no longer active');
  if (user.accountStatus === 'suspended') throw new InventoryError(403, 'ACCOUNT_SUSPENDED', 'Account suspended');
  const scope = await resolveScope({
    id: user.id, role: user.role, clientId: user.clientId, companyId: user.companyId, technicianId: user.technicianProfile?.id ?? null,
  });
  return new FixlyActor(user, scope);
}
