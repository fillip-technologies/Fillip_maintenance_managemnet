import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Seeds a full, foreign-key-consistent dataset — at least ~10 rows in every
 * major table — while preserving the exact fixture the smoke/authz suites rely
 * on:
 *   - users priya@cityzoo.com / ravi@cityzoo.com / amit@example.com exist,
 *   - City Zoo's only top-level zone is "North Wing" with a 3-node subtree
 *     (North Wing → Reptile House → Snake Enclosure) — smoke asserts length 3,
 *   - every hardware type carries a "no power" category, so the alphabetically
 *     first type (which the hardware-types list returns as items[0]) always has
 *     a usable category for issue creation.
 *
 * All bulk/variety data lives in nine additional companies/clients so it can
 * never perturb those invariants.
 */
const PASSWORD = 'Password123!';

const daysAgo = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};
const dateOnly = (n) => daysAgo(n).toISOString().slice(0, 10);

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mkUser = (data) => prisma.user.create({ data: { accountStatus: 'active', passwordHash, ...data } });

  // ---------------------------------------------------------------------------
  // 1. Platform owner
  // ---------------------------------------------------------------------------
  await mkUser({ name: 'Super Admin', email: 'super@example.com', role: 'super_admin' });

  // ---------------------------------------------------------------------------
  // 2. Verticals (10) — shared catalogue
  // ---------------------------------------------------------------------------
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
  const verticals = [];
  for (const v of verticalDefs) verticals.push(await prisma.vertical.create({ data: v }));
  const cctvVertical = verticals[0];

  // ---------------------------------------------------------------------------
  // 3. Hardware types (10), each with a "no power" category + type-specific ones
  // ---------------------------------------------------------------------------
  const hardwareDefs = [
    { name: 'CCTV camera', extra: ['lens damage', 'network/connectivity issue'] },
    { name: 'Access control panel', extra: ['card reader fault', 'door lock jammed'] },
    { name: 'Air quality sensor', extra: ['calibration drift', 'sensor offline'] },
    { name: 'Biometric scanner', extra: ['fingerprint read error'] },
    { name: 'Fire alarm panel', extra: ['false alarm', 'battery low'] },
    { name: 'Network switch', extra: ['port down', 'overheating'] },
    { name: 'PA speaker', extra: ['no audio', 'distortion'] },
    { name: 'Router', extra: ['no internet', 'wifi drop'] },
    { name: 'Smoke detector', extra: ['dust fault', 'end-of-life'] },
    { name: 'Thermostat', extra: ['wrong reading', 'unresponsive'] },
  ];
  const hardwareTypes = [];
  for (const h of hardwareDefs) {
    const ht = await prisma.hardwareType.create({
      data: { name: h.name, specFields: { model: 'string', serial: 'string', ip: 'string' } },
    });
    const names = ['no power', ...h.extra];
    await prisma.issueCategory.createMany({
      data: names.map((name) => ({ hardwareTypeId: ht.id, name })),
    });
    const categories = await prisma.issueCategory.findMany({ where: { hardwareTypeId: ht.id } });
    hardwareTypes.push({ ...ht, categories });
  }
  const cctv = hardwareTypes[0];
  const cctvNoPower = cctv.categories.find((c) => c.name === 'no power');

  // ===========================================================================
  // 4. FIXTURE TENANT — City Zoo (must stay exactly as the tests expect)
  // ===========================================================================
  const acme = await prisma.company.create({ data: { name: 'Acme Facilities Group' } });
  const cityZoo = await prisma.client.create({ data: { companyId: acme.id, name: 'City Zoo', type: 'zoo' } });
  await prisma.clientVertical.create({ data: { clientId: cityZoo.id, verticalId: cctvVertical.id, active: true } });

  const priya = await mkUser({ clientId: cityZoo.id, name: 'Priya Singh', email: 'priya@cityzoo.com', role: 'client_admin' });
  const ravi = await mkUser({ clientId: cityZoo.id, name: 'Ravi Kumar', email: 'ravi@cityzoo.com', role: 'zone_incharge' });
  const amitUser = await mkUser({ name: 'Amit Shah', email: 'amit@example.com', role: 'technician' });
  // NOTE: amit's Technician PROFILE is created at the very end of the seed so he
  // stays the newest technician — `GET /technicians` (createdAt desc) returns
  // items[0] = amit, which the smoke suite assigns its test issue to.

  // North Wing is City Zoo's SOLE top-level zone; subtree must be exactly 3.
  const northWing = await prisma.zone.create({ data: { clientId: cityZoo.id, name: 'North Wing', status: 'active', createdById: priya.id } });
  const reptileHouse = await prisma.zone.create({ data: { clientId: cityZoo.id, parentZoneId: northWing.id, name: 'Reptile House', status: 'active', createdById: priya.id } });
  const snakeEnclosure = await prisma.zone.create({ data: { clientId: cityZoo.id, parentZoneId: reptileHouse.id, name: 'Snake Enclosure', status: 'active', createdById: priya.id } });
  await prisma.zoneAssignment.create({ data: { zoneId: northWing.id, userId: ravi.id, role: 'incharge' } });

  // City Zoo devices (all CCTV so any of them has usable categories).
  const zooDevices = [];
  zooDevices.push(await prisma.device.create({ data: { zoneId: snakeEnclosure.id, hardwareTypeId: cctv.id, name: 'Cam - Snake Enclosure East', location: 'east wall, 3m height', status: 'active', addedById: priya.id } }));
  zooDevices.push(await prisma.device.create({ data: { zoneId: reptileHouse.id, hardwareTypeId: cctv.id, name: 'Cam - Reptile House Entry', location: 'entry arch', status: 'active', addedById: priya.id } }));
  zooDevices.push(await prisma.device.create({ data: { zoneId: northWing.id, hardwareTypeId: cctv.id, name: 'Cam - North Wing Gate', location: 'north gate, pole 3', status: 'active', addedById: priya.id } }));

  // A couple of City Zoo issues (with history) + daily logs.
  await seedIssue(zooDevices[1], cctv, ravi.id, { priority: 'high', status: 'open' });
  await seedIssue(zooDevices[2], cctv, ravi.id, { priority: 'low', status: 'open' });
  await prisma.dailyStatusLog.create({ data: { deviceId: zooDevices[0].id, loggedByUserId: ravi.id, status: 'working', logDate: daysAgo(1), notes: 'clear feed' } });
  await prisma.dailyStatusLog.create({ data: { deviceId: zooDevices[1].id, loggedByUserId: ravi.id, status: 'needs_attention', logDate: daysAgo(1), notes: 'slight blur' } });

  // ===========================================================================
  // 5. BULK TENANTS — 9 more companies/clients, each fully wired (FK-correct)
  // ===========================================================================
  const clientBlueprints = [
    { company: 'Metro Malls Pvt Ltd', client: 'Metro Mall', type: 'mall' },
    { company: 'SafeGuard Security', client: 'Harbor Warehouse', type: 'warehouse' },
    { company: 'GreenLeaf Hospitals', client: 'GreenLeaf Hospital', type: 'hospital' },
    { company: 'EduTrust Group', client: 'Sunrise School', type: 'school' },
    { company: 'TransCity Transit', client: 'Central Metro Station', type: 'transit' },
    { company: 'Skyline Realty', client: 'Skyline Towers', type: 'residential' },
    { company: 'FreshFoods Retail', client: 'FreshFoods Superstore', type: 'retail' },
    { company: 'PowerGrid Utilities', client: 'North Substation', type: 'utility' },
    { company: 'Coastal Resorts', client: 'Coastal Resort', type: 'hospitality' },
  ];

  for (let k = 0; k < clientBlueprints.length; k++) {
    const bp = clientBlueprints[k];
    const company = await prisma.company.create({ data: { name: bp.company } });
    const client = await prisma.client.create({ data: { companyId: company.id, name: bp.client, type: bp.type } });

    // Link two verticals per client for variety.
    await prisma.clientVertical.create({ data: { clientId: client.id, verticalId: cctvVertical.id, active: true } });
    await prisma.clientVertical.create({ data: { clientId: client.id, verticalId: verticals[(k % (verticals.length - 1)) + 1].id, active: true } });

    const admin = await mkUser({ clientId: client.id, name: `${bp.client} Admin`, email: `admin${k + 1}@client${k + 1}.com`, role: 'client_admin' });
    const incharge = await mkUser({ clientId: client.id, name: `${bp.client} Incharge`, email: `incharge${k + 1}@client${k + 1}.com`, role: 'zone_incharge' });
    const staff = await mkUser({ clientId: client.id, name: `${bp.client} Staff`, email: `staff${k + 1}@client${k + 1}.com`, role: 'zone_staff' });
    const techUser = await mkUser({ name: `Tech ${k + 1}`, email: `tech${k + 1}@example.com`, role: 'technician' });
    const technician = await prisma.technician.create({ data: { userId: techUser.id, specialization: k % 2 ? 'Electrical' : 'Networking' } });

    // Root zone + one sub-zone.
    const rootZone = await prisma.zone.create({ data: { clientId: client.id, name: 'Main Block', status: 'active', createdById: admin.id } });
    const subZone = await prisma.zone.create({ data: { clientId: client.id, parentZoneId: rootZone.id, name: 'Level 1', status: 'active', createdById: admin.id } });

    await prisma.zoneAssignment.create({ data: { zoneId: rootZone.id, userId: incharge.id, role: 'incharge' } });
    await prisma.zoneAssignment.create({ data: { zoneId: subZone.id, userId: staff.id, role: 'staff' } });
    await prisma.technicianAssignment.create({ data: { technicianId: technician.id, zoneId: rootZone.id } });

    // Two devices of rotating hardware types.
    const htA = hardwareTypes[(k + 1) % hardwareTypes.length];
    const htB = hardwareTypes[(k + 4) % hardwareTypes.length];
    const devA = await prisma.device.create({ data: { zoneId: rootZone.id, hardwareTypeId: htA.id, name: `${htA.name} #${k + 1}A`, location: 'main entrance', status: 'active', addedById: admin.id } });
    const devB = await prisma.device.create({ data: { zoneId: subZone.id, hardwareTypeId: htB.id, name: `${htB.name} #${k + 1}B`, location: 'level 1 corridor', status: 'provisioned', addedById: admin.id } });

    // Two issues per client, one open, one carried through to resolved.
    await seedIssue(devA, htA, incharge.id, { priority: k % 2 ? 'critical' : 'low', status: 'open' });
    await seedIssue(devB, htB, staff.id, { priority: 'medium', status: 'resolved', technicianId: technician.id });

    // Two daily logs on distinct dates.
    await prisma.dailyStatusLog.create({ data: { deviceId: devA.id, loggedByUserId: staff.id, status: 'working', logDate: daysAgo(2), notes: 'ok' } });
    await prisma.dailyStatusLog.create({ data: { deviceId: devA.id, loggedByUserId: staff.id, status: 'not_working', logDate: daysAgo(1), notes: 'went dark' } });
  }

  // ---------------------------------------------------------------------------
  // 6. Amit's technician profile LAST → newest technician (smoke invariant).
  //    Client-wide City Zoo coverage + one assigned issue for a non-empty queue.
  // ---------------------------------------------------------------------------
  const amit = await prisma.technician.create({ data: { userId: amitUser.id, specialization: 'CCTV / networking' } });
  await prisma.technicianAssignment.create({ data: { technicianId: amit.id, clientId: cityZoo.id } });
  await seedIssue(zooDevices[0], cctv, ravi.id, { priority: 'medium', status: 'assigned', technicianId: amit.id });

  await report();
}

/**
 * Create an issue with a valid category for its device's hardware type, plus a
 * consistent issue_status_history trail up to the requested status.
 */
async function seedIssue(device, hardwareType, raisedByUserId, { priority = 'medium', status = 'open', technicianId = null }) {
  const category = hardwareType.categories?.[0]
    ?? (await prisma.issueCategory.findFirst({ where: { hardwareTypeId: hardwareType.id } }));

  const now = new Date();
  const issue = await prisma.issue.create({
    data: {
      deviceId: device.id,
      categoryId: category.id,
      raisedByUserId,
      assignedTechnicianId: ['assigned', 'in_progress', 'resolved', 'closed'].includes(status) ? technicianId : null,
      priority,
      status,
      description: `Seeded issue: ${category.name} on ${device.name}`,
      resolvedAt: ['resolved', 'closed'].includes(status) ? now : null,
      closedAt: status === 'closed' ? now : null,
    },
  });

  // Build the history chain that leads to `status`.
  const chain = ['open'];
  if (status !== 'open') chain.push('assigned');
  if (['in_progress', 'resolved', 'closed'].includes(status)) chain.push('in_progress');
  if (['resolved', 'closed'].includes(status)) chain.push('resolved');
  if (status === 'closed') chain.push('closed');

  let from = null;
  for (const to of chain) {
    await prisma.issueStatusHistory.create({
      data: { issueId: issue.id, fromStatus: from, toStatus: to, changedByUserId: raisedByUserId },
    });
    from = to;
  }
  return issue;
}

async function report() {
  const [companies, clients, verticals, users, technicians, zones, devices, issues, logs, cats, history, zAssign, tAssign] =
    await Promise.all([
      prisma.company.count(),
      prisma.client.count(),
      prisma.vertical.count(),
      prisma.user.count(),
      prisma.technician.count(),
      prisma.zone.count(),
      prisma.device.count(),
      prisma.issue.count(),
      prisma.dailyStatusLog.count(),
      prisma.issueCategory.count(),
      prisma.issueStatusHistory.count(),
      prisma.zoneAssignment.count(),
      prisma.technicianAssignment.count(),
    ]);
  // eslint-disable-next-line no-console
  console.log('✅ Seed complete. Row counts:');
  // eslint-disable-next-line no-console
  console.table({ companies, clients, verticals, users, technicians, zones, devices, issues, dailyLogs: logs, issueCategories: cats, issueHistory: history, zoneAssignments: zAssign, technicianAssignments: tAssign });
  // eslint-disable-next-line no-console
  console.log(`Login with any seeded email / "${PASSWORD}" — e.g. super@example.com | priya@cityzoo.com | ravi@cityzoo.com | amit@example.com | admin1@client1.com`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
