import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { assertIssueTransition } from '../../utils/issueStateMachine.js';
import { refreshMaintenanceStatus } from '../devices/device.service.js';
import { zoneService } from '../zones/zone.service.js';
import { emitIssueEvent, DOMAIN_EVENT } from '../../realtime/events.js';
import { issueScopeWhere, combine, deviceInScope, assertInScope } from '../../authz/scope.js';

// Multi-step writes make several sequential round trips; give them headroom
// beyond Prisma's 5s default so remote-DB latency doesn't expire the tx.
const TX_OPTS = { maxWait: 10_000, timeout: 20_000 };

const detail = {
  device: { select: { id: true, name: true, zoneId: true, hardwareTypeId: true } },
  category: { select: { id: true, name: true } },
  raisedBy: { select: { id: true, name: true, email: true } },
  assignedTechnician: {
    select: { id: true, specialization: true, user: { select: { id: true, name: true } } },
  },
};

export const issueService = {
  async list(query, user, scope) {
    const { page, limit, deviceId, zoneId, includeSubzones, status, priority, assignedTechnicianId } =
      query;

    const filters = {
      ...(deviceId ? { deviceId } : {}),
      ...(priority ? { priority } : {}),
      ...(status ? { status: { in: status.split(',').map((s) => s.trim()) } } : {}),
    };

    // Opt-in narrowing filters that lean on the authenticated user.
    if (query.raisedByMe === 'true') {
      if (!user) throw ApiError.unauthorized();
      filters.raisedByUserId = user.id;
    }
    if (query.scope === 'technician') {
      const technicianId = user?.technicianId;
      if (!technicianId) throw ApiError.forbidden('Not a technician');
      filters.assignedTechnicianId = technicianId;
    } else if (assignedTechnicianId) {
      filters.assignedTechnicianId = assignedTechnicianId;
    }

    // Zone (optionally subtree) filter via the device's zone.
    if (zoneId) {
      const zoneIds =
        includeSubzones === 'true' ? await zoneService.subtreeIds(zoneId) : [zoneId];
      filters.device = { zoneId: { in: zoneIds } };
    }

    // AND the caller's authorization scope on top of any opt-in filters.
    const where = combine(issueScopeWhere(scope), filters);
    const total = await prisma.issue.count({ where });
    const { skip, take, meta } = paginate({ page, limit }, total);
    const items = await prisma.issue.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
      include: detail,
    });
    return { items, meta };
  },

  // Scoped fetch — 404 if the issue is outside the caller's scope.
  async getById(id, scope) {
    const issue = await prisma.issue.findFirst({
      where: combine(issueScopeWhere(scope), { id }),
      include: {
        ...detail,
        statusHistory: {
          orderBy: { changedAt: 'asc' },
          include: { changedBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!issue) throw ApiError.notFound('Issue not found');
    return issue;
  },

  async create({ deviceId, categoryId, raisedByUserId, priority, description }, user, scope) {
    const raiserId = user?.id ?? raisedByUserId;
    if (!raiserId) throw ApiError.badRequest('Raiser could not be determined');

    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: { zone: { select: { clientId: true } } },
    });
    if (!device) throw ApiError.badRequest('Device does not exist');
    // In-stock units (no zone) belong to a company, not a zone — a unit must be
    // deployed before defects are raised against it in the field.
    assertInScope(
      device.zoneId
        ? deviceInScope(scope, { zoneId: device.zoneId, clientId: device.zone?.clientId })
        : (scope.platform || scope.companyIds?.includes(device.companyId)),
      'Cannot raise a defect on a unit outside your scope'
    );
    if (device.status === 'retired') throw ApiError.badRequest('Cannot raise a defect on a retired unit');

    const category = await prisma.issueCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw ApiError.badRequest('Defect category does not exist');
    // A defect category either applies globally (categoryId null) or is scoped to
    // the unit's product category.
    if (category.categoryId && category.categoryId !== device.categoryId) {
      throw ApiError.badRequest('This defect category does not apply to this unit');
    }

    const issue = await prisma.$transaction(async (tx) => {
      const created = await tx.issue.create({
        data: { deviceId, categoryId, raisedByUserId: raiserId, priority, description, status: 'open' },
        include: detail,
      });
      await tx.issueStatusHistory.create({
        data: { issueId: created.id, fromStatus: null, toStatus: 'open', changedByUserId: raiserId },
      });
      // Raising an issue puts the device under maintenance (section 3.2).
      await refreshMaintenanceStatus(tx, deviceId);
      return created;
    }, TX_OPTS);
    emitIssueEvent(DOMAIN_EVENT.ISSUE_CREATED, issue);
    return issue;
  },

  async updateDetails(id, data, scope) {
    await this.getById(id, scope);
    return prisma.issue.update({ where: { id }, data, include: detail });
  },

  /** Assign (or reassign) a technician — moves open/reopened → assigned. */
  async assign(id, { technicianId, notes, changedByUserId }, user, scope) {
    return this.transition(id, { toStatus: 'assigned', assignedTechnicianId: technicianId, notes, changedByUserId }, user, scope);
  },

  async transition(id, { toStatus, assignedTechnicianId, notes, changedByUserId }, user, scope) {
    const changerId = user?.id ?? changedByUserId;
    if (!changerId) throw ApiError.badRequest('Changer could not be determined');

    // Scoped load — a caller can only drive the state machine of an issue they
    // can see (404, not 403, so ids don't leak across tenants).
    const issue = await prisma.issue.findFirst({ where: combine(issueScopeWhere(scope), { id }) });
    if (!issue) throw ApiError.notFound('Issue not found');

    if (!isTransitionAllowed(issue.status, toStatus)) {
      throw ApiError.badRequest(
        `Cannot move from '${issue.status}' to '${toStatus}' directly`,
        undefined,
        'INVALID_TRANSITION'
      );
    }

    const data = { status: toStatus };

    if (toStatus === 'assigned') {
      const technicianId = assignedTechnicianId ?? issue.assignedTechnicianId;
      if (!technicianId) throw ApiError.badRequest('A technician must be assigned');
      const tech = await prisma.technician.findUnique({ where: { id: technicianId } });
      if (!tech) throw ApiError.badRequest('Technician does not exist');
      data.assignedTechnicianId = technicianId;
    } else if (assignedTechnicianId) {
      data.assignedTechnicianId = assignedTechnicianId;
    }

    if (toStatus === 'resolved') data.resolvedAt = new Date();
    if (toStatus === 'closed') data.closedAt = new Date();
    if (toStatus === 'reopened') {
      data.resolvedAt = null;
      data.closedAt = null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.issue.update({ where: { id }, data, include: detail });
      await tx.issueStatusHistory.create({
        data: { issueId: id, fromStatus: issue.status, toStatus, changedByUserId: changerId, notes: notes ?? null },
      });
      await refreshMaintenanceStatus(tx, issue.deviceId);
      return result;
    }, TX_OPTS);
    emitIssueEvent(DOMAIN_EVENT.ISSUE_UPDATED, updated);
    return updated;
  },

  async history(id, scope) {
    await this.getById(id, scope);
    return prisma.issueStatusHistory.findMany({
      where: { issueId: id },
      orderBy: { changedAt: 'asc' },
      include: { changedBy: { select: { id: true, name: true } } },
    });
  },
};

// Local helper mirroring assertIssueTransition but returning a boolean so the
// service can attach the contract's INVALID_TRANSITION code + message.
function isTransitionAllowed(from, to) {
  try {
    assertIssueTransition(from, to);
    return true;
  } catch {
    return false;
  }
}
