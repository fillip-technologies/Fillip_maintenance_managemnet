import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Seeds a complete slice of the hierarchy so the API is demoable out of the box.
 * Every user shares the password below.
 */
const PASSWORD = 'Password123!';

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const superAdmin = await prisma.user.create({
    data: { name: 'Super Admin', email: 'super@example.com', role: 'super_admin', accountStatus: 'active', passwordHash },
  });

  const company = await prisma.company.create({ data: { name: 'Acme Facilities Group' } });

  const vertical = await prisma.vertical.create({
    data: { key: 'hardware-cctv', name: 'Hardware / CCTV' },
  });

  const client = await prisma.client.create({
    data: { companyId: company.id, name: 'City Zoo', type: 'zoo' },
  });

  await prisma.clientVertical.create({
    data: { clientId: client.id, verticalId: vertical.id, active: true },
  });

  const clientAdmin = await prisma.user.create({
    data: {
      companyId: company.id,
      clientId: client.id,
      name: 'Priya Singh',
      email: 'priya@cityzoo.com',
      role: 'client_admin',
      accountStatus: 'active',
      passwordHash,
    },
  });

  const incharge = await prisma.user.create({
    data: {
      clientId: client.id,
      name: 'Ravi Kumar',
      email: 'ravi@cityzoo.com',
      role: 'zone_incharge',
      accountStatus: 'active',
      passwordHash,
    },
  });

  const techUser = await prisma.user.create({
    data: { name: 'Amit Shah', email: 'amit@example.com', role: 'technician', accountStatus: 'active', passwordHash },
  });
  const technician = await prisma.technician.create({
    data: { userId: techUser.id, specialization: 'CCTV / networking' },
  });

  const cctv = await prisma.hardwareType.create({
    data: { name: 'CCTV camera', specFields: { resolution: 'string', lens: 'string', ip: 'string' } },
  });
  await prisma.issueCategory.createMany({
    data: [
      { hardwareTypeId: cctv.id, name: 'no power' },
      { hardwareTypeId: cctv.id, name: 'lens damage' },
      { hardwareTypeId: cctv.id, name: 'network/connectivity issue' },
    ],
  });

  // North Wing → Reptile House → Snake Enclosure
  const northWing = await prisma.zone.create({
    data: { clientId: client.id, name: 'North Wing', status: 'active', createdById: clientAdmin.id },
  });
  const reptileHouse = await prisma.zone.create({
    data: { clientId: client.id, parentZoneId: northWing.id, name: 'Reptile House', status: 'active', createdById: clientAdmin.id },
  });
  const snakeEnclosure = await prisma.zone.create({
    data: { clientId: client.id, parentZoneId: reptileHouse.id, name: 'Snake Enclosure', status: 'active', createdById: clientAdmin.id },
  });

  await prisma.zoneAssignment.create({
    data: { zoneId: northWing.id, userId: incharge.id, role: 'incharge' },
  });
  await prisma.technicianAssignment.create({
    data: { technicianId: technician.id, clientId: client.id },
  });

  await prisma.device.create({
    data: {
      zoneId: snakeEnclosure.id,
      hardwareTypeId: cctv.id,
      name: 'Cam - Snake Enclosure East',
      location: 'east wall, 3m height',
      status: 'active',
      addedById: clientAdmin.id,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`✅ Seed complete. Login with any seeded email / "${PASSWORD}"`);
  // eslint-disable-next-line no-console
  console.log(`   super_admin: super@example.com | client_admin: priya@cityzoo.com | incharge: ravi@cityzoo.com | technician: amit@example.com`);
  void superAdmin;
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
