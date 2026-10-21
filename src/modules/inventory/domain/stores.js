import { prisma } from '../../../lib/prisma.js';
import { ApiError } from '../../../utils/ApiError.js';

/**
 * Before a company or site is deleted in the legacy app: drop its stock
 * locations if nothing ever happened at them, otherwise refuse, because those
 * locations are part of devices' transfer and receiving history.
 * `{ companyId }` covers the company's own store and its sites' stores.
 */
export async function removeEmptyStores({ companyId, clientId }) {
  const where = clientId
    ? { clientId }
    : { OR: [{ companyId }, { client: { companyId } }] };
  const stores = await prisma.stockLocation.findMany({
    where,
    select: {
      id: true,
      name: true,
      _count: { select: { devices: true, transfersOut: true, transfersIn: true, goodsReceipts: true } },
    },
  });
  const used = stores.filter((s) => Object.values(s._count).some((n) => n > 0));
  if (used.length > 0) {
    throw ApiError.conflict(
      `Stock has moved through ${used.map((s) => s.name).join(', ')}. Deactivate instead of deleting.`,
      { stockLocationIds: used.map((s) => s.id) },
      'STORE_HAS_HISTORY',
    );
  }
  if (stores.length > 0) {
    await prisma.stockLocation.deleteMany({ where: { id: { in: stores.map((s) => s.id) } } });
  }
}
