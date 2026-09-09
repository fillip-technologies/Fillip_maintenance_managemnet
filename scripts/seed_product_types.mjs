import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const COMPANY_ID = '414ae583-2041-4505-8b19-582f3f363db8';

const ZONES = [
  '33be3367-21a7-4119-8125-2e4c3376f00d', // ELEPHANT ZONE
  '4b1ad997-c5a4-4cf2-ae0e-80495a37673e', // ZEBRA ZONE
  '7328d5e5-1641-4f22-904c-d8559b8c367b', // MONKEY ZONE
  '94c056c9-4b6c-48ae-9e5e-892ba3e812ba', // PEAKCOCK IMAGE
  'a40fe182-c44c-4119-afc6-8eb8521d1fec', // TIGER ZONE
  'a413ca2a-102e-4049-a4b2-bbeb2cb37f52', // BEAR ZONE
];

// Category IDs from DB
const CATS = {
  camera:   '0b199d7f-1a5e-45ce-8715-b785d1a6fd8e',
  ptz:      '8ee4af6e-d465-450e-b3d4-33206a374319',
  lpr:      'c0f599c9-9536-4b51-b37a-5f5aa662bac3',
  network:  '9ee4b3a7-191d-45c1-9fac-6ba053b1297d',
  fibre:    '77c1b8c2-0cbc-4d11-895c-b6f2123ae9ee',
  router:   '44243f09-fdfb-4d88-a7a5-c7b47e99349e',
  led:      '4468c138-93a1-45af-870c-b30fba423b48',
  monitor:  '5db36fd9-979b-4a40-86f6-644ed0c4e35c',
  fire:     '8c03fa9d-20a3-4e0f-a739-ac616b970414',
  hvac:     '5858c23f-33ef-4edf-90d2-11c73c24f1b5',
  pa:       'f327e0f5-b64d-44d5-8cae-67495e9b49f2',
  sensor:   '678abd18-0534-4f2d-9fbb-ada8d224ab3e',
};

// Product types per category
const PRODUCT_TYPES = [
  // Camera
  { categoryId: CATS.camera,  name: 'Fixed Dome Camera' },
  { categoryId: CATS.camera,  name: 'PTZ Camera' },
  { categoryId: CATS.camera,  name: 'Thermal Camera' },
  { categoryId: CATS.camera,  name: 'Bullet Camera' },
  { categoryId: CATS.camera,  name: 'LPR Camera' },
  { categoryId: CATS.camera,  name: 'ANPR Camera' },
  { categoryId: CATS.camera,  name: 'Fisheye Camera' },

  // PTZ
  { categoryId: CATS.ptz,     name: 'Speed Dome PTZ' },
  { categoryId: CATS.ptz,     name: 'Mini PTZ' },
  { categoryId: CATS.ptz,     name: 'Outdoor PTZ' },

  // LPR Camera
  { categoryId: CATS.lpr,     name: 'LPR Camera' },
  { categoryId: CATS.lpr,     name: 'ANPR Camera' },

  // Network Switches
  { categoryId: CATS.network, name: '8-Port PoE Switch' },
  { categoryId: CATS.network, name: '24-Port Switch' },
  { categoryId: CATS.network, name: '48-Port Managed Switch' },
  { categoryId: CATS.network, name: 'Core Switch' },

  // Optical Fibre
  { categoryId: CATS.fibre,   name: 'Single Mode Fiber Link' },
  { categoryId: CATS.fibre,   name: 'Multi Mode Fiber Link' },
  { categoryId: CATS.fibre,   name: 'Fiber Patch Panel' },

  // Routers
  { categoryId: CATS.router,  name: 'Wireless Router' },
  { categoryId: CATS.router,  name: 'Core Router' },
  { categoryId: CATS.router,  name: 'Edge Router' },

  // LED TV
  { categoryId: CATS.led,     name: '32" LED Display' },
  { categoryId: CATS.led,     name: '55" LED Display' },
  { categoryId: CATS.led,     name: '75" LED Display' },

  // Monitor
  { categoryId: CATS.monitor, name: 'HD Monitor 24"' },
  { categoryId: CATS.monitor, name: '4K Monitor 27"' },
  { categoryId: CATS.monitor, name: 'Curved Monitor 32"' },

  // Fire Alarm
  { categoryId: CATS.fire,    name: 'Smoke Detector' },
  { categoryId: CATS.fire,    name: 'Heat Detector' },
  { categoryId: CATS.fire,    name: 'Fire Control Panel' },

  // HVAC
  { categoryId: CATS.hvac,    name: 'Split AC' },
  { categoryId: CATS.hvac,    name: 'Cassette AC' },
  { categoryId: CATS.hvac,    name: 'Air Handling Unit' },

  // PA System
  { categoryId: CATS.pa,      name: 'Speaker' },
  { categoryId: CATS.pa,      name: 'Amplifier' },
  { categoryId: CATS.pa,      name: 'Microphone' },

  // Sensor
  { categoryId: CATS.sensor,  name: 'Motion Sensor' },
  { categoryId: CATS.sensor,  name: 'Temperature Sensor' },
  { categoryId: CATS.sensor,  name: 'Humidity Sensor' },
];

// Devices to create: [categoryId, productTypeName, zone (null = stock), status, qty]
const DEVICE_PLAN = [
  // Camera - Fixed Dome (most common)
  [CATS.camera, 'Fixed Dome Camera',    ZONES[0], 'active',            8],
  [CATS.camera, 'Fixed Dome Camera',    ZONES[1], 'active',            6],
  [CATS.camera, 'Fixed Dome Camera',    ZONES[2], 'faulty',            2],
  // Camera - PTZ
  [CATS.camera, 'PTZ Camera',           ZONES[0], 'active',            3],
  [CATS.camera, 'PTZ Camera',           ZONES[3], 'active',            2],
  [CATS.camera, 'PTZ Camera',           ZONES[4], 'under_maintenance', 1],
  // Camera - Thermal
  [CATS.camera, 'Thermal Camera',       ZONES[1], 'active',            4],
  [CATS.camera, 'Thermal Camera',       ZONES[5], 'active',            3],
  [CATS.camera, 'Thermal Camera',       ZONES[2], 'faulty',            1],
  // Camera - LPR
  [CATS.camera, 'LPR Camera',           ZONES[0], 'active',            5],
  [CATS.camera, 'LPR Camera',           ZONES[4], 'active',            4],
  // Camera - Bullet
  [CATS.camera, 'Bullet Camera',        ZONES[3], 'active',            4],
  [CATS.camera, 'Bullet Camera',        ZONES[5], 'active',            3],
  // Camera - ANPR
  [CATS.camera, 'ANPR Camera',          ZONES[0], 'active',            3],
  [CATS.camera, 'ANPR Camera',          ZONES[1], 'under_maintenance', 1],
  // Camera - stock
  [CATS.camera, 'Fixed Dome Camera',    null,     'provisioned',       4],
  [CATS.camera, 'Thermal Camera',       null,     'provisioned',       2],

  // PTZ
  [CATS.ptz,    'Speed Dome PTZ',       ZONES[0], 'active',            2],
  [CATS.ptz,    'Speed Dome PTZ',       ZONES[3], 'active',            2],
  [CATS.ptz,    'Outdoor PTZ',          ZONES[1], 'active',            3],
  [CATS.ptz,    'Outdoor PTZ',          ZONES[5], 'faulty',            1],
  [CATS.ptz,    'Mini PTZ',             null,     'provisioned',       2],

  // LPR Camera
  [CATS.lpr,    'LPR Camera',           ZONES[0], 'active',            3],
  [CATS.lpr,    'ANPR Camera',          ZONES[3], 'active',            2],
  [CATS.lpr,    'LPR Camera',           ZONES[4], 'under_maintenance', 1],

  // Network Switches
  [CATS.network, '24-Port Switch',      ZONES[0], 'active',            2],
  [CATS.network, '24-Port Switch',      ZONES[1], 'active',            2],
  [CATS.network, '48-Port Managed Switch', ZONES[2], 'active',         1],
  [CATS.network, 'Core Switch',         ZONES[3], 'active',            1],
  [CATS.network, '8-Port PoE Switch',   ZONES[4], 'faulty',            1],
  [CATS.network, '24-Port Switch',      null,     'provisioned',       2],

  // Optical Fibre
  [CATS.fibre,  'Single Mode Fiber Link', ZONES[0], 'active',          3],
  [CATS.fibre,  'Multi Mode Fiber Link',  ZONES[1], 'active',          3],
  [CATS.fibre,  'Fiber Patch Panel',      ZONES[2], 'active',          2],
  [CATS.fibre,  'Single Mode Fiber Link', ZONES[3], 'faulty',          1],
  [CATS.fibre,  'Fiber Patch Panel',      null,     'provisioned',     2],

  // Routers
  [CATS.router, 'Core Router',          ZONES[0], 'active',            2],
  [CATS.router, 'Edge Router',          ZONES[1], 'active',            2],
  [CATS.router, 'Wireless Router',      ZONES[2], 'active',            2],
  [CATS.router, 'Wireless Router',      ZONES[3], 'under_maintenance', 1],

  // LED TV
  [CATS.led,    '55" LED Display',      ZONES[0], 'active',            2],
  [CATS.led,    '75" LED Display',      ZONES[1], 'active',            1],
  [CATS.led,    '32" LED Display',      ZONES[2], 'active',            2],
  [CATS.led,    '55" LED Display',      ZONES[3], 'faulty',            1],

  // Monitor
  [CATS.monitor, 'HD Monitor 24"',      ZONES[0], 'active',            3],
  [CATS.monitor, '4K Monitor 27"',      ZONES[1], 'active',            3],
  [CATS.monitor, 'Curved Monitor 32"',  ZONES[2], 'active',            2],
  [CATS.monitor, 'HD Monitor 24"',      ZONES[3], 'under_maintenance', 1],
  [CATS.monitor, '4K Monitor 27"',      null,     'provisioned',       3],

  // Fire Alarm
  [CATS.fire,   'Smoke Detector',       ZONES[0], 'active',            4],
  [CATS.fire,   'Heat Detector',        ZONES[1], 'active',            3],
  [CATS.fire,   'Fire Control Panel',   ZONES[0], 'active',            1],
  [CATS.fire,   'Smoke Detector',       ZONES[2], 'faulty',            1],

  // HVAC
  [CATS.hvac,   'Split AC',             ZONES[0], 'active',            3],
  [CATS.hvac,   'Cassette AC',          ZONES[1], 'active',            2],
  [CATS.hvac,   'Air Handling Unit',    ZONES[2], 'active',            1],
  [CATS.hvac,   'Split AC',             null,     'provisioned',       2],

  // PA System
  [CATS.pa,     'Speaker',              ZONES[0], 'active',            4],
  [CATS.pa,     'Amplifier',            ZONES[0], 'active',            1],
  [CATS.pa,     'Speaker',              ZONES[1], 'active',            3],
  [CATS.pa,     'Microphone',           ZONES[2], 'faulty',            1],

  // Sensor
  [CATS.sensor, 'Motion Sensor',        ZONES[0], 'active',            5],
  [CATS.sensor, 'Temperature Sensor',   ZONES[1], 'active',            3],
  [CATS.sensor, 'Humidity Sensor',      ZONES[2], 'active',            2],
  [CATS.sensor, 'Motion Sensor',        ZONES[3], 'faulty',            1],
];

async function reserveCode(tx, categoryId, count) {
  const rows = await tx.$queryRaw`
    UPDATE product_categories
    SET last_seq = last_seq + ${count}
    WHERE id = ${categoryId}::uuid
    RETURNING code, last_seq`;
  const { code, last_seq } = rows[0];
  const end = Number(last_seq);
  const start = end - count + 1;
  const codes = [];
  for (let n = start; n <= end; n++) {
    codes.push(`${code}-${String(n).padStart(6, '0')}`);
  }
  return codes;
}

async function main() {
  console.log('🗑️  Deleting all existing devices...');
  await prisma.device.deleteMany({});
  console.log('🗑️  Deleting all existing product types...');
  await prisma.productType.deleteMany({});
  console.log('🔄  Resetting category sequences...');
  await prisma.$executeRaw`UPDATE product_categories SET last_seq = 0`;

  console.log('✅  Creating product types...');
  const createdTypes = {};
  for (const pt of PRODUCT_TYPES) {
    const created = await prisma.productType.create({
      data: { categoryId: pt.categoryId, name: pt.name },
      select: { id: true, name: true, categoryId: true },
    });
    createdTypes[`${pt.categoryId}::${pt.name}`] = created;
  }
  console.log(`   Created ${Object.keys(createdTypes).length} product types`);

  console.log('✅  Creating devices...');
  let totalCreated = 0;

  for (const [categoryId, typeName, zoneId, status, qty] of DEVICE_PLAN) {
    const pt = createdTypes[`${categoryId}::${typeName}`];
    if (!pt) { console.warn(`  SKIP: type not found: ${typeName}`); continue; }

    await prisma.$transaction(async (tx) => {
      const codes = await reserveCode(tx, categoryId, qty);
      const data = codes.map((code) => ({
        code,
        name: typeName,
        categoryId,
        productTypeId: pt.id,
        zoneId: zoneId ?? null,
        companyId: COMPANY_ID,
        status,
      }));
      await tx.device.createMany({ data });
    });
    totalCreated += qty;
  }

  console.log(`   Created ${totalCreated} devices`);
  console.log('🎉 Done!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
