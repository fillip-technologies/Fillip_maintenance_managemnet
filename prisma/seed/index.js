import { seedClients } from './client.seed.js';
import { seedProducts } from './product.seed.js';
import { seedZones } from './zone.seed.js';
import { seedCameras } from './camera.seed.js';

/**
 * Master Seed Orchestrator.
 * Executes modular seed files in strict relational order.
 */
export async function runSeed(prisma) {
  console.log('🚀 Starting Modular Database Seeder...\n');

  // 1. Client & Company
  const { company, client, superAdmin, verticals } = await seedClients(prisma);

  // 2. Product Categories, Types, and Hardware Types
  const products = await seedProducts(prisma);

  // 3. Zones & Sub-locations
  const zones = await seedZones(prisma, { client, superAdmin });

  // 4. Cameras (all status: 'active', 0 issues)
  const cameras = await seedCameras(prisma, {
    company,
    client,
    superAdmin,
    products,
    zones,
  });

  // Database verification metrics
  const [
    companyCount,
    clientCount,
    topLevelZoneCount,
    totalZoneCount,
    categoryCount,
    productTypeCount,
    deviceCount,
    activeDeviceCount,
    issueCount,
  ] = await Promise.all([
    prisma.company.count(),
    prisma.client.count(),
    prisma.zone.count({ where: { parentZoneId: null } }),
    prisma.zone.count(),
    prisma.productCategory.count(),
    prisma.productType.count(),
    prisma.device.count(),
    prisma.device.count({ where: { status: 'active' } }),
    prisma.issue.count(),
  ]);

  console.log('\n🎉 Modular Seeding Completed Successfully!');
  console.table({
    'Companies': companyCount,
    'Clients': clientCount,
    'Top-Level Zones': topLevelZoneCount,
    'Total Zones (inc. sublocations)': totalZoneCount,
    'Product Categories': categoryCount,
    'Product Types': productTypeCount,
    'Total Cameras (Devices)': deviceCount,
    'Active / Working Cameras': activeDeviceCount,
    'Open Issues': issueCount,
  });

  console.log(`\n🔑 Super Admin Login: super@example.com / Password123!`);
  console.log(`📍 Client Facility: ${client.name} (${client.id})`);
}
