import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { env } from '../../config/env.js';
import { zoneService } from '../zones/zone.service.js';
import { emitLogEvent } from '../../realtime/events.js';
import { dailyLogScopeWhere, combine, deviceInScope, assertInScope } from '../../authz/scope.js';

/** Normalize any date to a UTC midnight `Date` so one row = one calendar day. */
function toLogDate(input) {
  const d = input ? new Date(input) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const withRefs = {
  device: { select: { id: true, name: true, zoneId: true } },
  loggedBy: { select: { id: true, name: true } },
};

function flatten(log) {
  return {
    ...log,
    deviceName: log.device?.name ?? null,
    loggedByName: log.loggedBy?.name ?? null,
  };
}

export const dailyLogService = {
  async list({ page, limit, deviceId, zoneId, includeSubzones, date, from, to }, scope) {
    let deviceFilter;
    if (deviceId) {
      deviceFilter = { id: deviceId };
    } else if (zoneId) {
      const zoneIds = includeSubzones === 'true' ? await zoneService.subtreeIds(zoneId) : [zoneId];
      deviceFilter = { zoneId: { in: zoneIds } };
    }

    const logDate = date
      ? toLogDate(date)
      : from || to
        ? { ...(from ? { gte: toLogDate(from) } : {}), ...(to ? { lte: toLogDate(to) } : {}) }
        : undefined;

    const filters = {
      ...(deviceFilter ? { device: deviceFilter } : {}),
      ...(logDate ? { logDate } : {}),
    };
    const where = combine(dailyLogScopeWhere(scope), filters);

    const total = await prisma.dailyStatusLog.count({ where });
    const { skip, take, meta } = paginate({ page, limit }, total);
    const rows = await prisma.dailyStatusLog.findMany({
      where,
      orderBy: { logDate: 'desc' },
      skip,
      take,
      include: withRefs,
    });
    return { items: rows.map(flatten), meta };
  },

  async create({ deviceId, loggedByUserId, status, logDate, notes, overwrite }, user, scope) {
    const loggerId = user?.id ?? loggedByUserId;
    if (!loggerId) throw ApiError.badRequest('Logger could not be determined');

    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: { zone: { select: { clientId: true } } },
    });
    if (!device) throw ApiError.badRequest('Device does not exist');
    assertInScope(
      deviceInScope(scope, { zoneId: device.zoneId, clientId: device.zone?.clientId }),
      'Cannot log a device outside your scope'
    );
    if (device.status === 'retired') throw ApiError.badRequest('Cannot log a retired device');

    const date = toLogDate(logDate);
    const existing = await prisma.dailyStatusLog.findUnique({
      where: { deviceId_logDate: { deviceId, logDate: date } },
    });

    if (existing && !overwrite) {
      throw ApiError.conflict(
        'This device already has a log entry for today',
        undefined,
        'ALREADY_LOGGED_TODAY'
      );
    }

    const log = await prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.dailyStatusLog.update({
            where: { id: existing.id },
            data: { status, notes: notes ?? null, loggedByUserId: loggerId },
          })
        : await tx.dailyStatusLog.create({
            data: { deviceId, loggedByUserId: loggerId, status, logDate: date, notes: notes ?? null },
          });
      await maybeFlagFaulty(tx, deviceId);
      return saved;
    }, { maxWait: 10_000, timeout: 20_000 });
    emitLogEvent(log, device.zoneId);
    return log;
  },
};

/**
 * If the most recent `FAULTY_THRESHOLD` logs are all `not_working` and the
 * device is otherwise `active`, soft-flag it `faulty` (section 3.2). This is a
 * warning state, not a hard block, and never overrides `under_maintenance` or
 * `retired`.
 */
async function maybeFlagFaulty(tx, deviceId) {
  const device = await tx.device.findUnique({ where: { id: deviceId } });
  if (!device || device.status !== 'active') return;

  const recent = await tx.dailyStatusLog.findMany({
    where: { deviceId },
    orderBy: { logDate: 'desc' },
    take: env.FAULTY_THRESHOLD,
    select: { status: true },
  });

  if (recent.length === env.FAULTY_THRESHOLD && recent.every((log) => log.status === 'not_working')) {
    await tx.device.update({ where: { id: deviceId }, data: { status: 'faulty' } });
  }
}
