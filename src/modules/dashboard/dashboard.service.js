import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { OPEN_ISSUE_STATES } from '../../utils/issueStateMachine.js';
import { zoneService } from '../zones/zone.service.js';

function todayUtc() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Resolve the device `where` clause for a dashboard scope. */
async function deviceScope({ scope, id, includeSubzones }) {
  if (scope === 'platform') return {};
  if (scope === 'client') {
    if (!id) throw ApiError.badRequest('client scope requires an id');
    return { zone: { clientId: id } };
  }
  if (scope === 'zone') {
    if (!id) throw ApiError.badRequest('zone scope requires an id');
    const zoneIds = includeSubzones === 'true' ? await zoneService.subtreeIds(id) : [id];
    return { zoneId: { in: zoneIds } };
  }
  throw ApiError.badRequest('Unknown scope');
}

export const dashboardService = {
  async summary(query) {
    const where = await deviceScope(query);
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
