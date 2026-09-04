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
      // Validate the caller is a technician — the issueScopeWhere already scopes
      // the results to their coverage (open issues) + their assigned issues.
      // Do NOT add an extra assignedTechnicianId filter here: that would hide the
      // open, unassigned issues a technician should be able to pick up.
      if (!user?.technicianId) throw ApiError.forbidden('Not a technician');
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

  async remove(id, scope) {
    const issue = await prisma.issue.findFirst({
      where: combine(issueScopeWhere(scope), { id }),
    });
    if (!issue) throw ApiError.notFound('Issue not found');
    await prisma.issue.delete({ where: { id } });
    return issue;
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
    assertInScope(
      device.zoneId
        ? deviceInScope(scope, { zoneId: device.zoneId, clientId: device.zone?.clientId })
        : (scope.platform || scope.companyIds?.includes(device.companyId)),
      'Cannot raise a defect on a unit outside your scope'
    );
    if (device.status === 'retired') throw ApiError.badRequest('Cannot raise a defect on a retired unit');

    const category = await prisma.issueCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw ApiError.badRequest('Defect category does not exist');
    if (category.categoryId && category.categoryId !== device.categoryId) {
      throw ApiError.badRequest('This defect category does not apply to this unit');
    }

    // Issue is always created as `open` — visible to all org members and every
    // technician with coverage for this zone/org. No auto-assignment: technicians
    // pick it up themselves by transitioning to in_progress.
    const issue = await prisma.$transaction(async (tx) => {
      const created = await tx.issue.create({
        data: { deviceId, categoryId, raisedByUserId: raiserId, priority, description, status: 'open' },
        include: detail,
      });
      await tx.issueStatusHistory.create({
        data: { issueId: created.id, fromStatus: null, toStatus: 'open', changedByUserId: raiserId },
      });
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

  async transition(id, { toStatus, notes, changedByUserId }, user, scope) {
    const changerId = user?.id ?? changedByUserId;
    if (!changerId) throw ApiError.badRequest('Changer could not be determined');

    // Scoped load — a caller can only drive the state machine of an issue they
    // can see (404, not 403, so ids don't leak across tenants).
    const issue = await prisma.issue.findFirst({ where: combine(issueScopeWhere(scope), { id }) });
    if (!issue) throw ApiError.notFound('Issue not found');

    // Block no-op transitions — they'd create a spurious history row.
    if (issue.status === toStatus) {
      throw ApiError.badRequest(
        `Issue is already '${toStatus}'`,
        undefined,
        'INVALID_TRANSITION'
      );
    }

    if (!isTransitionAllowed(issue.status, toStatus)) {
      throw ApiError.badRequest(
        `Cannot move from '${issue.status}' to '${toStatus}'`,
        undefined,
        'INVALID_TRANSITION'
      );
    }

    const data = { status: toStatus };

    // When a technician picks up an open issue (open/assigned → in_progress),
    // record them as the assignee. No separate "assign" step needed.
    if (toStatus === 'in_progress' && user?.technicianId) {
      data.assignedTechnicianId = user.technicianId;
    }

    if (toStatus === 'resolved') data.resolvedAt = new Date();
    if (toStatus === 'closed') data.closedAt = new Date();
    // Any transition that moves away from resolved/closed clears those timestamps.
    if (['open', 'assigned', 'in_progress', 'on_hold', 'reopened'].includes(toStatus)) {
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

  async createBulk({ deviceIds, categoryId, raisedByUserId, priority, description }, user, scope) {
    const raiserId = user?.id ?? raisedByUserId;
    if (!raiserId) throw ApiError.badRequest('Raiser could not be determined');

    // Validate category once — same rules as single create.
    const category = await prisma.issueCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw ApiError.badRequest('Defect category does not exist');

    // Validate every device up front before touching the DB.
    const devices = await prisma.device.findMany({
      where: { id: { in: deviceIds } },
      include: { zone: { select: { clientId: true } } },
    });

    const deviceMap = new Map(devices.map((d) => [d.id, d]));
    for (const id of deviceIds) {
      const device = deviceMap.get(id);
      if (!device) throw ApiError.badRequest(`Device ${id} does not exist`);
      assertInScope(
        device.zoneId
          ? deviceInScope(scope, { zoneId: device.zoneId, clientId: device.zone?.clientId })
          : (scope.platform || scope.companyIds?.includes(device.companyId)),
        'Cannot raise a defect on a unit outside your scope'
      );
      if (device.status === 'retired') throw ApiError.badRequest(`Cannot raise a defect on a retired unit (${id})`);
      if (category.categoryId && category.categoryId !== device.categoryId) {
        throw ApiError.badRequest(`Defect category does not apply to unit ${id}`);
      }
    }

    const issues = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const deviceId of deviceIds) {
        const issue = await tx.issue.create({
          data: { deviceId, categoryId, raisedByUserId: raiserId, priority, description, status: 'open' },
          include: detail,
        });
        await tx.issueStatusHistory.create({
          data: { issueId: issue.id, fromStatus: null, toStatus: 'open', changedByUserId: raiserId },
        });
        await refreshMaintenanceStatus(tx, deviceId);
        created.push(issue);
      }
      return created;
    }, TX_OPTS);

    for (const issue of issues) {
      emitIssueEvent(DOMAIN_EVENT.ISSUE_CREATED, issue);
    }
    return issues;
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
