import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { domainEvents } from '../realtime/events.js';
import { zoneService } from '../modules/zones/zone.service.js';
import { sendToTokens } from './provider.js';
import { AUDIENCE, notificationForEvent } from './recipients.js';

/**
 * Resolve an audience keyword to a set of user ids for a given issue.
 * `raiser` / `assigned_technician` come straight off the event payload;
 * `zone_incharge` / `client_admin` require DB lookups. `ancestorsOf` is
 * injected so the zone-incharge branch is testable without a live DB.
 */
async function resolveAudience({ db, ancestorsOf }, audience, issue) {
  switch (audience) {
    case AUDIENCE.RAISER:
      return issue.raisedBy?.id ? [issue.raisedBy.id] : [];

    case AUDIENCE.ASSIGNED_TECHNICIAN:
      return issue.assignedTechnician?.user?.id ? [issue.assignedTechnician.user.id] : [];

    case AUDIENCE.ZONE_INCHARGE: {
      const zoneId = issue.device?.zoneId;
      if (!zoneId) return [];
      // Notify the incharge of the device's OWN zone. Ancestor incharges are
      // only reached when CASCADING_VISIBILITY is on — otherwise a parent-zone
      // incharge would get a push about an issue they can't open over HTTP.
      let zoneIds = [zoneId];
      if (env.CASCADING_VISIBILITY) {
        const ancestors = await ancestorsOf(zoneId);
        zoneIds = ancestors.map((a) => a.id);
      }
      const rows = await db.zoneAssignment.findMany({
        where: { zoneId: { in: zoneIds }, role: 'incharge', unassignedAt: null },
        select: { userId: true },
      });
      return rows.map((r) => r.userId);
    }

    case AUDIENCE.CLIENT_ADMIN: {
      const zoneId = issue.device?.zoneId;
      if (!zoneId) return [];
      const zone = await db.zone.findUnique({
        where: { id: zoneId },
        select: { clientId: true },
      });
      if (!zone?.clientId) return [];
      const admins = await db.user.findMany({
        where: { clientId: zone.clientId, role: 'client_admin', accountStatus: 'active' },
        select: { id: true },
      });
      return admins.map((u) => u.id);
    }

    default:
      return [];
  }
}

/** Turn a notification's audiences into a de-duplicated set of user ids. */
async function resolveUserIds(deps, audiences, issue) {
  const lists = await Promise.all(audiences.map((a) => resolveAudience(deps, a, issue)));
  return [...new Set(lists.flat())];
}

/**
 * Handle one issue domain event: resolve recipients, dispatch, prune tokens.
 * Dependencies are injectable so recipient/token selection can be asserted in
 * tests with fakes; production wiring uses the real Prisma client, FCM sender,
 * and recursive ancestor lookup.
 */
export async function handleIssueEvent(
  { type, issue },
  { db = prisma, send = sendToTokens, ancestorsOf = zoneService.ancestors } = {}
) {
  const notification = notificationForEvent({ type, issue });
  if (!notification) return { sent: 0, userIds: [] };

  const userIds = await resolveUserIds({ db, ancestorsOf }, notification.audiences, issue);
  if (userIds.length === 0) return { sent: 0, userIds };

  const tokens = await db.deviceToken.findMany({
    where: { userId: { in: userIds } },
    select: { token: true },
  });
  if (tokens.length === 0) return { sent: 0, userIds };

  const { sent, invalidTokens } = await send(
    tokens.map((t) => t.token),
    { title: notification.title, body: notification.body, data: notification.data }
  );

  // Prune tokens FCM reported as dead so we stop paying to message them.
  if (invalidTokens.length) {
    await db.deviceToken.deleteMany({ where: { token: { in: invalidTokens } } });
  }

  logger.debug(
    { type, status: issue.status, recipients: userIds.length, sent, pruned: invalidTokens.length },
    'Push dispatched'
  );
  return { sent, userIds };
}

/**
 * Subscribe the push layer to the domain event bus. Errors are swallowed (and
 * logged) so a push failure never breaks the originating request or the
 * realtime broadcast that shares the same event.
 */
export function initPushNotifier() {
  domainEvents.on('issue', (payload) => {
    handleIssueEvent(payload).catch((err) => logger.error({ err }, 'Push handler failed'));
  });
  logger.info('Push notifier subscribed to domain events');
}
