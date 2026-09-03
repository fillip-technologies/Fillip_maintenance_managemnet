import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { clientScopeWhere, combine } from '../../authz/scope.js';

export const clientService = {
  async list({ page, limit, search, companyId }, scope) {
    const filters = {
      ...(companyId ? { companyId } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };
    const where = combine(clientScopeWhere(scope), filters);
    const total = await prisma.client.count({ where });
    const { skip, take, meta } = paginate({ page, limit }, total);
    const items = await prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    return { items, meta };
  },

  async getById(id) {
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) throw ApiError.notFound('Client not found');
    return client;
  },

  async create({ companyName, ...clientData }) {
    const company = await prisma.company.create({ data: { name: companyName, status: 'active' } });
    return prisma.client.create({ data: { ...clientData, name: companyName, companyId: company.id } });
  },

  async update(id, data) {
    await this.getById(id);
    return prisma.client.update({ where: { id }, data });
  },

  async remove(id) {
    const client = await this.getById(id);

    // 1. Delete all devices in this client's zones (cascades issues + daily logs)
    const zones = await prisma.zone.findMany({ where: { clientId: id }, select: { id: true } });
    const zoneIds = zones.map((z) => z.id);
    if (zoneIds.length) {
      await prisma.device.deleteMany({ where: { zoneId: { in: zoneIds } } });
    }
    // Also wipe any company-owned stock devices not yet deployed to a zone
    if (client.companyId) {
      await prisma.device.deleteMany({ where: { companyId: client.companyId, zoneId: null } });
    }

    // 2. Delete all users belonging to this client
    await prisma.user.deleteMany({ where: { clientId: id } });

    // 3. Delete the company — cascades: client → zones → zone_assignments → technician_assignments
    if (client.companyId) {
      await prisma.company.delete({ where: { id: client.companyId } });
    } else {
      await prisma.client.delete({ where: { id } });
    }
  },
};
