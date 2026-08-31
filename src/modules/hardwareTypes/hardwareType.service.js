import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';

export const hardwareTypeService = {
  async list({ page, limit, search }) {
    const where = search ? { name: { contains: search, mode: 'insensitive' } } : {};
    const total = await prisma.hardwareType.count({ where });
    const { skip, take, meta } = paginate({ page, limit }, total);
    const items = await prisma.hardwareType.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take,
    });
    return { items, meta };
  },

  async getById(id) {
    const hw = await prisma.hardwareType.findUnique({
      where: { id },
      include: { issueCategories: true },
    });
    if (!hw) throw ApiError.notFound('Hardware type not found');
    return hw;
  },

  create(data) {
    return prisma.hardwareType.create({ data });
  },

  async update(id, data) {
    await this.getById(id);
    return prisma.hardwareType.update({ where: { id }, data });
  },

  async remove(id) {
    await this.getById(id);
    await prisma.hardwareType.delete({ where: { id } });
  },

  // --- Issue categories (scoped to a hardware type) ---

  async addCategory(hardwareTypeId, { name }) {
    await this.getById(hardwareTypeId);
    return prisma.issueCategory.create({ data: { hardwareTypeId, name } });
  },

  async removeCategory(hardwareTypeId, categoryId) {
    const category = await prisma.issueCategory.findFirst({
      where: { id: categoryId, hardwareTypeId },
    });
    if (!category) throw ApiError.notFound('Issue category not found');
    await prisma.issueCategory.delete({ where: { id: categoryId } });
  },
};
