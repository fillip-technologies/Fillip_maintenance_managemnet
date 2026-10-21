import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { withTx } from '../db.js';
import { enqueueNotification } from './outbox.js';

/**
 * Preventive maintenance (AMC): a plan for a site (optionally one zone or one
 * model) generates a `preventive` service visit every `frequency_days`,
 * `lead_days` before it is due, and tells the technician who covers it.
 */
const org = () => env.FBOS_ORGANIZATION_ID ?? null;
const DAY = 86_400_000;
const addDays = (d, n) => new Date(d.getTime() + n * DAY);

/** Create the visits that are due within each plan's lead time. Returns how many. */
export async function generateDueVisits(now = new Date()) {
  const today = new Date(now.toISOString().slice(0, 10));
  const plans = await prisma.maintenancePlan.findMany({ where: { isActive: true, ...(org() ? { organizationId: org() } : {}) } });
  let created = 0;
  for (const plan of plans) {
    let due = plan.nextDueAt;
    while (addDays(today, plan.leadDays) >= due) {
      const dueAt = due;
      await withTx(async (tx) => {
        const technicianId = plan.technicianId ?? (await coveringTechnician(tx, plan));
        const visit = await tx.serviceVisit.create({
          data: {
            organizationId: plan.organizationId, maintenancePlanId: plan.id, clientId: plan.clientId,
            technicianId, visitType: 'preventive', status: 'scheduled', scheduledAt: dueAt,
          },
        });
        await tx.maintenancePlan.update({ where: { id: plan.id }, data: { nextDueAt: addDays(dueAt, plan.frequencyDays), lastGeneratedAt: new Date() } });
        const tech = technicianId ? await tx.technician.findUnique({ where: { id: technicianId }, select: { user: { select: { fbosUserId: true } } } }) : null;
        if (tech?.user.fbosUserId) {
          await enqueueNotification(tx, {
            eventType: 'maintenance.scheduled', aggregateType: 'service_visit', aggregateId: visit.id,
            notify: { title: `Preventive visit: ${plan.name}`, body: `Due ${dueAt.toISOString().slice(0, 10)}.`, recipient_user_ids: [tech.user.fbosUserId] },
          });
        }
      });
      created++;
      due = addDays(due, plan.frequencyDays);
    }
  }
  return created;
}

async function coveringTechnician(tx, plan) {
  const a = await tx.technicianAssignment.findFirst({
    where: { OR: [...(plan.zoneId ? [{ zoneId: plan.zoneId }] : []), { clientId: plan.clientId }, { zone: { clientId: plan.clientId } }] },
    select: { technicianId: true },
  });
  return a?.technicianId ?? null;
}
