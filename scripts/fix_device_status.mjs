/**
 * One-shot reconcile: recomputes every deployed device's derived status from
 * its daily-log faulty-trend and its open issues, using the same precedence as
 * `reconcileDeviceStatus` in src/modules/devices/device.service.js:
 *
 *   1. faulty            — last FAULTY_THRESHOLD daily logs all `not_working`
 *   2. under_maintenance — >= 1 issue open/assigned/in_progress/on_hold/reopened
 *   3. active            — otherwise
 *
 * `retired` / `provisioned` / in-stock (zoneId null) units are left alone.
 *
 * Run:  node scripts/fix_device_status.mjs
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OCCUPYING = ['open', 'assigned', 'in_progress', 'on_hold', 'reopened'];
const FAULTY_THRESHOLD = Number(process.env.FAULTY_THRESHOLD ?? 3);

try {
  const devices = await prisma.device.findMany({
    where: { zoneId: { not: null }, status: { notIn: ['retired', 'provisioned'] } },
    select: {
      id: true,
      name: true,
      status: true,
      zone: { select: { name: true } },
    },
  });

  console.log(`\nReconciling ${devices.length} deployed device(s) (FAULTY_THRESHOLD=${FAULTY_THRESHOLD})\n`);

  let changed = 0;
  for (const d of devices) {
    const [recent, occupying] = await Promise.all([
      prisma.dailyStatusLog.findMany({
        where: { deviceId: d.id },
        orderBy: { logDate: 'desc' },
        take: FAULTY_THRESHOLD,
        select: { status: true },
      }),
      prisma.issue.count({ where: { deviceId: d.id, status: { in: OCCUPYING } } }),
    ]);

    const failing =
      recent.length === FAULTY_THRESHOLD && recent.every((l) => l.status === 'not_working');
    const target = failing ? 'faulty' : occupying > 0 ? 'under_maintenance' : 'active';

    if (target !== d.status) {
      await prisma.device.update({ where: { id: d.id }, data: { status: target } });
      changed += 1;
      console.log(`  ${d.status} → ${target}   ${d.name} (zone: ${d.zone?.name ?? 'none'})`);
    }
  }

  console.log(`\n${changed === 0 ? 'Nothing to change — all statuses already correct.' : `Updated ${changed} device(s).`}\n`);
} finally {
  await prisma.$disconnect();
}
