import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';

/**
 * Products / Inventory, scoped to a Company.
 *
 * - super_admin: may act on ANY company; must pick one when creating.
 * - client_admin: locked to their OWN company (derived from their client). Any
 *   client-supplied companyId that isn't theirs is rejected.
 *
 * Every create/delete also writes an immutable ProductAudit row so the super
 * admin can see who changed inventory — even after a product is deleted.
 */

const publicSelect = {
  id: true,
  companyId: true,
  name: true,
  category: true,
  serialNumber: true,
  quantity: true,
  unitPrice: true,
  purchaseDate: true,
  installationDate: true,
  imageUrl: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { id: true, name: true } },
  addedBy: { select: { id: true, name: true } },
};

/** The company a client_admin belongs to (via their client), or null. */
async function callerCompanyId(user) {
  if (!user?.clientId) return null;
  const client = await prisma.client.findUnique({
    where: { id: user.clientId },
    select: { companyId: true },
  });
  return client?.companyId ?? null;
}

/**
 * Resolve which company the caller may act within for a write.
 * super_admin → the requested company (required). client_admin → their own,
 * and a mismatching requested company is forbidden.
 */
async function resolveWriteCompany(user, requestedCompanyId) {
  if (user.role === 'super_admin') {
    if (!requestedCompanyId) {
      throw ApiError.badRequest('Select an organization (companyId) for the product', undefined, 'COMPANY_REQUIRED');
    }
    const company = await prisma.company.findUnique({ where: { id: requestedCompanyId }, select: { id: true } });
    if (!company) throw ApiError.badRequest('Organization does not exist');
    return requestedCompanyId;
  }
  // client_admin
  const own = await callerCompanyId(user);
  if (!own) throw ApiError.forbidden('Your account is not attached to an organization');
  if (requestedCompanyId && requestedCompanyId !== own) {
    throw ApiError.forbidden('You can only manage inventory for your own organization');
  }
  return own;
}

export const productService = {
  async list({ page, limit, companyId, search }, user) {
    // Restrict the visible company set by role.
    let companyFilter;
    if (user.role === 'super_admin') {
      companyFilter = companyId ?? undefined; // optional filter, else all
    } else {
      const own = await callerCompanyId(user);
      if (!own) return { items: [], meta: paginate({ page, limit }, 0).meta };
      // A client_admin can never see another company; ignore a foreign filter.
      companyFilter = own;
    }

    const where = {
      ...(companyFilter ? { companyId: companyFilter } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };
    const total = await prisma.product.count({ where });
    const { skip, take, meta } = paginate({ page, limit }, total);
    const items = await prisma.product.findMany({
      where,
      select: publicSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
    return { items, meta };
  },

  async create({ companyId, ...data }, user) {
    const resolvedCompanyId = await resolveWriteCompany(user, companyId);

    return prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: { ...data, companyId: resolvedCompanyId, addedById: user.id ?? null },
        select: publicSelect,
      });
      await tx.productAudit.create({
        data: {
          productId: product.id,
          companyId: resolvedCompanyId,
          action: 'created',
          productName: product.name,
          changedById: user.id ?? null,
          details: { quantity: product.quantity },
        },
      });
      return product;
    });
  },

  async remove(id, user) {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw ApiError.notFound('Product not found');
    // Authorize against the product's company.
    if (user.role !== 'super_admin') {
      const own = await callerCompanyId(user);
      if (!own || product.companyId !== own) {
        throw ApiError.forbidden('You can only manage inventory for your own organization');
      }
    }
    // Delete + audit atomically. The audit row keeps a name snapshot and its
    // productId goes null (schema SetNull) so it still reads after deletion.
    await prisma.$transaction(async (tx) => {
      await tx.productAudit.create({
        data: {
          productId: product.id,
          companyId: product.companyId,
          action: 'deleted',
          productName: product.name,
          changedById: user.id ?? null,
        },
      });
      await tx.product.delete({ where: { id } });
    });
  },

  /** Super-admin inventory audit trail (created/deleted, across companies). */
  async auditLog({ page, limit, companyId }, _user) {
    const where = companyId ? { companyId } : {};
    const total = await prisma.productAudit.count({ where });
    const { skip, take, meta } = paginate({ page, limit }, total);
    const items = await prisma.productAudit.findMany({
      where,
      orderBy: { changedAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        productId: true,
        action: true,
        productName: true,
        details: true,
        changedAt: true,
        company: { select: { id: true, name: true } },
        changedBy: { select: { id: true, name: true, role: true } },
      },
    });
    return { items, meta };
  },
};
