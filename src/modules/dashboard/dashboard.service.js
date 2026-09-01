import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { OPEN_ISSUE_STATES, ISSUE_STATUSES } from '../../utils/issueStateMachine.js';
import { zoneService } from '../zones/zone.service.js';
import { clientInScope, assertInScope } from '../../authz/scope.js';

function todayUtc() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Turn a Prisma groupBy result into a plain { key: count } map. */
function countMap(rows, key) {
  const out = {};
  for (const row of rows) out[row[key]] = row._count._all;
  return out;
}

/**
 * Resolve the device `where` clause for a dashboard scope, enforcing that the
 * caller is actually allowed to aggregate over the requested scope/id.
 */
async function deviceScope({ scope, id, includeSubzones }, authScope) {
  if (scope === 'platform') {
    // Only a platform-wide identity may see global counts.
    assertInScope(authScope.platform, 'platform scope is restricted');
    return {};
  }
  if (scope === 'client') {
    if (!id) throw ApiError.badRequest('client scope requires an id');
    assertInScope(clientInScope(authScope, id), 'Client outside your scope');
    return { zone: { clientId: id } };
  }
  if (scope === 'zone') {
    if (!id) throw ApiError.badRequest('zone scope requires an id');
    // Reuse the scoped zone fetch — 404 if the zone isn't visible to the caller.
    await zoneService.getByIdInScope(id, authScope);
    const zoneIds = includeSubzones === 'true' ? await zoneService.subtreeIds(id) : [id];
    return { zoneId: { in: zoneIds } };
  }
  throw ApiError.badRequest('Unknown scope');
}

export const dashboardService = {
  async summary(query, authScope) {
    const where = await deviceScope(query, authScope);
    const today = todayUtc();

    const [totalDevices, faultyDevices, devicesMissingTodayLog, openIssues] = await Promise.all([
      prisma.device.count({ where: { ...where, status: { not: 'retired' } } }),
      prisma.device.count({ where: { ...where, status: 'faulty' } }),
      prisma.device.count({
        where: {
          ...where,
          status: { not: 'retired' },
          dailyStatusLogs: { none: { logDate: today } },
        },
      }),
      prisma.issue.count({
        where: { device: where, status: { in: OPEN_ISSUE_STATES } },
      }),
    ]);

    return { openIssues, faultyDevices, devicesMissingTodayLog, totalDevices };
  },

  /**
   * Platform-wide super_admin overview. One aggregated call backing the whole
   * super_admin dashboard so the page never fans out into a dozen list reads.
   * Restricted to a platform-scoped identity (super_admin) — no client/zone
   * caller may aggregate the whole platform.
   */
  async overview(authScope) {
    assertInScope(authScope.platform, 'Platform overview is restricted to super_admin');
    const today = todayUtc();

    const [
      companies,
      activeCompanies,
      clientsCount,
      zonesCount,
      activeZones,
      usersCount,
      techniciansCount,
      deviceStatusGroups,
      hardwareTypeStatusGroups,
      hardwareTypes,
      devicesMissingTodayLog,
      issueStatusGroups,
      openPriorityGroups,
      createdToday,
      resolvedToday,
      closedToday,
      criticalAlertsRaw,
      technicianRows,
      openIssuesByTech,
      clientRows,
      deviceClientRows,
      openIssueClientRows,
      recentActivityRaw,
    ] = await Promise.all([
      prisma.company.count(),
      prisma.company.count({ where: { status: 'active' } }),
      prisma.client.count(),
      prisma.zone.count(),
      prisma.zone.count({ where: { status: 'active' } }),
      prisma.user.count({ where: { accountStatus: { not: 'removed' } } }),
      prisma.technician.count(),

      // Device fleet, grouped by status (retired excluded from the working set).
      prisma.device.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.device.groupBy({
        by: ['hardwareTypeId', 'status'],
        where: { status: { not: 'retired' } },
        _count: { _all: true },
      }),
      prisma.hardwareType.findMany({ select: { id: true, name: true } }),
      prisma.device.count({
        where: { status: { not: 'retired' }, dailyStatusLogs: { none: { logDate: today } } },
      }),

      // Issues (work orders).
      prisma.issue.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.issue.groupBy({
        by: ['priority'],
        where: { status: { in: OPEN_ISSUE_STATES } },
        _count: { _all: true },
      }),
      prisma.issue.count({ where: { createdAt: { gte: today } } }),
      prisma.issue.count({ where: { resolvedAt: { gte: today } } }),
      prisma.issue.count({ where: { closedAt: { gte: today } } }),

      // Critical / high open issues — the "alerts" list.
      prisma.issue.findMany({
        where: { status: { in: OPEN_ISSUE_STATES }, priority: { in: ['high', 'critical'] } },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        take: 6,
        select: {
          id: true,
          description: true,
          priority: true,
          status: true,
          createdAt: true,
          device: {
            select: { name: true, zone: { select: { name: true, client: { select: { name: true } } } } },
          },
          assignedTechnician: { select: { user: { select: { name: true } } } },
        },
      }),

      // Technician workload.
      prisma.technician.findMany({
        select: { id: true, specialization: true, user: { select: { name: true } } },
      }),
      prisma.issue.groupBy({
        by: ['assignedTechnicianId'],
        where: { status: { in: OPEN_ISSUE_STATES }, assignedTechnicianId: { not: null } },
        _count: { _all: true },
      }),

      // Per-client facility rollup (reduced in JS — scales with row count, not
      // client count, so no N+1).
      prisma.client.findMany({
        select: {
          id: true,
          name: true,
          company: { select: { name: true } },
          _count: { select: { zones: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.device.findMany({
        where: { status: { not: 'retired' } },
        select: { status: true, zone: { select: { clientId: true } } },
      }),
      prisma.issue.findMany({
        where: { status: { in: OPEN_ISSUE_STATES } },
        select: { device: { select: { zone: { select: { clientId: true } } } } },
      }),

      // Recent activity — the platform-wide issue audit trail.
      prisma.issueStatusHistory.findMany({
        orderBy: { changedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          changedAt: true,
          changedBy: { select: { name: true } },
          issue: {
            select: {
              id: true,
              description: true,
              priority: true,
              device: {
                select: {
                  name: true,
                  zone: { select: { name: true, client: { select: { name: true } } } },
                },
              },
            },
          },
        },
      }),
    ]);

    // ---- Device fleet ----
    const deviceByStatus = countMap(deviceStatusGroups, 'status');
    const devices = {
      total: Object.entries(deviceByStatus)
        .filter(([status]) => status !== 'retired')
        .reduce((sum, [, n]) => sum + n, 0),
      working: deviceByStatus.active ?? 0,
      underMaintenance: deviceByStatus.under_maintenance ?? 0,
      faulty: deviceByStatus.faulty ?? 0,
      provisioned: deviceByStatus.provisioned ?? 0,
      retired: deviceByStatus.retired ?? 0,
      missingTodayLog: devicesMissingTodayLog,
    };

    // ---- Device breakdown per hardware type (the equipment category filter) ----
    const hwNameById = new Map(hardwareTypes.map((h) => [h.id, h.name]));
    const hwAgg = new Map();
    const bumpHw = (id) => {
      const key = id ?? 'unassigned';
      if (!hwAgg.has(key)) {
        hwAgg.set(key, {
          hardwareTypeId: id ?? null,
          name: id ? hwNameById.get(id) ?? 'Unknown' : 'Unassigned',
          total: 0,
          working: 0,
          underMaintenance: 0,
          faulty: 0,
        });
      }
      return hwAgg.get(key);
    };
    for (const row of hardwareTypeStatusGroups) {
      const bucket = bumpHw(row.hardwareTypeId);
      const n = row._count._all;
      bucket.total += n;
      if (row.status === 'active') bucket.working += n;
      else if (row.status === 'under_maintenance') bucket.underMaintenance += n;
      else if (row.status === 'faulty') bucket.faulty += n;
    }
    const byHardwareType = [...hwAgg.values()].sort((a, b) => b.total - a.total);

    // ---- Issues (work orders) ----
    const issueByStatus = countMap(issueStatusGroups, 'status');
    const byStatus = Object.fromEntries(ISSUE_STATUSES.map((s) => [s, issueByStatus[s] ?? 0]));
    const openIssues = OPEN_ISSUE_STATES.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);
    const priorityMap = countMap(openPriorityGroups, 'priority');
    const issues = {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      open: openIssues,
      byStatus,
      byPriority: {
        low: priorityMap.low ?? 0,
        medium: priorityMap.medium ?? 0,
        high: priorityMap.high ?? 0,
        critical: priorityMap.critical ?? 0,
      },
      createdToday,
      resolvedToday,
      closedToday,
    };

    // ---- Critical alerts ----
    const criticalAlerts = criticalAlertsRaw.map((i) => ({
      id: i.id,
      title: i.description,
      priority: i.priority,
      status: i.status,
      deviceName: i.device?.name ?? null,
      zoneName: i.device?.zone?.name ?? null,
      clientName: i.device?.zone?.client?.name ?? null,
      assignedTo: i.assignedTechnician?.user?.name ?? null,
      createdAt: i.createdAt,
    }));

    // ---- Technician workload ----
    const openByTechId = new Map(
      openIssuesByTech.map((r) => [r.assignedTechnicianId, r._count._all])
    );
    const technicianList = technicianRows
      .map((t) => ({
        id: t.id,
        name: t.user?.name ?? 'Unknown',
        specialization: t.specialization ?? null,
        openAssigned: openByTechId.get(t.id) ?? 0,
      }))
      .sort((a, b) => b.openAssigned - a.openAssigned);
    const busy = technicianList.filter((t) => t.openAssigned > 0).length;
    const technicians = {
      total: technicianList.length,
      busy,
      idle: technicianList.length - busy,
      top: technicianList.slice(0, 5),
    };

    // ---- Per-client facilities ----
    const deviceStats = new Map(); // clientId -> { devices, faulty }
    for (const d of deviceClientRows) {
      const cid = d.zone?.clientId;
      if (!cid) continue;
      const cur = deviceStats.get(cid) ?? { devices: 0, faulty: 0 };
      cur.devices += 1;
      if (d.status === 'faulty') cur.faulty += 1;
      deviceStats.set(cid, cur);
    }
    const openByClient = new Map();
    for (const row of openIssueClientRows) {
      const cid = row.device?.zone?.clientId;
      if (!cid) continue;
      openByClient.set(cid, (openByClient.get(cid) ?? 0) + 1);
    }
    const facilities = clientRows
      .map((c) => {
        const ds = deviceStats.get(c.id) ?? { devices: 0, faulty: 0 };
        return {
          clientId: c.id,
          name: c.name,
          companyName: c.company?.name ?? null,
          zones: c._count.zones,
          devices: ds.devices,
          faultyDevices: ds.faulty,
          openIssues: openByClient.get(c.id) ?? 0,
        };
      })
      .sort((a, b) => b.openIssues - a.openIssues);

    // ---- Recent activity ----
    const recentActivity = recentActivityRaw.map((h) => ({
      id: h.id,
      issueId: h.issue?.id ?? null,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      priority: h.issue?.priority ?? null,
      title: h.issue?.description ?? null,
      deviceName: h.issue?.device?.name ?? null,
      zoneName: h.issue?.device?.zone?.name ?? null,
      clientName: h.issue?.device?.zone?.client?.name ?? null,
      changedBy: h.changedBy?.name ?? null,
      changedAt: h.changedAt,
    }));

    return {
      tenancy: {
        companies,
        activeCompanies,
        clients: clientsCount,
        zones: zonesCount,
        activeZones,
        users: usersCount,
        technicians: techniciansCount,
      },
      devices,
      byHardwareType,
      issues,
      criticalAlerts,
      technicians,
      facilities,
      recentActivity,
    };
  },
};
