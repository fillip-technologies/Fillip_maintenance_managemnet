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
    if (data.role === 'super_admin') await assertSingleSuperAdmin();
    const passwordHash = password ? await hashPassword(password) : null;
    return prisma.user.create({ data: { ...data, passwordHash }, select: publicSelect });
  },

  async update(id, data) {
    // Ensures a clean 404 rather than relying solely on Prisma's P2025.
    await this.getById(id);
    if (data.role === 'super_admin') await assertSingleSuperAdmin(id);
    return prisma.user.update({ where: { id }, data, select: publicSelect });
  },

  async remove(id) {
    // Hard-delete. The user's owned/authored records survive with their author
    // FK set to null (zones.created_by, devices.added_by, issues.raised_by_user_id,
    // issue_status_history.changed_by_user_id, daily_status_logs.logged_by_user_id
    // are all `onDelete: SetNull`). Refresh/device tokens, zone assignments and any
    // technician profile cascade-delete; assigned issues' technician goes null.
    await this.getById(id);
    await prisma.user.delete({ where: { id } });
  },
};

// Exactly one super_admin may exist platform-wide. `exceptId` lets an update to
// the current super_admin itself pass (it's already the sole one).
async function assertSingleSuperAdmin(exceptId) {
  const existing = await prisma.user.count({
    where: {
      role: 'super_admin',
      accountStatus: { not: 'removed' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
  if (existing > 0) {
    throw ApiError.conflict(
      'A super admin already exists; only one is allowed',
      undefined,
      'SUPER_ADMIN_EXISTS'
    );
  }
}
