import { prisma } from '../src/lib/prisma.js';

async function main() {
  // Find the Rajgir Zoo Safari client by name or facilityName
  const client = await prisma.client.findFirst({
    where: {
      OR: [
        { name: { contains: 'Rajgir Zoo Safari', mode: 'insensitive' } },
        { facilityName: { contains: 'Rajgir Zoo Safari', mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, facilityName: true, companyId: true },
  });

  if (!client) {
    console.error('Client "Rajgir Zoo Safari" not found.');
    process.exit(1);
  }
  console.log(`Found client: "${client.name}" (facilityName: "${client.facilityName}") — id: ${client.id}`);

  // Collect all zone IDs for this client (including sub-zones)
  const zones = await prisma.zone.findMany({
    where: { clientId: client.id },
    select: { id: true, name: true },
  });
  const zoneIds = zones.map((z) => z.id);
  console.log(`Found ${zoneIds.length} zone(s):`, zones.map((z) => z.name).join(', ') || '(none)');

  if (zoneIds.length === 0) {
    console.log('No zones found — nothing to delete.');
    return;
  }

  // Collect all devices for this client's company (includes in-stock with zoneId=null)
  const devices = await prisma.device.findMany({
    where: {
      companyId: client.companyId,
    },
    select: { id: true, name: true, code: true, status: true, zoneId: true },
  });
  const deviceIds = devices.map((d) => d.id);
  console.log(`\nFound ${deviceIds.length} device(s) to delete:`);
  devices.forEach((d) => console.log(`  [${d.status}] ${d.code} — ${d.name}`));

  if (deviceIds.length === 0) {
    console.log('No devices found — nothing to delete.');
    return;
  }

  // Confirm counts before deleting
  const issueIds = (
    await prisma.issue.findMany({
      where: { deviceId: { in: deviceIds } },
      select: { id: true },
    })
  ).map((i) => i.id);

  const historyCount = await prisma.issueStatusHistory.count({ where: { issueId: { in: issueIds } } });
  const logsCount = await prisma.dailyStatusLog.count({ where: { deviceId: { in: deviceIds } } });
  const issuesCount = issueIds.length;

  console.log(`\nRecords to be deleted:`);
  console.log(`  issue_status_history : ${historyCount}`);
  console.log(`  daily_status_logs    : ${logsCount}`);
  console.log(`  issues               : ${issuesCount}`);
  console.log(`  devices              : ${deviceIds.length}`);

  // Delete in child → parent order
  const delHistory = await prisma.issueStatusHistory.deleteMany({ where: { issueId: { in: issueIds } } });
  console.log(`\nDeleted ${delHistory.count} issue status history record(s)`);

  const delLogs = await prisma.dailyStatusLog.deleteMany({ where: { deviceId: { in: deviceIds } } });
  console.log(`Deleted ${delLogs.count} daily status log(s)`);

  const delIssues = await prisma.issue.deleteMany({ where: { deviceId: { in: deviceIds } } });
  console.log(`Deleted ${delIssues.count} issue(s)`);

  const delDevices = await prisma.device.deleteMany({ where: { id: { in: deviceIds } } });
  console.log(`Deleted ${delDevices.count} device(s)`);

  console.log('\nDone. Remaining counts for this client:');
  const remaining = {
    devices: await prisma.device.count({ where: { zoneId: { in: zoneIds } } }),
    issues: await prisma.issue.count({ where: { device: { zoneId: { in: zoneIds } } } }),
  };
  console.table(remaining);
}

main()
  .catch((e) => { console.error('Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
