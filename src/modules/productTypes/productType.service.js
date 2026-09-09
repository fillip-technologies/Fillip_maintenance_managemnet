import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';

const publicSelect = {
  id: true,
  categoryId: true,
  name: true,
  imageUrl: true,
  createdAt: true,
  _count: { select: { devices: true } },
};

export const productTypeService = {
  async list(categoryId) {
    const where = categoryId ? { categoryId } : {};
    return prisma.productType.findMany({
      where,
      select: publicSelect,
      orderBy: { name: 'asc' },
    });
  },

  async create({ categoryId, name }) {
    const category = await prisma.productCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) throw ApiError.badRequest('Category does not exist');
    try {
      return await prisma.productType.create({
        data: { categoryId, name: name.trim() },
        select: publicSelect,
      });
    } catch (e) {
      if (e.code === 'P2002') {
        throw ApiError.conflict(
          `A product type named "${name}" already exists in this category`,
          undefined,
          'PRODUCT_TYPE_EXISTS',
        );
      }
      throw e;
    }
  },

  async uploadLogo(id, buffer) {
    const pt = await prisma.productType.findUnique({ where: { id }, select: { id: true } });
    if (!pt) throw ApiError.notFound('Product type not found');
    const { streamToCloudinary } = await import('../../middleware/upload.js');
    const result = await streamToCloudinary(buffer, {
      folder: 'fixly/product-types',
      resource_type: 'image',
    });
    return prisma.productType.update({
      where: { id },
      data: { imageUrl: result.secure_url },
      select: publicSelect,
    });
  },

  async remove(id) {
    const inUse = await prisma.device.count({ where: { productTypeId: id } });
    if (inUse > 0) {
      throw ApiError.conflict(
        `Product type is used by ${inUse} product(s) and cannot be deleted`,
        undefined,
        'PRODUCT_TYPE_IN_USE',
      );
    }
    await prisma.productType.delete({ where: { id } });
  },
};
