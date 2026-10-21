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
  constructor({ all = false, siteIds = [], companyIds = [], technicianId = null, ownOnly = false, userId = null }) {
    this.all = all;
    this.siteIds = siteIds;
    this.companyIds = companyIds;
    this.technicianId = technicianId;
    this.ownOnly = ownOnly;
    this.userId = userId;
  }

  get none() {
    return !this.all && this.siteIds.length === 0 && this.companyIds.length === 0;
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
        { companyId: { in: this.companyIds } },
        { ownerCompanyId: { in: this.companyIds } },
      ],
    };
  }

  /** Prisma `where` for sites (clients). */
  siteWhere() {
    if (this.all) return orgFilter();
    return { ...orgFilter(), OR: [{ id: { in: this.siteIds } }, { companyId: { in: this.companyIds } }] };
  }

  /** Prisma `where` for customers (companies). */
  customerWhere() {
    if (this.all) return orgFilter();
    return { ...orgFilter(), OR: [{ id: { in: this.companyIds } }, { clients: { some: { id: { in: this.siteIds } } } }] };
  }

  /** Prisma `where` for stock locations: their own stores; operator places only for `all`. */
  locationWhere() {
    if (this.all) return orgFilter();
    return {
      ...orgFilter(),
      OR: [{ clientId: { in: this.siteIds } }, { companyId: { in: this.companyIds } }, { client: { companyId: { in: this.companyIds } } }],
    };
  }

  /** Can the caller see records held by this customer / site? */
  coversHolder({ companyId, clientId }) {
    if (this.all) return true;
    return (clientId && this.siteIds.includes(clientId)) || (companyId && this.companyIds.includes(companyId));
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
