import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';

export const companyService = {
  async list({ page, limit, search }) {
    const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};
    const total = await prisma.company.count({ where });
    const { skip, take, meta } = paginate({ page, limit }, total);
    const items = await prisma.company.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    return { items, meta };
  },

  async getById(id) {
    const company = await prisma.company.findUnique({ where: { id } });
    if (!company) throw ApiError.notFound('Company not found');
    return company;
  },

  create(data) {
    return prisma.company.create({ data });
  },

  async update(id, data) {
    await this.getById(id);
    return prisma.company.update({ where: { id }, data });
  },

  async remove(id) {
    await this.getById(id);

    // Delete all clients under this org (and their cascades: zones,
    // zone_assignments, client_verticals, technician_assignments).
    // Users are SetNull by schema so we delete them explicitly first.
    const clients = await prisma.client.findMany({
      where: { companyId: id },
      select: { id: true },
    });
    for (const client of clients) {
      await prisma.user.deleteMany({ where: { clientId: client.id } });
      await prisma.client.delete({ where: { id: client.id } });
    }

    await prisma.company.delete({ where: { id } });
  },
};
