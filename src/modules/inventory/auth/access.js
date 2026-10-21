import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';

/**
 * Record-level scope on top of the permission (docs/06 §5). Identity says which
 * permission codes the caller holds and, per code, which org units they are
 * limited to (`unit_scopes`) or whether only their own records count
 * (`own_records_only`). Here that becomes which customers and sites they see:
 *
 *   - unscoped grant (operator staff)       → everything in the organization
 *   - grant on a site's unit                → that site (and its zones)
 *   - grant on a customer's unit            → every site of that customer
 *   - own records only (technicians)        → their coverage and assignments
 *   - a `client_user` with an unscoped grant → nothing. Customer staff must be
 *     scoped to their site; an organization-wide grant (e.g. the `member`
 *     preset) would otherwise show them every customer's devices.
 *
 * Records outside the scope are answered as 404 by the routes.
 */
export class Access {
  /**
   * `zoneIds`: zones (with their sub-zones) the caller covers, for Fixly zone officers.
   * `zoneSiteIds`: the sites those zones are in, only for naming sites and zones.
   * `companyStockOnly`: the company grant covers its unallocated stock only, not
   * devices at its other sites (a Fixly client_admin, like the legacy scope).
   */
  constructor({ all = false, siteIds = [], companyIds = [], zoneIds = [], zoneSiteIds = [], companyStockOnly = false, technicianId = null, ownOnly = false, userId = null }) {
    this.all = all;
    this.siteIds = siteIds;
    this.companyIds = companyIds;
    this.zoneIds = zoneIds;
    this.zoneSiteIds = zoneSiteIds;
    this.companyStockOnly = companyStockOnly;
    this.technicianId = technicianId;
    this.ownOnly = ownOnly;
    this.userId = userId;
  }

  get none() {
    return !this.all && this.siteIds.length === 0 && this.companyIds.length === 0 && this.zoneIds.length === 0;
  }

  companyFilter(field) {
    return this.companyStockOnly ? { [field]: { in: this.companyIds }, currentClientId: null, zoneId: null } : { [field]: { in: this.companyIds } };
  }

  /** Prisma `where` for devices the caller may see. */
  deviceWhere() {
    const org = orgFilter();
    if (this.all) return org;
    return {
      ...org,
      OR: [
        { currentClientId: { in: this.siteIds } },
        { zone: { clientId: { in: this.siteIds } } },
        { zoneId: { in: this.zoneIds } },
        this.companyFilter('companyId'),
        this.companyFilter('ownerCompanyId'),
      ],
    };
  }

  /** Prisma `where` for sites (clients). */
  siteWhere() {
    if (this.all) return orgFilter();
    const OR = [{ id: { in: [...this.siteIds, ...this.zoneSiteIds] } }];
    if (!this.companyStockOnly) OR.push({ companyId: { in: this.companyIds } });
    return { ...orgFilter(), OR };
  }

  /** Prisma `where` for customers (companies). */
  customerWhere() {
    if (this.all) return orgFilter();
    return { ...orgFilter(), OR: [{ id: { in: this.companyIds } }, { clients: { some: { id: { in: [...this.siteIds, ...this.zoneSiteIds] } } } }] };
  }

  /** Prisma `where` for stock locations: their own stores; operator places only for `all`. */
  locationWhere() {
    if (this.all) return orgFilter();
    const OR = [{ clientId: { in: this.siteIds } }];
    if (this.companyStockOnly) OR.push({ companyId: { in: this.companyIds }, clientId: null });
    else OR.push({ companyId: { in: this.companyIds } }, { client: { companyId: { in: this.companyIds } } });
    return { ...orgFilter(), OR };
  }

  /** Can the caller see records held by this customer / site? */
  coversHolder({ companyId, clientId }) {
    if (this.all) return true;
    if (clientId && this.siteIds.includes(clientId)) return true;
    if (!companyId || !this.companyIds.includes(companyId)) return false;
    return !this.companyStockOnly || !clientId;
  }
}

const orgFilter = () => (env.FBOS_ORGANIZATION_ID ? { organizationId: env.FBOS_ORGANIZATION_ID } : {});

/** The Fixly technician linked to an FBOS user (users.fbos_user_id), if any. */
export async function technicianFor(fbosUserId) {
  if (!fbosUserId) return null;
  const user = await prisma.user.findUnique({
    where: { fbosUserId },
    select: { technicianProfile: { select: { id: true } } },
  });
  return user?.technicianProfile?.id ?? null;
}

/** Sites and customers a technician covers (technician_assignments). */
async function coverage(technicianId) {
  const rows = await prisma.technicianAssignment.findMany({
    where: { technicianId },
    select: { clientId: true, zone: { select: { clientId: true } } },
  });
  return [...new Set(rows.map((r) => r.clientId ?? r.zone?.clientId).filter(Boolean))];
}

/**
 * The caller's scope for one permission code. Assumes the route guard already
 * checked the code is held; returns an empty scope if it is not.
 */
export async function accessFor(actor, code) {
  if (!actor.has(code)) return new Access({});
  if (actor.platform === 'fixly') return accessFromFixlyScope(actor, code);
  if (actor.isSuperuser) return new Access({ all: true, userId: actor.userId });

  const ownOnly = actor.onlyOwn(code);
  const units = actor.unitsFor(code);

  if (ownOnly) {
    const technicianId = await technicianFor(actor.userId);
    const siteIds = technicianId ? await coverage(technicianId) : [];
    return new Access({ siteIds, technicianId, ownOnly: true, userId: actor.userId });
  }

  if (!units) {
    if (actor.userType === 'client_user') {
      logger.warn({ userId: actor.userId, code }, 'client_user holds an organization-wide inventory grant; showing nothing');
      return new Access({ userId: actor.userId });
    }
    return new Access({ all: true, userId: actor.userId, technicianId: await technicianFor(actor.userId) });
  }

  const unitIds = [...units];
  const [sites, companies] = await Promise.all([
    prisma.client.findMany({ where: { fbosOrgUnitId: { in: unitIds } }, select: { id: true } }),
    prisma.company.findMany({ where: { fbosOrgUnitId: { in: unitIds } }, select: { id: true } }),
  ]);
  return new Access({
    siteIds: sites.map((s) => s.id),
    companyIds: companies.map((c) => c.id),
    userId: actor.userId,
    technicianId: await technicianFor(actor.userId),
  });
}

/** Express helper: resolve the scope for `code` onto req.access. */
export const withAccess = (code) => async (req, _res, next) => {
  try {
    req.access = await accessFor(req.actor, code);
    return next();
  } catch (err) {
    return next(err);
  }
};

/** A Fixly user's zone-path scope (authz/scope.js) as an inventory Access. */
async function accessFromFixlyScope(actor, code) {
  const scope = actor.scope;
  if (scope.platform) return new Access({ all: true, userId: actor.userId, technicianId: actor.technicianId });
  const zoneSiteIds = scope.zoneIds.length
    ? [...new Set((await prisma.zone.findMany({ where: { id: { in: scope.zoneIds } }, select: { clientId: true } })).map((z) => z.clientId))]
    : [];
  return new Access({
    siteIds: scope.clientIds,
    companyIds: scope.companyIds ?? [],
    companyStockOnly: true,
    zoneIds: scope.zoneIds,
    zoneSiteIds,
    technicianId: actor.technicianId,
    ownOnly: actor.onlyOwn(code),
    userId: actor.userId,
  });
}
