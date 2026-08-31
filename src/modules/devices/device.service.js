import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { OPEN_ISSUE_STATES } from '../../utils/issueStateMachine.js';
import { zoneService } from '../zones/zone.service.js';
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
};

export const deviceService = {
  async list({ page, limit, zoneId, includeSubzones, status, search }, scope) {
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
    // Flatten zoneName alongside the nested zone, per the frontend contract.
    const items = rows.map((d) => ({ ...d, zoneName: d.zone?.name ?? null }));
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
