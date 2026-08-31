import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';

export const verticalService = {
  listVerticals() {
    return prisma.vertical.findMany({ orderBy: { name: 'asc' } });
  },

  create({ key, name }) {
    return prisma.vertical.create({ data: { key, name } });
  },

  /** List a client's vertical toggles (with the vertical joined in). */
  async listForClient(clientId) {
    return prisma.clientVertical.findMany({
      where: { clientId },
      include: { vertical: true },
    });
  },

  /** Turn a vertical on/off for a client (idempotent upsert). */
  async setActive({ clientId, verticalId, active }) {
    const [client, vertical] = await Promise.all([
      prisma.client.findUnique({ where: { id: clientId } }),
      prisma.vertical.findUnique({ where: { id: verticalId } }),
    ]);
    if (!client) throw ApiError.badRequest('Client does not exist');
    if (!vertical) throw ApiError.badRequest('Vertical does not exist');

    return prisma.clientVertical.upsert({
      where: { clientId_verticalId: { clientId, verticalId } },
      update: { active },
      create: { clientId, verticalId, active },
      include: { vertical: true },
    });
  },
};
