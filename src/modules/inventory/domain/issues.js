import { env } from '../../../config/env.js';
import { nextNumber, NUMBER_PREFIX } from './numbers.js';

/**
 * What every new issue gets, whichever app raised it (design doc §6 step 9,
 * §8 rule 7): a number, where the device was (snapshots), the warranty that
 * covers it today, and when it should be fixed by (SLA per priority).
 */

/** Rule 7: in_warranty if an active warranty covers `at`; out_of_warranty if it had one; else unknown. */
export async function warrantyFor(tx, deviceId, at = new Date()) {
  const warranties = await tx.warranty.findMany({ where: { deviceId, status: { not: 'void' } }, orderBy: { endDate: 'desc' } });
  const today = new Date(at.toISOString().slice(0, 10));
  const covering = warranties.find((w) => w.startDate <= today && w.endDate >= today);
  if (covering) return { warrantyId: covering.id, warrantyStatus: 'in_warranty' };
  if (warranties.length > 0) return { warrantyId: warranties[0].id, warrantyStatus: 'out_of_warranty' };
  return { warrantyId: null, warrantyStatus: 'unknown' };
}

export function slaDueAt(priority, from = new Date()) {
  const hours = env.INVENTORY_SLA_HOURS[priority];
  return hours ? new Date(from.getTime() + hours * 3_600_000) : null;
}

/** Fill the v2 columns of an issue just created (in the same transaction). */
export async function enrichNewIssue(tx, issueId, { raisedVia = 'manual', raisedByFbosUserId = null } = {}) {
  const issue = await tx.issue.findUnique({
    where: { id: issueId },
    select: {
      createdAt: true, priority: true, deviceId: true,
      device: { select: { zoneId: true, companyId: true, currentClientId: true, zone: { select: { clientId: true } }, installations: { where: { status: 'active' }, select: { id: true } } } },
    },
  });
  const warranty = await warrantyFor(tx, issue.deviceId, issue.createdAt);
  return tx.issue.update({
    where: { id: issueId },
    data: {
      organizationId: env.FBOS_ORGANIZATION_ID ?? null,
      issueNumber: await nextNumber(tx, NUMBER_PREFIX.issue, issue.createdAt),
      zoneId: issue.device.zoneId,
      clientId: issue.device.zone?.clientId ?? issue.device.currentClientId,
      companyId: issue.device.companyId,
      installationId: issue.device.installations[0]?.id ?? null,
      raisedVia,
      raisedByFbosUserId,
      warrantyId: warranty.warrantyId,
      warrantyStatus: warranty.warrantyStatus,
      slaDueAt: slaDueAt(issue.priority, issue.createdAt),
    },
  });
}
