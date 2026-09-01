import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { OPEN_ISSUE_STATES } from '../../utils/issueStateMachine.js';
import { zoneService } from '../zones/zone.service.js';
import { clientInScope, assertInScope } from '../../authz/scope.js';

function todayUtc() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Resolve the device `where` clause for a dashboard scope, enforcing that the
 * caller is actually allowed to aggregate over the requested scope/id.
 */
async function deviceScope({ scope, id, includeSubzones }, authScope) {
  if (scope === 'platform') {
    // Only a platform-wide identity may see global counts.
    assertInScope(authScope.platform, 'platform scope is restricted');
    return {};
  }
  if (scope === 'client') {
    if (!id) throw ApiError.badRequest('client scope requires an id');
    assertInScope(clientInScope(authScope, id), 'Client outside your scope');
    return { zone: { clientId: id } };
  }
  if (scope === 'zone') {
    if (!id) throw ApiError.badRequest('zone scope requires an id');
    // Reuse the scoped zone fetch — 404 if the zone isn't visible to the caller.
    await zoneService.getByIdInScope(id, authScope);
    const zoneIds = includeSubzones === 'true' ? await zoneService.subtreeIds(id) : [id];
    return { zoneId: { in: zoneIds } };
  }
  throw ApiError.badRequest('Unknown scope');
}

export const dashboardService = {
  async summary(query, authScope) {
    const where = await deviceScope(query, authScope);
    const today = todayUtc();

    const [totalDevices, faultyDevices, devicesMissingTodayLog, openIssues] = await Promise.all([
      prisma.device.count({ where: { ...where, status: { not: 'retired' } } }),
      prisma.device.count({ where: { ...where, status: 'faulty' } }),
      prisma.device.count({
        where: {
          ...where,
          status: { not: 'retired' },
          dailyStatusLogs: { none: { logDate: today } },
        },
      }),
      prisma.issue.count({
        where: { device: where, status: { in: OPEN_ISSUE_STATES } },
      }),
    ]);

    return { openIssues, faultyDevices, devicesMissingTodayLog, totalDevices };
  },
};
