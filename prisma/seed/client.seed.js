import bcrypt from 'bcryptjs';

const DEFAULT_PASSWORD = 'Password123!';

/**
 * Seeds Platform Super Admin, Verticals, Company, and Client.
 * Fully idempotent (safe to re-run).
 */
export async function seedClients(prisma) {
  console.log('🏢 [1/4] Seeding Super Admin, Company, Client, and Verticals...');

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  // 1. Super Admin User
  const superAdmin = await prisma.user.upsert({
    where: { email: 'super@example.com' },
    update: {},
    create: {
      name: 'Super Admin',
      email: 'super@example.com',
      passwordHash,
      role: 'super_admin',
      accountStatus: 'active',
    },
  });

  // 2. Verticals
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

  const verticals = {};
  for (const v of verticalDefs) {
    verticals[v.key] = await prisma.vertical.upsert({
      where: { key: v.key },
      update: { name: v.name },
      create: v,
    });
  }

  // 3. Company
  let company = await prisma.company.findFirst({
    where: { name: { contains: 'Rajgir', mode: 'insensitive' } },
  });

  if (!company) {
    company = await prisma.company.create({
      data: {
        name: 'Rajgir Zoo Safari',
        status: 'active',
      },
    });
  }

  // 4. Client
  let client = await prisma.client.findFirst({
    where: {
      companyId: company.id,
      name: { contains: 'Rajgir', mode: 'insensitive' },
    },
  });

  if (!client) {
    client = await prisma.client.create({
      data: {
        companyId: company.id,
        name: 'Rajgir Zoo Safari',
        facilityName: 'Rajgir Nature & Zoo Safari',
        location: 'Rajgir, Bihar, India',
        type: 'Zoo & Safari Park',
      },
    });
  }

  // 5. Client Vertical toggle (Hardware / CCTV active)
  if (verticals['hardware-cctv']) {
    await prisma.clientVertical.upsert({
      where: {
        clientId_verticalId: {
          clientId: client.id,
          verticalId: verticals['hardware-cctv'].id,
        },
      },
      update: { active: true },
      create: {
        clientId: client.id,
        verticalId: verticals['hardware-cctv'].id,
        active: true,
      },
    });
  }

  console.log(`   ✓ Company: "${company.name}" (${company.id})`);
  console.log(`   ✓ Client:  "${client.name}" (${client.id})`);
  console.log(`   ✓ Super Admin: ${superAdmin.email}`);

  return { company, client, superAdmin, verticals };
}
