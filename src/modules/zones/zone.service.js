import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { zoneScopeWhere, combine, clientInScope, assertInScope } from '../../authz/scope.js';

/** Zone lifecycle transitions (section 3.1). */
const ZONE_TRANSITIONS = {
  draft: ['active'],
  active: ['inactive'],
  inactive: ['active'],
};

export const zoneService = {
  async list({ page, limit, clientId, parentZoneId, topLevel, status, search }, scope) {
    const filters = {
      ...(clientId ? { clientId } : {}),
      ...(status ? { status } : {}),
      ...(parentZoneId ? { parentZoneId } : {}),
      ...(topLevel === 'true' ? { parentZoneId: null } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };
    const where = combine(zoneScopeWhere(scope), filters);
    const total = await prisma.zone.count({ where });
    const { skip, take, meta } = paginate({ page, limit }, total);
    const items = await prisma.zone.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { _count: { select: { children: true, devices: true } } },
    });
    return { items, meta };
  },

  // Raw fetch (no scope) — for internal callers like auth login.
  async getById(id) {
    const zone = await prisma.zone.findUnique({
      where: { id },
      include: {
        children: { select: { id: true, name: true, status: true } },
        assignments: {
          where: { unassignedAt: null },
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        },
        _count: { select: { devices: true } },
      },
    });
    if (!zone) throw ApiError.notFound('Zone not found');
    return zone;
  },

  // Scoped fetch for endpoints — 404 if outside the caller's scope.
  async getByIdInScope(id, scope) {
    const zone = await prisma.zone.findFirst({
      where: combine(zoneScopeWhere(scope), { id }),
      include: {
        children: { select: { id: true, name: true, status: true } },
        assignments: {
          where: { unassignedAt: null },
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        },
        _count: { select: { devices: true } },
      },
    });
    if (!zone) throw ApiError.notFound('Zone not found');
    return zone;
  },

  /** Full subtree of a zone (including itself), depth-annotated. Reused by the
   * login payload (no scope) and the `/descendants` endpoint (scoped). */
  async descendants(rootId, scope) {
    if (scope) await this.getByIdInScope(rootId, scope);
    else await this.getById(rootId);
    return prisma.$queryRaw`
      WITH RECURSIVE tree AS (
        SELECT id, name, parent_zone_id, status, 0 AS depth
        FROM zones WHERE id = ${rootId}::uuid
        UNION ALL
        SELECT z.id, z.name, z.parent_zone_id, z.status, t.depth + 1
        FROM zones z JOIN tree t ON z.parent_zone_id = t.id
      )
      SELECT id, name, parent_zone_id AS "parentZoneId", status, depth
      FROM tree ORDER BY depth, name;
    `;
  },

  /** Path from a zone up to its root (including itself), for breadcrumbs. */
  async ancestors(zoneId) {
    return prisma.$queryRaw`
      WITH RECURSIVE up AS (
        SELECT id, name, parent_zone_id, 0 AS depth
        FROM zones WHERE id = ${zoneId}::uuid
        UNION ALL
        SELECT z.id, z.name, z.parent_zone_id, u.depth + 1
        FROM zones z JOIN up u ON z.id = u.parent_zone_id
      )
      SELECT id, name, depth FROM up ORDER BY depth DESC;
    `;
  },

  /** Array of zone ids in a subtree — powers `includeSubzones` filters. */
  async subtreeIds(rootId) {
    const rows = await prisma.$queryRaw`
      WITH RECURSIVE tree AS (
        SELECT id FROM zones WHERE id = ${rootId}::uuid
        UNION ALL
        SELECT z.id FROM zones z JOIN tree t ON z.parent_zone_id = t.id
      )
      SELECT id FROM tree;
    `;
    return rows.map((r) => r.id);
  },

  async create({ parentZoneId, clientId, createdById, ...rest }, user, scope) {
    const creatorId = user?.id ?? createdById;
    if (!creatorId) throw ApiError.badRequest('Creator could not be determined');
    assertInScope(clientInScope(scope, clientId), 'Cannot create a zone for a client outside your scope');
    // A sub-zone must belong to the same client as its parent.
    if (parentZoneId) {
      const parent = await prisma.zone.findUnique({ where: { id: parentZoneId } });
      if (!parent) throw ApiError.badRequest('Parent zone does not exist');
      if (parent.clientId !== clientId) {
        throw ApiError.badRequest('Parent zone belongs to a different client');
      }
    }
    return prisma.zone.create({ data: { clientId, parentZoneId, createdById: creatorId, ...rest } });
  },

  async update(id, data, scope) {
    const zone = await this.getByIdInScope(id, scope);
    if (data.parentZoneId) {
      if (data.parentZoneId === id) throw ApiError.badRequest('A zone cannot be its own parent');
      const parent = await prisma.zone.findUnique({ where: { id: data.parentZoneId } });
      if (!parent) throw ApiError.badRequest('Parent zone does not exist');
      if (parent.clientId !== zone.clientId) {
        throw ApiError.badRequest('Parent zone belongs to a different client');
      }
    }
    return prisma.zone.update({ where: { id }, data });
  },

  async setStatus(id, toStatus, scope) {
    const zone = await prisma.zone.findFirst({ where: combine(zoneScopeWhere(scope), { id }) });
    if (!zone) throw ApiError.notFound('Zone not found');
    const allowed = ZONE_TRANSITIONS[zone.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw ApiError.badRequest(`Illegal zone transition: ${zone.status} → ${toStatus}`);
    }
    return prisma.zone.update({ where: { id }, data: { status: toStatus } });
  },

  // --- Assignments ---

  async assign(zoneId, { userId, role }, scope) {
    const zone = await prisma.zone.findFirst({ where: combine(zoneScopeWhere(scope), { id: zoneId }) });
    if (!zone) throw ApiError.notFound('Zone not found');

    const existing = await prisma.zoneAssignment.findFirst({
      where: { zoneId, userId, role, unassignedAt: null },
    });
    if (existing) {
      throw ApiError.conflict(
        `This user already has an active ${role} assignment in this zone`,
        undefined,
        'DUPLICATE_ASSIGNMENT'
      );
    }

    // Assigning an incharge activates a draft zone (spec §3.1).
    return prisma.$transaction(async (tx) => {
      await tx.zoneAssignment.create({ data: { zoneId, userId, role } });
      if (role === 'incharge' && zone.status === 'draft') {
        await tx.zone.update({ where: { id: zoneId }, data: { status: 'active' } });
      }
      // Return the refreshed zone (status + active assignments) for the client.
      return tx.zone.findUnique({
        where: { id: zoneId },
        include: {
          assignments: {
            where: { unassignedAt: null },
            include: { user: { select: { id: true, name: true, email: true, role: true } } },
          },
        },
      });
    });
  },

  async unassign(zoneId, assignmentId) {
    const assignment = await prisma.zoneAssignment.findFirst({
      where: { id: assignmentId, zoneId, unassignedAt: null },
    });
    if (!assignment) throw ApiError.notFound('Active assignment not found');
    return prisma.zoneAssignment.update({
      where: { id: assignmentId },
      data: { unassignedAt: new Date() },
    });
  },

  async listAssignments(zoneId) {
    await this.getById(zoneId);
    return prisma.zoneAssignment.findMany({
      where: { zoneId, unassignedAt: null },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
  },
};
