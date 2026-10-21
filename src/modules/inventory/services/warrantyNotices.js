import { withTx } from '../db.js';
import { prisma } from '../../../lib/prisma.js';
import { enqueueNotification } from './outbox.js';

/**
 * `warranty.expiring` (integration plan §5.6): tell the device's site staff (and
 * the operator's staff via the customer unit) 60, 30 and 7 days before a
 * warranty ends. `last_notice_days` remembers the last notice so each is sent once.
 */
export const NOTICE_DAYS = [60, 30, 7];

export async function queueWarrantyNotices(now = new Date()) {
  const today = new Date(now.toISOString().slice(0, 10));
  const horizon = new Date(today.getTime() + NOTICE_DAYS[0] * 86_400_000);
  const due = await prisma.warranty.findMany({
    where: { status: 'active', endDate: { gte: today, lte: horizon }, device: { lifecycleState: { notIn: ['retired', 'disposed', 'lost'] } } },
    include: {
      device: {
        select: {
          id: true, code: true, name: true,
          currentClient: { select: { fbosOrgUnitId: true } },
          company: { select: { fbosOrgUnitId: true } },
        },
      },
    },
  });
  let queued = 0;
  for (const w of due) {
    const daysLeft = Math.ceil((w.endDate - today) / 86_400_000);
    const step = [...NOTICE_DAYS].reverse().find((d) => daysLeft <= d);
    if (!step || (w.lastNoticeDays != null && w.lastNoticeDays <= step)) continue;
    const units = [w.device.currentClient?.fbosOrgUnitId ?? w.device.company?.fbosOrgUnitId].filter(Boolean);
    await withTx(async (tx) => {
      await tx.warranty.update({ where: { id: w.id }, data: { lastNoticeDays: step } });
      await enqueueNotification(tx, {
        eventType: 'warranty.expiring',
        aggregateType: 'warranty',
        aggregateId: w.id,
        notify: {
          title: `Warranty of ${w.device.code} ends in ${daysLeft} day(s)`,
          body: `${w.device.name}: ${w.warrantyType} cover until ${w.endDate.toISOString().slice(0, 10)}.`,
          action_url: `/inventory/devices/${w.device.id}?tab=warranty`,
          urgency: step <= 7 ? 'high' : 'normal',
          recipient_unit_ids: units,
        },
      });
    });
    queued++;
  }
  return queued;
}
