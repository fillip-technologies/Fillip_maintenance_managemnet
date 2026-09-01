import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { hashPassword } from '../../utils/password.js';
import { userScopeWhere, combine } from '../../authz/scope.js';

/**
 * Data-access + business logic for users. Controllers stay thin; all Prisma
 * interaction lives here so it can be reused and tested in isolation.
 */

const publicSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  accountStatus: true,
  clientId: true,
  createdAt: true,
  updatedAt: true,
};

export const userService = {
  async list({ page, limit, search, clientId, role }, scope) {
    const filters = {
      ...(clientId ? { clientId } : {}),
      ...(role ? { role } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const where = combine(userScopeWhere(scope), filters);
    const total = await prisma.user.count({ where });
    const { skip, take, meta } = paginate({ page, limit }, total);
    const items = await prisma.user.findMany({
      where,
      select: publicSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    return { items, meta };
  },

  async getById(id) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: publicSelect,
    });
    if (!user) throw ApiError.notFound('User not found');
    return user;
  },

  async create({ password, ...data }) {
    const passwordHash = password ? await hashPassword(password) : null;
    return prisma.user.create({ data: { ...data, passwordHash }, select: publicSelect });
  },

  async update(id, data) {
    // Ensures a clean 404 rather than relying solely on Prisma's P2025.
    await this.getById(id);
    return prisma.user.update({ where: { id }, data, select: publicSelect });
  },

  async remove(id) {
    // Soft-remove: users are never hard-deleted so the issues/logs they created
    // keep their name intact (spec §3.5, `removed` account state).
    await this.getById(id);
    return prisma.user.update({
      where: { id },
      data: { accountStatus: 'removed' },
      select: publicSelect,
    });
  },
};
