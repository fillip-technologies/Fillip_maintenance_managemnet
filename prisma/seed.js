import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const PASSWORD = 'Password123!';

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // 1. Super admin (platform owner). Company is created automatically on first client creation.
  await prisma.user.create({
    data: {
      name: 'Super Admin',
      email: 'super@example.com',
      passwordHash,
      role: 'super_admin',
      accountStatus: 'active',
    },
  });

  // 3. Verticals catalogue.
  const verticalDefs = [
    { key: 'hardware-cctv', name: 'Hardware / CCTV' },
    { key: 'hvac', name: 'HVAC' },
    { key: 'fire-safety', name: 'Fire Safety' },
    { key: 'access-control', name: 'Access Control' },
    { key: 'networking', name: 'Networking' },
    { key: 'elevators', name: 'Elevators' },
    { key: 'plumbing', name: 'Plumbing' },
    { key: 'electrical', name: 'Electrical' },
    { key: 'solar', name: 'Solar Power' },
    { key: 'water-management', name: 'Water Management' },
  ];
  for (const v of verticalDefs) await prisma.vertical.create({ data: v });

  // 4. Product categories (device catalogue, code = unique ID prefix).
  const productCategoryDefs = [
    { name: 'CCTV Camera', code: 'CAM' },
    { name: 'Access Control', code: 'ACS' },
    { name: 'Fire Alarm', code: 'FIR' },
    { name: 'Network Device', code: 'NET' },
    { name: 'HVAC Unit', code: 'HVC' },
    { name: 'PA System', code: 'PAS' },
    { name: 'Sensor', code: 'SEN' },
  ];
  for (const pc of productCategoryDefs) await prisma.productCategory.create({ data: pc });

  // 5. Hardware types.
  const hardwareTypeDefs = [
    { name: 'CCTV Camera', specFields: { model: 'string', serial: 'string', ip: 'string', resolution: 'string' } },
    { name: 'Access Control Panel', specFields: { model: 'string', serial: 'string', readers: 'number' } },
    { name: 'Air Quality Sensor', specFields: { model: 'string', serial: 'string' } },
    { name: 'Biometric Scanner', specFields: { model: 'string', serial: 'string' } },
    { name: 'Fire Alarm Panel', specFields: { model: 'string', serial: 'string', zones: 'number' } },
    { name: 'Network Switch', specFields: { model: 'string', serial: 'string', ports: 'number' } },
    { name: 'PA Speaker', specFields: { model: 'string', serial: 'string', wattage: 'number' } },
    { name: 'Router', specFields: { model: 'string', serial: 'string', ip: 'string' } },
    { name: 'Smoke Detector', specFields: { model: 'string', serial: 'string' } },
    { name: 'Thermostat', specFields: { model: 'string', serial: 'string' } },
  ];
  for (const ht of hardwareTypeDefs) await prisma.hardwareType.create({ data: ht });

  // 6. Global issue categories (categoryId = null → applies to any device type).
  const globalIssueCategories = [
    'Not working',
    'Physical damage',
    'Power failure',
    'Network / connectivity issue',
    'Sensor malfunction',
    'Software / firmware error',
    'Overheating',
    'Needs inspection',
  ];
  for (const name of globalIssueCategories) {
    await prisma.issueCategory.create({ data: { name } });
  }

  const [users, verticals, productCategories, hardwareTypes, issueCategories] =
    await Promise.all([
      prisma.user.count(),
      prisma.vertical.count(),
      prisma.productCategory.count(),
      prisma.hardwareType.count(),
      prisma.issueCategory.count(),
    ]);

  console.log('✅ Seed complete. Row counts:');
  console.table({ users, verticals, productCategories, hardwareTypes, issueCategories });
  console.log(`\n   Login : super@example.com / ${PASSWORD}`);
  console.log(`   Note  : "Fillip Technologies" company is created automatically on first client creation.`);
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
