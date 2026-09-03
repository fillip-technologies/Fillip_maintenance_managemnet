import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { OPEN_ISSUE_STATES } from '../../utils/issueStateMachine.js';
import { zoneService } from '../zones/zone.service.js';
import { reserveCodes } from '../productCategories/productCategory.service.js';
import { deviceScopeWhere, combine, zoneInScope, assertInScope } from '../../authz/scope.js';

/** Manual device status transitions. `under_maintenance` and `faulty` are set
 * automatically by the issue / daily-log flows, not through this endpoint. */
const DEVICE_MANUAL_TRANSITIONS = {
  provisioned: ['active', 'retired'],
  active: ['retired'],
  under_maintenance: ['retired'],
  faulty: ['active', 'retired'],
  retired: [],
};

const withZone = {
  zone: { select: { id: true, name: true, clientId: true } },
  hardwareType: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, code: true } },
  company: { select: { id: true, name: true } },
  addedBy: { select: { id: true, name: true } },
};

/**
 * Resolve the owning company for a new unit.
 *  - client_admin: locked to their own organization (their companyId).
 *  - super_admin: must supply companyId, OR it's derived from the target zone.
 * When a zone is given, the zone's company must match the resolved company.
 */
async function resolveUnitCompany(user, { companyId, zoneClientCompanyId }) {
  if (user?.role === 'client_admin') {
    if (!user.companyId) throw ApiError.forbidden('Your account is not attached to an organization');
    if (companyId && companyId !== user.companyId) {
      throw ApiError.forbidden('You can only add units to your own organization');
    }
    return user.companyId;
  }
  // super_admin (or other privileged callers)
  const resolved = companyId ?? zoneClientCompanyId ?? null;
  if (!resolved) throw ApiError.badRequest('Select an organization (companyId) for the unit', undefined, 'COMPANY_REQUIRED');
  if (zoneClientCompanyId && resolved !== zoneClientCompanyId) {
    throw ApiError.badRequest('Zone belongs to a different organization than the one selected');
  }
  return resolved;
}

export const deviceService = {
  async list({ page, limit, zoneId, includeSubzones, status, search, companyId }, scope) {
    // Optionally widen a zone filter to its whole subtree.
    let zoneFilter;
    if (zoneId && includeSubzones === 'true') {
      zoneFilter = { in: await zoneService.subtreeIds(zoneId) };
    } else if (zoneId) {
      zoneFilter = zoneId;
    }

    const filters = {
      ...(zoneFilter ? { zoneId: zoneFilter } : {}),
      ...(status ? { status } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      // Super-admin org filter: applied on top of the scope (platform scope = no
      // restriction, so companyId is the only filter that narrows the result).
      ...(companyId && scope.platform ? { companyId } : {}),
    };
    const where = combine(deviceScopeWhere(scope), filters);
    const total = await prisma.device.count({ where });
    const { skip, take, meta } = paginate({ page, limit }, total);
    const rows = await prisma.device.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: withZone,
    });
    // Flatten the labels the unit views render, per the frontend contract.
    const items = rows.map((d) => ({
      ...d,
      zoneName: d.zone?.name ?? null,
      categoryName: d.category?.name ?? null,
      companyName: d.company?.name ?? null,
      inStock: d.zoneId === null,
    }));
    return { items, meta };
  },

  // Scoped fetch — returns null if the device is outside the caller's scope,
  // which callers surface as a 404 (don't leak existence across tenants).
  async getById(id, scope) {
    const device = await prisma.device.findFirst({
      where: combine(deviceScopeWhere(scope), { id }),
      include: withZone,
    });
    if (!device) throw ApiError.notFound('Device not found');
    return device;
  },

  async create({ addedById, ...data }, user, scope) {
    const creatorId = user?.id ?? addedById;
    if (!creatorId) throw ApiError.badRequest('Creator could not be determined');
    const zone = await prisma.zone.findUnique({
      where: { id: data.zoneId },
      select: { id: true, clientId: true },
    });
    if (!zone) throw ApiError.badRequest('Zone does not exist');
    assertInScope(zoneInScope(scope, zone), 'Cannot add a device to a zone outside your scope');
    return prisma.device.create({ data: { ...data, addedById: creatorId }, include: withZone });
  },

  /**
   * Create a tracked unit ("Product"): category is REQUIRED, zone is OPTIONAL
   * (no zone → in stock), owning company is set, and a unique code is minted in
   * the same transaction. This is the unified product/device create path.
   */
  async createUnit({ categoryId, companyId, zoneId, ...data }, user, scope) {
    const creatorId = user?.id;
    if (!creatorId) throw ApiError.badRequest('Creator could not be determined');
    if (!categoryId) throw ApiError.badRequest('A category is required', undefined, 'CATEGORY_REQUIRED');

    const category = await prisma.productCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) throw ApiError.badRequest('Category does not exist');

    // If a zone is given, it must exist and be in scope; derive its company.
    let zoneClientCompanyId = null;
    if (zoneId) {
      const zone = await prisma.zone.findUnique({
        where: { id: zoneId },
        select: { id: true, clientId: true, client: { select: { companyId: true } } },
      });
      if (!zone) throw ApiError.badRequest('Zone does not exist');
      assertInScope(zoneInScope(scope, zone), 'Cannot add a unit to a zone outside your scope');
      zoneClientCompanyId = zone.client?.companyId ?? null;
    }

    const resolvedCompanyId = await resolveUnitCompany(user, { companyId, zoneClientCompanyId });

    return prisma.$transaction(async (tx) => {
      const { codes } = await reserveCodes(tx, categoryId, 1);
      return tx.device.create({
        data: {
          ...data,
          code: codes[0],
          categoryId,
          companyId: resolvedCompanyId,
          zoneId: zoneId ?? null,
          addedById: creatorId,
        },
        include: withZone,
      });
    });
  },

  /** Deploy an in-stock unit into a zone (assign zone + activate). */
  async deploy(id, zoneId, user, scope) {
    const device = await this.getById(id, scope);
    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
      select: { id: true, clientId: true, client: { select: { companyId: true } } },
    });
    if (!zone) throw ApiError.badRequest('Zone does not exist');
    assertInScope(zoneInScope(scope, zone), 'Cannot deploy to a zone outside your scope');
    // Keep org integrity: a unit only deploys into a zone of its own company.
    if (device.companyId && zone.client?.companyId && device.companyId !== zone.client.companyId) {
      throw ApiError.badRequest('Zone belongs to a different organization than the unit');
    }
    const status = device.status === 'provisioned' ? 'active' : device.status;
    return prisma.device.update({ where: { id }, data: { zoneId, status }, include: withZone });
  },

  async update(id, data, scope) {
    await this.getById(id, scope);
    return prisma.device.update({ where: { id }, data, include: withZone });
  },

  async setStatus(id, toStatus, scope) {
    const device = await this.getById(id, scope);
    const allowed = DEVICE_MANUAL_TRANSITIONS[device.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw ApiError.badRequest(`Illegal device transition: ${device.status} → ${toStatus}`);
    }
    return prisma.device.update({ where: { id }, data: { status: toStatus }, include: withZone });
  },
};

/**
 * Keeps the denormalized device status in sync with its open issues
 * (section 3.2). Call inside the same transaction that changed an issue.
 * - Retired devices are never touched.
 * - Any open/in-progress issue → `under_maintenance`.
 * - No open issues and currently `under_maintenance` → back to `active`.
 * Does not clear a `faulty` flag raised by daily logs unless an issue closes.
 */
export async function refreshMaintenanceStatus(tx, deviceId) {
  const device = await tx.device.findUnique({ where: { id: deviceId } });
  if (!device || device.status === 'retired') return;

  const openCount = await tx.issue.count({
    where: { deviceId, status: { in: OPEN_ISSUE_STATES } },
  });

  if (openCount > 0 && device.status !== 'under_maintenance') {
    await tx.device.update({ where: { id: deviceId }, data: { status: 'under_maintenance' } });
  } else if (openCount === 0 && (device.status === 'under_maintenance' || device.status === 'faulty')) {
    await tx.device.update({ where: { id: deviceId }, data: { status: 'active' } });
  }
}
