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

  async create({ password, ...data }, caller) {
    assertRoleAllowed(caller, data.role);
    if (data.role === 'super_admin') await assertSingleSuperAdmin();
    // A client_admin may only create users inside its own client — never in
    // another tenant, and never a detached (clientless) account.
    if (caller?.role === 'client_admin') {
      if (!caller.clientId) throw ApiError.forbidden('Your account is not attached to a client');
      data.clientId = caller.clientId;
    }
    const passwordHash = password ? await hashPassword(password) : null;
    return prisma.user.create({ data: { ...data, passwordHash }, select: publicSelect });
  },

  async update(id, data, caller) {
    // Ensures a clean 404 rather than relying solely on Prisma's P2025.
    const target = await this.getById(id);
    assertCanManage(caller, target);
    if (data.role) assertRoleAllowed(caller, data.role);
    if (data.role === 'super_admin') await assertSingleSuperAdmin(id);
    // A client_admin can neither move a user out of its client nor pull one in
    // from another tenant.
    if (
      caller?.role === 'client_admin' &&
      data.clientId !== undefined &&
      data.clientId !== caller.clientId
    ) {
      throw ApiError.forbidden('You cannot reassign a user to another client');
    }
    return prisma.user.update({ where: { id }, data, select: publicSelect });
  },

  async remove(id, caller) {
    // A user must not delete the account they are currently authenticated as —
    // it would orphan their live session and can strand the last super_admin.
    if (caller?.id === id) {
      throw ApiError.forbidden('You cannot delete your own account', 'CANNOT_DELETE_SELF');
    }
    // Ensures a clean 404 and gives us the target's role/client for the check.
    const target = await this.getById(id);
    assertCanManage(caller, target);
    // Hard-delete. The user's owned/authored records survive with their author
    // FK set to null (zones.created_by, devices.added_by, issues.raised_by_user_id,
    // issue_status_history.changed_by_user_id, daily_status_logs.logged_by_user_id
    // are all `onDelete: SetNull`). Refresh/device tokens, zone assignments and any
    // technician profile cascade-delete; assigned issues' technician goes null.
    await prisma.user.delete({ where: { id } });
  },
};

// Who may manage (edit/delete) a given target user:
//   super_admin  — anyone.
//   client_admin — anyone EXCEPT a super_admin or a technician (technician
//                  lifecycle is super_admin-only), and only within its own client.
//   everyone else — never (the route already blocks them; this is defense-in-depth).
function assertCanManage(caller, target) {
  if (caller?.role === 'super_admin') return;
  if (caller?.role === 'client_admin') {
    if (target.role === 'super_admin') {
      throw ApiError.forbidden('A client admin cannot manage a super admin account');
    }
    if (target.role === 'technician') {
      throw ApiError.forbidden('Technician accounts are managed by a super admin only');
    }
    if (!target.clientId || target.clientId !== caller.clientId) {
      throw ApiError.forbidden('You can only manage users within your own client');
    }
    return;
  }
  throw ApiError.forbidden('You do not have permission to manage users');
}

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

// Roles that only a super_admin may assign. A client_admin can create
// zone_incharge, zone_staff, and client_admin users — but NOT technicians
// (technician lifecycle is managed exclusively by super_admin).
const SUPER_ADMIN_ONLY_ROLES = ['super_admin', 'technician'];

function assertRoleAllowed(caller, targetRole) {
  if (!targetRole) return;
  if (caller?.role === 'super_admin') return; // super_admin can assign any role
  if (SUPER_ADMIN_ONLY_ROLES.includes(targetRole)) {
    throw ApiError.forbidden(
      `Only a super admin can create or assign the '${targetRole}' role`
    );
  }
}
