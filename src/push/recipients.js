import { DOMAIN_EVENT } from '../realtime/events.js';

/**
 * Audience keywords an event can target. Resolving a keyword to concrete user
 * ids happens in notifier.js (DB-backed); keeping the event→audience mapping
 * here as a PURE function makes "who should be notified for X" unit-testable
 * without a database.
 */
export const AUDIENCE = {
  RAISER: 'raiser',
  ASSIGNED_TECHNICIAN: 'assigned_technician',
  ZONE_INCHARGE: 'zone_incharge',
  CLIENT_ADMIN: 'client_admin',
  ZONE_TECHNICIAN: 'zone_technician',
};

const deviceLabel = (issue) =>
  `${issue?.device?.name ?? 'Device'}: ${issue?.category?.name ?? 'issue'}`;

/**
 * Map a domain event to a push notification: which audiences to reach and the
 * title/body/data to send. Returns `null` when the event warrants no push
 * (e.g. an intermediate status with no interested party).
 *
 * Pure: depends only on its argument, so tests can assert audience selection
 * per event/status without touching Prisma or FCM.
 */
export function notificationForEvent({ type, issue }) {
  if (!issue) return null;
  // zoneId included in all payloads so the Flutter app can deep-link to the zone screen.
  const base = { data: { issueId: issue.id, zoneId: issue.device?.zoneId ?? null } };

  if (type === DOMAIN_EVENT.ISSUE_CREATED) {
    return {
      ...base,
      audiences: [AUDIENCE.CLIENT_ADMIN, AUDIENCE.ZONE_INCHARGE, AUDIENCE.ZONE_TECHNICIAN],
      title: 'New issue raised',
      body: deviceLabel(issue),
      data: { ...base.data, type: 'issue_created' },
    };
  }

  if (type === DOMAIN_EVENT.ISSUE_UPDATED) {
    switch (issue.status) {
      case 'assigned':
        return {
          audiences: [AUDIENCE.ASSIGNED_TECHNICIAN],
          title: 'New issue assigned',
          body: deviceLabel(issue),
          data: { ...base.data, type: 'issue_assigned' },
        };
      case 'in_progress':
        return {
          audiences: [AUDIENCE.RAISER, AUDIENCE.ZONE_INCHARGE],
          title: 'Technician started work',
          body: deviceLabel(issue),
          data: { ...base.data, type: 'issue_in_progress' },
        };
      case 'on_hold':
        return {
          audiences: [AUDIENCE.RAISER, AUDIENCE.ZONE_INCHARGE],
          title: 'Issue on hold',
          body: deviceLabel(issue),
          data: { ...base.data, type: 'issue_on_hold' },
        };
      case 'resolved':
        return {
          audiences: [AUDIENCE.RAISER, AUDIENCE.ZONE_INCHARGE],
          title: 'Issue resolved — please confirm',
          body: deviceLabel(issue),
          data: { ...base.data, type: 'issue_resolved' },
        };
      case 'reopened':
        return {
          audiences: [AUDIENCE.ASSIGNED_TECHNICIAN],
          title: 'Issue reopened',
          body: deviceLabel(issue),
          data: { ...base.data, type: 'issue_reopened' },
        };
      case 'closed':
        return {
          audiences: [AUDIENCE.RAISER, AUDIENCE.ASSIGNED_TECHNICIAN],
          title: 'Issue closed',
          body: deviceLabel(issue),
          data: { ...base.data, type: 'issue_closed' },
        };
      default:
        return null;
    }
  }

  return null;
}
