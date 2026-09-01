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
    // Refuse to delete while dependents exist — a cascade would wipe clients,
    // zones, devices, issues, and their history. (Users attach to a client, not
    // a company directly, so the client guard already covers them.)
    const clients = await prisma.client.count({ where: { companyId: id } });
    if (clients > 0) {
      throw ApiError.conflict('Cannot delete a company that still has clients');
    }
    await prisma.company.delete({ where: { id } });
  },
};
