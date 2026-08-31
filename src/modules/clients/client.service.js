import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';

export const clientService = {
  async list({ page, limit, search, companyId }) {
    const where = {
      ...(companyId ? { companyId } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };
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

  create(data) {
    return prisma.client.create({ data });
  },

  async update(id, data) {
    await this.getById(id);
    return prisma.client.update({ where: { id }, data });
  },

  async remove(id) {
    await this.getById(id);
    // Refuse to delete while dependents exist — a cascade would wipe zones,
    // devices, issues, and their history.
    const [zones, users] = await Promise.all([
      prisma.zone.count({ where: { clientId: id } }),
      prisma.user.count({ where: { clientId: id } }),
    ]);
    if (zones > 0 || users > 0) {
      throw ApiError.conflict('Cannot delete a client that still has zones or users');
    }
    await prisma.client.delete({ where: { id } });
  },
};
