// One-off: wipe ALL seeded/test data, keeping only the super_admin account(s)
// so you can still log in. Deletes children → parents (cascades cover the rest).
// Run:  node scripts/wipe_to_superadmin.mjs
import { prisma } from '../src/lib/prisma.js';

async function main() {
  const keep = await prisma.user.findMany({
    where: { role: 'super_admin' },
    select: { id: true, email: true },
  });
  console.log('Keeping super_admin(s):', keep.map((u) => u.email).join(', ') || '(none!)');
  const keepIds = keep.map((u) => u.id);

  // Child → parent order. Most FKs cascade, but explicit deletes keep it obvious.
  const steps = [
    ['issue_status_history', () => prisma.issueStatusHistory.deleteMany()],
    ['daily_status_logs', () => prisma.dailyStatusLog.deleteMany()],
    ['issues', () => prisma.issue.deleteMany()],
    ['devices', () => prisma.device.deleteMany()],
    ['issue_categories', () => prisma.issueCategory.deleteMany()],
    ['hardware_types', () => prisma.hardwareType.deleteMany()],
    ['technician_assignments', () => prisma.technicianAssignment.deleteMany()],
    ['zone_assignments', () => prisma.zoneAssignment.deleteMany()],
    ['zones', () => prisma.zone.deleteMany()],
    ['client_verticals', () => prisma.clientVertical.deleteMany()],
    ['verticals', () => prisma.vertical.deleteMany()],
    ['clients', () => prisma.client.deleteMany()],
    ['companies', () => prisma.company.deleteMany()],
    ['technicians', () => prisma.technician.deleteMany()],
    ['device_tokens', () => prisma.deviceToken.deleteMany({ where: { userId: { notIn: keepIds } } })],
    ['refresh_tokens', () => prisma.refreshToken.deleteMany({ where: { userId: { notIn: keepIds } } })],
    ['users (non-super)', () => prisma.user.deleteMany({ where: { id: { notIn: keepIds } } })],
  ];

  for (const [name, fn] of steps) {
    const { count } = await fn();
    console.log(`  deleted ${count} from ${name}`);
  }

  const counts = {
    companies: await prisma.company.count(),
    clients: await prisma.client.count(),
    zones: await prisma.zone.count(),
    devices: await prisma.device.count(),
    issues: await prisma.issue.count(),
    dailyLogs: await prisma.dailyStatusLog.count(),
    technicians: await prisma.technician.count(),
    hardwareTypes: await prisma.hardwareType.count(),
    verticals: await prisma.vertical.count(),
    users: await prisma.user.count(),
  };
  console.log('\nRemaining rows:');
  console.table(counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
