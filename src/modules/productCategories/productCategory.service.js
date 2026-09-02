import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Global product categories (shared by all organizations, managed by the CEO).
 * Each category owns a `code` prefix and an atomic `lastSeq` counter used to
 * mint unit identification codes like `CAM-000123`.
 */

const publicSelect = {
  id: true,
  name: true,
  code: true,
  createdAt: true,
  _count: { select: { devices: true } },
};

const normalizePrefix = (s) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export const productCategoryService = {
  async list() {
    return prisma.productCategory.findMany({ select: publicSelect, orderBy: { name: 'asc' } });
  },

  async create({ name, code }) {
    const prefix = normalizePrefix(code);
    if (!prefix) throw ApiError.badRequest('Category code must contain letters or digits');
    try {
      return await prisma.productCategory.create({
        data: { name: name.trim(), code: prefix },
        select: publicSelect,
      });
    } catch (e) {
      if (e.code === 'P2002') {
        throw ApiError.conflict('A category with this name or code already exists', undefined, 'CATEGORY_EXISTS');
      }
      throw e;
    }
  },

  async remove(id) {
    const inUse = await prisma.device.count({ where: { categoryId: id } });
    if (inUse > 0) {
      throw ApiError.conflict(`Category is used by ${inUse} unit(s) and cannot be deleted`, undefined, 'CATEGORY_IN_USE');
    }
    await prisma.productCategory.delete({ where: { id } });
  },
};

/**
 * Atomically reserve `count` sequential codes for a category and return them.
 * Runs inside the CALLER's transaction (`tx`) so code minting commits with the
 * unit(s). One `UPDATE ... RETURNING` reserves the whole range under a row lock
 * — safe for a single create AND for a bulk import of thousands (no per-row
 * lock contention). Returns `{ codes: [...], categoryCode }`.
 */
export async function reserveCodes(tx, categoryId, count = 1) {
  const rows = await tx.$queryRaw`
    UPDATE product_categories
    SET last_seq = last_seq + ${count}
    WHERE id = ${categoryId}::uuid
    RETURNING code, last_seq`;
  if (rows.length === 0) throw ApiError.badRequest('Category does not exist');
  const { code, last_seq } = rows[0];
  const end = Number(last_seq);
  const start = end - count + 1;
  const codes = [];
  for (let n = start; n <= end; n++) {
    codes.push(`${code}-${String(n).padStart(6, '0')}`);
  }
  return { codes, categoryCode: code };
}
