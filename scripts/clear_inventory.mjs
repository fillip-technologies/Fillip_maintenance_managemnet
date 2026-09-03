import { prisma } from '../src/lib/prisma.js';

async function main() {
  console.log('Deleting inventory data (devices and related records)...');

  // Deleting in child -> parent order for cleanliness
  const deletedHistory = await prisma.issueStatusHistory.deleteMany();
  console.log(`Deleted ${deletedHistory.count} issue status history record(s)`);

  const deletedLogs = await prisma.dailyStatusLog.deleteMany();
  console.log(`Deleted ${deletedLogs.count} daily status log(s)`);

  const deletedIssues = await prisma.issue.deleteMany();
  console.log(`Deleted ${deletedIssues.count} issue(s)`);

  const deletedDevices = await prisma.device.deleteMany();
  console.log(`Deleted ${deletedDevices.count} device/inventory unit(s)`);

  const remaining = {
    devices: await prisma.device.count(),
    issues: await prisma.issue.count(),
    dailyStatusLogs: await prisma.dailyStatusLog.count(),
    companies: await prisma.company.count(),
    clients: await prisma.client.count(),
    zones: await prisma.zone.count(),
    users: await prisma.user.count(),
    productCategories: await prisma.productCategory.count(),
  };

  console.log('\nRemaining record counts:');
  console.table(remaining);
}

main()
  .catch((e) => {
    console.error('Error clearing inventory data:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
