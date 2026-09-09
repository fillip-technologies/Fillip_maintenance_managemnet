import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Existing user IDs (kept from DB)
const USERS = {
  superAdmin:   '3c1df13b-b01f-467a-85eb-3f6ad5e85890',
  clientAdmin:  'f85242aa-94f4-4a84-a1f8-abbde2707028', // dfo@gmail.com
  zoneIncharge1:'0f30c37f-7980-4ac3-b5db-d769fef2ac66', // Aman
  zoneIncharge2:'455b59f9-87ff-4beb-97fc-b27a89e45e97', // Abhi
  staff:        '020667ba-3d89-4396-aba4-713a1c96da43', // Staff
  technician:   '33cf142d-c6f6-403f-b7b2-b638cbde0327', // raju mistri
};

async function reserveCode(tx, categoryId, count) {
  const rows = await tx.$queryRaw`
    UPDATE product_categories SET last_seq = last_seq + ${count}
    WHERE id = ${categoryId}::uuid RETURNING code, last_seq`;
  const { code, last_seq } = rows[0];
  const end = Number(last_seq);
  const start = end - count + 1;
  const codes = [];
  for (let n = start; n <= end; n++) codes.push(`${code}-${String(n).padStart(6, '0')}`);
  return codes;
}

async function main() {
  // ── 1. Company ──────────────────────────────────────────────────────────────
  console.log('Creating company...');
  const company = await prisma.company.create({
    data: { name: 'Fixly Operations Pvt. Ltd.' },
    select: { id: true }
  });
  console.log(' Company:', company.id);

  // ── 2. Client ───────────────────────────────────────────────────────────────
  console.log('Creating client...');
  const client = await prisma.client.create({
    data: {
      name: 'DFO Wildlife Campus',
      companyId: company.id,
      facilityName: 'Main Campus',
      location: 'Delhi',
    },
    select: { id: true }
  });
  console.log(' Client:', client.id);

  // ── 3. Zones ────────────────────────────────────────────────────────────────
  console.log('Creating zones...');
  const zoneNames = ['Elephant Zone','Zebra Zone','Monkey Zone','Peacock Zone','Tiger Zone','Bear Zone'];
  const zones = [];
  for (const name of zoneNames) {
    const z = await prisma.zone.create({
      data: { name, clientId: client.id, createdById: USERS.superAdmin, status: 'active' },
      select: { id: true, name: true }
    });
    zones.push(z);
    console.log(' Zone:', z.name, z.id);
  }

  // ── 4. Assign users to client ────────────────────────────────────────────────
  console.log('Assigning users...');
  await prisma.user.update({ where: { id: USERS.clientAdmin },   data: { clientId: client.id, companyId: company.id } });
  await prisma.user.update({ where: { id: USERS.zoneIncharge1 }, data: { clientId: client.id, companyId: company.id } });
  await prisma.user.update({ where: { id: USERS.zoneIncharge2 }, data: { clientId: client.id, companyId: company.id } });
  await prisma.user.update({ where: { id: USERS.staff },         data: { clientId: client.id, companyId: company.id } });

  // Zone assignments
  await prisma.zoneAssignment.createMany({ data: [
    { zoneId: zones[0].id, userId: USERS.zoneIncharge1, role: 'incharge' },
    { zoneId: zones[1].id, userId: USERS.zoneIncharge2, role: 'incharge' },
    { zoneId: zones[0].id, userId: USERS.staff,         role: 'staff' },
  ]});

  // Technician
  const tech = await prisma.technician.create({
    data: { userId: USERS.technician, specialization: 'CCTV & Networking' },
    select: { id: true }
  });
  await prisma.technicianAssignment.create({
    data: { technicianId: tech.id, clientId: client.id }
  });
  console.log(' Users assigned');

  // ── 5. Product Categories ───────────────────────────────────────────────────
  console.log('Creating categories...');
  const catData = [
    { name: 'Camera',           code: 'CAM' },
    { name: 'Network Switch',   code: 'NSW' },
    { name: 'Optical Fibre',    code: 'OFC' },
    { name: 'Router',           code: 'RTR' },
    { name: 'LED Display',      code: 'LED' },
    { name: 'Monitor',          code: 'MON' },
    { name: 'Fire Alarm',       code: 'FIR' },
    { name: 'HVAC Unit',        code: 'HVC' },
    { name: 'PA System',        code: 'PAS' },
    { name: 'Sensor',           code: 'SEN' },
    { name: 'UPS & Power',      code: 'UPS' },
    { name: 'Access Control',   code: 'ACS' },
  ];
  const cats = {};
  for (const c of catData) {
    const created = await prisma.productCategory.create({ data: c, select: { id: true, name: true, code: true } });
    cats[c.name] = created;
    console.log(' Category:', created.name);
  }

  // ── 6. Product Types ────────────────────────────────────────────────────────
  console.log('Creating product types...');
  const ptData = [
    // Camera
    { cat: 'Camera',         name: 'Fixed Dome Camera' },
    { cat: 'Camera',         name: 'PTZ Camera' },
    { cat: 'Camera',         name: 'Thermal Camera' },
    { cat: 'Camera',         name: 'Bullet Camera' },
    { cat: 'Camera',         name: 'LPR Camera' },
    { cat: 'Camera',         name: 'ANPR Camera' },
    { cat: 'Camera',         name: 'Fisheye Camera' },
    // Network Switch
    { cat: 'Network Switch', name: '8-Port PoE Switch' },
    { cat: 'Network Switch', name: '24-Port Switch' },
    { cat: 'Network Switch', name: '48-Port Managed Switch' },
    { cat: 'Network Switch', name: 'Core Switch' },
    // Optical Fibre
    { cat: 'Optical Fibre',  name: 'Single Mode Fiber Link' },
    { cat: 'Optical Fibre',  name: 'Multi Mode Fiber Link' },
    { cat: 'Optical Fibre',  name: 'Fiber Patch Panel' },
    // Router
    { cat: 'Router',         name: 'Wireless Router' },
    { cat: 'Router',         name: 'Core Router' },
    { cat: 'Router',         name: 'Edge Router' },
    // LED Display
    { cat: 'LED Display',    name: '32" LED Display' },
    { cat: 'LED Display',    name: '55" LED Display' },
    { cat: 'LED Display',    name: '75" LED Display' },
    // Monitor
    { cat: 'Monitor',        name: 'HD Monitor 24"' },
    { cat: 'Monitor',        name: '4K Monitor 27"' },
    { cat: 'Monitor',        name: 'Curved Monitor 32"' },
    // Fire Alarm
    { cat: 'Fire Alarm',     name: 'Smoke Detector' },
    { cat: 'Fire Alarm',     name: 'Heat Detector' },
    { cat: 'Fire Alarm',     name: 'Fire Control Panel' },
    // HVAC
    { cat: 'HVAC Unit',      name: 'Split AC' },
    { cat: 'HVAC Unit',      name: 'Cassette AC' },
    { cat: 'HVAC Unit',      name: 'Air Handling Unit' },
    // PA System
    { cat: 'PA System',      name: 'Speaker' },
    { cat: 'PA System',      name: 'Amplifier' },
    { cat: 'PA System',      name: 'Microphone' },
    // Sensor
    { cat: 'Sensor',         name: 'Motion Sensor' },
    { cat: 'Sensor',         name: 'Temperature Sensor' },
    { cat: 'Sensor',         name: 'Humidity Sensor' },
    // UPS
    { cat: 'UPS & Power',    name: 'Online UPS 1KVA' },
    { cat: 'UPS & Power',    name: 'Online UPS 3KVA' },
    { cat: 'UPS & Power',    name: 'Battery Bank' },
    // Access Control
    { cat: 'Access Control', name: 'Biometric Reader' },
    { cat: 'Access Control', name: 'Card Reader' },
    { cat: 'Access Control', name: 'Electric Door Lock' },
  ];
  const pts = {};
  for (const p of ptData) {
    const created = await prisma.productType.create({
      data: { categoryId: cats[p.cat].id, name: p.name },
      select: { id: true, name: true, categoryId: true }
    });
    pts[`${p.cat}::${p.name}`] = created;
  }
  console.log(` Created ${ptData.length} product types`);

  // ── 7. Devices (sample data) ────────────────────────────────────────────────
  console.log('Creating devices...');
  const Z = zones.map(z => z.id);
  const CID = company.id;

  const plan = [
    // Camera - Fixed Dome
    ['Camera','Fixed Dome Camera', Z[0],'active',8],
    ['Camera','Fixed Dome Camera', Z[1],'active',6],
    ['Camera','Fixed Dome Camera', Z[2],'faulty',2],
    // Camera - PTZ
    ['Camera','PTZ Camera',        Z[0],'active',3],
    ['Camera','PTZ Camera',        Z[3],'active',2],
    ['Camera','PTZ Camera',        Z[4],'under_maintenance',1],
    // Camera - Thermal
    ['Camera','Thermal Camera',    Z[1],'active',4],
    ['Camera','Thermal Camera',    Z[5],'active',3],
    ['Camera','Thermal Camera',    Z[2],'faulty',1],
    // Camera - LPR
    ['Camera','LPR Camera',        Z[0],'active',5],
    ['Camera','LPR Camera',        Z[4],'active',4],
    // Camera - Bullet
    ['Camera','Bullet Camera',     Z[3],'active',4],
    ['Camera','Bullet Camera',     Z[5],'active',3],
    // Camera - ANPR
    ['Camera','ANPR Camera',       Z[0],'active',3],
    ['Camera','ANPR Camera',       Z[1],'under_maintenance',1],
    // Camera - stock
    ['Camera','Fixed Dome Camera', null,'provisioned',4],
    ['Camera','Thermal Camera',    null,'provisioned',2],
    // Network Switch
    ['Network Switch','24-Port Switch',          Z[0],'active',2],
    ['Network Switch','24-Port Switch',          Z[1],'active',2],
    ['Network Switch','48-Port Managed Switch',  Z[2],'active',1],
    ['Network Switch','Core Switch',             Z[3],'active',1],
    ['Network Switch','8-Port PoE Switch',       Z[4],'faulty',1],
    ['Network Switch','24-Port Switch',          null,'provisioned',2],
    // Optical Fibre
    ['Optical Fibre','Single Mode Fiber Link',   Z[0],'active',3],
    ['Optical Fibre','Multi Mode Fiber Link',    Z[1],'active',3],
    ['Optical Fibre','Fiber Patch Panel',        Z[2],'active',2],
    ['Optical Fibre','Single Mode Fiber Link',   Z[3],'faulty',1],
    // Router
    ['Router','Core Router',                     Z[0],'active',2],
    ['Router','Edge Router',                     Z[1],'active',2],
    ['Router','Wireless Router',                 Z[2],'active',2],
    ['Router','Wireless Router',                 Z[3],'under_maintenance',1],
    // LED Display
    ['LED Display','55" LED Display',            Z[0],'active',2],
    ['LED Display','75" LED Display',            Z[1],'active',1],
    ['LED Display','32" LED Display',            Z[2],'active',2],
    ['LED Display','55" LED Display',            Z[3],'faulty',1],
    // Monitor
    ['Monitor','HD Monitor 24"',                 Z[0],'active',3],
    ['Monitor','4K Monitor 27"',                 Z[1],'active',3],
    ['Monitor','Curved Monitor 32"',             Z[2],'active',2],
    ['Monitor','HD Monitor 24"',                 Z[3],'under_maintenance',1],
    ['Monitor','4K Monitor 27"',                 null,'provisioned',3],
    // Fire Alarm
    ['Fire Alarm','Smoke Detector',              Z[0],'active',4],
    ['Fire Alarm','Heat Detector',               Z[1],'active',3],
    ['Fire Alarm','Fire Control Panel',          Z[0],'active',1],
    ['Fire Alarm','Smoke Detector',              Z[2],'faulty',1],
    // HVAC
    ['HVAC Unit','Split AC',                     Z[0],'active',3],
    ['HVAC Unit','Cassette AC',                  Z[1],'active',2],
    ['HVAC Unit','Air Handling Unit',            Z[2],'active',1],
    ['HVAC Unit','Split AC',                     null,'provisioned',2],
    // PA System
    ['PA System','Speaker',                      Z[0],'active',4],
    ['PA System','Amplifier',                    Z[0],'active',1],
    ['PA System','Speaker',                      Z[1],'active',3],
    ['PA System','Microphone',                   Z[2],'faulty',1],
    // Sensor
    ['Sensor','Motion Sensor',                   Z[0],'active',5],
    ['Sensor','Temperature Sensor',              Z[1],'active',3],
    ['Sensor','Humidity Sensor',                 Z[2],'active',2],
    ['Sensor','Motion Sensor',                   Z[3],'faulty',1],
    // UPS
    ['UPS & Power','Online UPS 1KVA',            Z[0],'active',2],
    ['UPS & Power','Online UPS 3KVA',            Z[1],'active',1],
    ['UPS & Power','Battery Bank',               Z[0],'active',1],
    // Access Control
    ['Access Control','Biometric Reader',        Z[0],'active',3],
    ['Access Control','Card Reader',             Z[1],'active',2],
    ['Access Control','Electric Door Lock',      Z[2],'active',2],
    ['Access Control','Biometric Reader',        null,'provisioned',2],
  ];

  let totalDevices = 0;
  for (const [catName, ptName, zoneId, status, qty] of plan) {
    const cat = cats[catName];
    const pt  = pts[`${catName}::${ptName}`];
    if (!cat || !pt) { console.warn('SKIP', catName, ptName); continue; }
    await prisma.$transaction(async (tx) => {
      const codes = await reserveCode(tx, cat.id, qty);
      await tx.device.createMany({
        data: codes.map(code => ({
          code, name: ptName, categoryId: cat.id, productTypeId: pt.id,
          zoneId: zoneId ?? null, companyId: CID, status,
        }))
      });
    });
    totalDevices += qty;
  }
  console.log(` Created ${totalDevices} devices`);
  console.log('\n✅ DONE! Log out and log back in to refresh your session.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
