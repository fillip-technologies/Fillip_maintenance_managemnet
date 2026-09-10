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

    // Technician count scoped to the requested client/zone — technicians have
    // clientId=null on their user row, so the /users list never includes them.
    // Query technician_assignments directly to get the real assigned count.
    const technicianAssignmentWhere =
      query.scope === 'client' && query.id ? { clientId: query.id }
      : query.scope === 'zone'   && query.id ? { zoneId:   query.id }
      : undefined; // platform scope → count all

    const [totalDevices, workingDevices, underMaintenance, faultyDevices, provisionedDevices, devicesMissingTodayLog, openIssues, onHoldIssues, assignedTechnicians] = await Promise.all([
      prisma.device.count({ where: { ...where, status: { not: 'retired' } } }),
      prisma.device.count({ where: { ...where, status: 'active' } }),
      prisma.device.count({ where: { ...where, status: 'under_maintenance' } }),
      prisma.device.count({ where: { ...where, status: 'faulty' } }),
      prisma.device.count({ where: { ...where, status: 'provisioned' } }),
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
      prisma.issue.count({
        where: { device: where, status: 'on_hold' },
      }),
      technicianAssignmentWhere !== undefined
        ? prisma.technicianAssignment.count({ where: technicianAssignmentWhere })
        : prisma.technician.count(),
    ]);

    return { openIssues, onHoldIssues, workingDevices, faultyDevices, underMaintenance, provisionedDevices, devicesMissingTodayLog, totalDevices, assignedTechnicians };
  },

  /**
   * Per-zone device health for a scope. Returns one row per zone that actually
   * holds devices, with a status breakdown — the real data behind the client
   * overview's zone distribution (which previously used fabricated values).
   *
   * Scope is enforced exactly like `summary` via `deviceScope`. A single
   * groupBy over (zoneId, status) keeps it O(rows), no N+1. `retired` devices
   * are excluded from the working set (mirrors the summary/overview counts).
   */
  async zoneBreakdown(query, authScope) {
    const where = await deviceScope(query, authScope);
    const categoryFilter = query.categoryId ? { categoryId: query.categoryId } : {};

    const groups = await prisma.device.groupBy({
      by: ['zoneId', 'status'],
      where: { ...where, ...categoryFilter, status: { not: 'retired' } },
      _count: { _all: true },
    });

    // Resolve names only for the zones that actually appeared.
    const zoneIds = [...new Set(groups.map((g) => g.zoneId))];
    const zones = zoneIds.length
      ? await prisma.zone.findMany({ where: { id: { in: zoneIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(zones.map((z) => [z.id, z.name]));
    const byZone = new Map();
    for (const row of groups) {
      if (!byZone.has(row.zoneId)) {
        byZone.set(row.zoneId, {
          zoneId: row.zoneId,
          zoneName: nameById.get(row.zoneId) ?? 'Unknown',
          total: 0,
          working: 0,
          faulty: 0,
          underMaintenance: 0,
        });
      }
      const bucket = byZone.get(row.zoneId);
      const n = row._count._all;
      bucket.total += n;
      if (row.status === 'active') bucket.working += n;
      else if (row.status === 'faulty') bucket.faulty += n;
      else if (row.status === 'under_maintenance') bucket.underMaintenance += n;
    }

    return { zones: [...byZone.values()].sort((a, b) => b.total - a.total) };
  },

  /**
   * Per-product-category device health for a scope. Returns one row per category
   * with total / working / notWorking counts — the data behind the product-first
   * zone section view in the client-admin app.
   */
  async productBreakdown(query, authScope) {
    const where = await deviceScope(query, authScope);
    const notRetired = { ...where, status: { not: 'retired' } };

    const [catGroups, nameGroups] = await Promise.all([
      prisma.device.groupBy({
        by: ['categoryId', 'status'],
        where: notRetired,
        _count: { _all: true },
      }),
      prisma.device.groupBy({
        by: ['name', 'status'],
        where: notRetired,
        _count: { _all: true },
      }),
    ]);

    // ── Category-level buckets ──────────────────────────────────────────────
    const categoryIds = [...new Set(catGroups.map((g) => g.categoryId).filter(Boolean))];
    const categoryRecords = categoryIds.length
      ? await prisma.productCategory.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true, code: true, imageUrl: true },
        })
      : [];
    const catById = new Map(categoryRecords.map((c) => [c.id, c]));

    const byCat = new Map();
    for (const row of catGroups) {
      const key = row.categoryId ?? 'unassigned';
      if (!byCat.has(key)) {
        const cat = catById.get(row.categoryId);
        byCat.set(key, {
          categoryId: row.categoryId ?? null,
          name: cat?.name ?? 'Uncategorized',
          code: cat?.code ?? '',
          imageUrl: cat?.imageUrl ?? null,
          total: 0, working: 0, faulty: 0, underMaintenance: 0,
        });
      }
      const bucket = byCat.get(key);
      const n = row._count._all;
      bucket.total += n;
      if (row.status === 'active')                 bucket.working          += n;
      else if (row.status === 'faulty')            bucket.faulty           += n;
      else if (row.status === 'under_maintenance') bucket.underMaintenance += n;
    }

    // ── Product-name-level buckets (across all categories) ─────────────────
    const byName = new Map();
    for (const row of nameGroups) {
      const key = row.name ?? 'Unknown';
      if (!byName.has(key)) {
        byName.set(key, { name: key, total: 0, working: 0, faulty: 0, underMaintenance: 0 });
      }
      const bucket = byName.get(key);
      const n = row._count._all;
      bucket.total += n;
      if (row.status === 'active')                 bucket.working          += n;
      else if (row.status === 'faulty')            bucket.faulty           += n;
      else if (row.status === 'under_maintenance') bucket.underMaintenance += n;
    }

    // Enrich product-name buckets with imageUrl from ProductType (if a matching type exists).
    const productTypeRecords = await prisma.productType.findMany({
      where: { name: { in: [...byName.keys()] } },
      select: { name: true, imageUrl: true },
    });
    const ptImageByName = new Map(productTypeRecords.map((p) => [p.name, p.imageUrl]));
    for (const bucket of byName.values()) {
      bucket.imageUrl = ptImageByName.get(bucket.name) ?? null;
    }

    return {
      categories: [...byCat.values()].sort((a, b) => b.total - a.total),
      products:   [...byName.values()].sort((a, b) => b.total - a.total),
    };
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
      // Super admin is a platform operator, not a managed tenant user — exclude it.
      prisma.user.count({ where: { accountStatus: { not: 'removed' }, role: { not: 'super_admin' } } }),
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
          facilityName: true,
          location: true,
          imageUrl: true,
          latitude: true,
          longitude: true,
          mapX: true,
          mapY: true,
          pinColor: true,
          company: { select: { name: true } },
          _count: { select: { zones: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.device.findMany({
        where: { status: { not: 'retired' } },
        select: { status: true, hardwareTypeId: true, categoryId: true, zone: { select: { clientId: true } } },
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
    const deviceStats = new Map(); // clientId -> { devices, working, faulty, underMaintenance, byHardwareType: {} }
    for (const d of deviceClientRows) {
      const cid = d.zone?.clientId;
      if (!cid) continue;
      const cur = deviceStats.get(cid) ?? { devices: 0, working: 0, faulty: 0, underMaintenance: 0, byHardwareType: {} };
      cur.devices += 1;
      if (d.status === 'active') cur.working += 1;
      else if (d.status === 'faulty') cur.faulty += 1;
      else if (d.status === 'under_maintenance') cur.underMaintenance += 1;

      if (d.hardwareTypeId) {
        cur.byHardwareType[d.hardwareTypeId] = (cur.byHardwareType[d.hardwareTypeId] ?? 0) + 1;
      }
      deviceStats.set(cid, cur);
    }
    const openByClient = new Map();
    for (const row of openIssueClientRows) {
      const cid = row.device?.zone?.clientId;
      if (!cid) continue;
      openByClient.set(cid, (openByClient.get(cid) ?? 0) + 1);
    }

    const defaultPins = [
      { x: 28, y: 62 },
      { x: 58, y: 53 },
      { x: 36, y: 48 },
      { x: 24, y: 30 },
      { x: 53, y: 70 },
      { x: 45, y: 40 },
      { x: 70, y: 65 },
      { x: 65, y: 35 },
    ];

    const facilities = clientRows
      .map((c, index) => {
        const ds = deviceStats.get(c.id) ?? { devices: 0, working: 0, faulty: 0, underMaintenance: 0, byHardwareType: {} };
        const openIssues = openByClient.get(c.id) ?? 0;
        const operationalStatus =
          ds.faulty > 0 ? 'Partial Issues'
          : ds.underMaintenance > 0 ? 'Under Maintenance'
          : 'Operational';

        const fallbackPin = defaultPins[index % defaultPins.length];

        return {
          clientId: c.id,
          name: c.name,
          facilityName: c.facilityName || c.name,
          location: c.location || null,
          imageUrl: c.imageUrl || null,
          latitude: c.latitude ? Number(c.latitude) : null,
          longitude: c.longitude ? Number(c.longitude) : null,
          mapX: c.mapX ?? fallbackPin.x,
          mapY: c.mapY ?? fallbackPin.y,
          pinColor: c.pinColor || null,
          companyName: c.company?.name ?? null,
          zones: c._count.zones,
          devices: ds.devices,
          workingDevices: ds.working,
          faultyDevices: ds.faulty,
          underMaintenanceDevices: ds.underMaintenance,
          byHardwareType: ds.byHardwareType,
          openIssues,
          operationalStatus,
        };
      })
      .sort((a, b) => b.devices - a.devices);

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
