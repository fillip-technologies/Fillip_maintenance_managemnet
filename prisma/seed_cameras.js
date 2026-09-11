import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CLIENT_ID  = 'b62751fd-901d-4779-bf62-480ae9df182a';
const COMPANY_ID = '10afc9e3-3e59-439e-ae72-369402c54edd';
const CAM_CAT_ID = 'b6ebdccb-2fdc-44a4-bec8-1ea9a160ae5c';

const TYPE_IDS = {
  PTZ:    '07090001-ab5d-4c92-8548-eba9b856f3aa',
  Bullet: '6775f08b-2dd8-4092-b6f2-a146edabe00a',
  Dome:   '78490a1b-bbb1-429d-bb7b-e405d6cea4ec',
};

// Camera counts per sub-zone: [parent, subZone, PTZ, Bullet, Dome]
const CAMERA_DATA = [
  // Entrance Plaza
  ['Entrance Plaza', 'Ticket counter',                        0, 0, 5],
  ['Entrance Plaza', 'Control room & ticket counter gallery', 0, 0, 1],
  ['Entrance Plaza', 'Control room',                          0, 0, 2],
  ['Entrance Plaza', 'Interpecation room',                    0, 0, 3],
  ['Entrance Plaza', 'Vip room',                              0, 0, 1],
  ['Entrance Plaza', '180 Theather',                          0, 0, 5],
  ['Entrance Plaza', 'Exibhition hall',                       0, 0, 2],
  ['Entrance Plaza', 'Entrance Corridor',                     5, 2, 2],
  ['Entrance Plaza', 'Sapat stambh (Web Camera)',             2, 0, 0],
  ['Entrance Plaza', 'Back side of ticket counter',           0, 1, 0],
  ['Entrance Plaza', 'Nature Safari Bus Shed (Pick Up)',      0, 1, 0],
  ['Entrance Plaza', 'Bus Shed',                              0, 2, 0],

  // Safari Plaza
  ['Safari  Plaza', 'Orientation Room',     0, 0, 2],
  ['Safari  Plaza', 'Control room T/C',     0, 0, 1],
  ['Safari  Plaza', 'Control room',         0, 0, 1],
  ['Safari  Plaza', 'Administrative room',  0, 0, 1],
  ['Safari  Plaza', 'Corridor',             1, 2, 2],
  ['Safari  Plaza', 'Entry Point',          1, 0, 0],
  ['Safari  Plaza', 'Pickup Point',         1, 0, 0],
  ['Safari  Plaza', 'Drop Point',           1, 0, 0],

  // Bird Avivary
  ['Bird Avivary', 'Drain Area',                    1, 0, 0],
  ['Bird Avivary', 'Pond Area',                     1, 0, 0],
  ['Bird Avivary', 'Service Corridor',              0, 0, 7],
  ['Bird Avivary', 'Viewing Deck Upper Corridor',   1, 4, 0],
  ['Bird Avivary', 'Keeper Room',                   0, 0, 2],
  ['Bird Avivary', 'Store Room',                    0, 0, 2],
  ['Bird Avivary', "Doctor's Chamber",              0, 0, 1],
  ['Bird Avivary', 'Equipment Room',                0, 0, 2],
  ['Bird Avivary', 'Children Park',                 0, 1, 1],
  ['Bird Avivary', 'Near Open Theater',             0, 3, 0],
  ['Bird Avivary', 'Near Avivary Sinageg Bord',     1, 0, 0],
  ['Bird Avivary', 'Near Safari Plaza Road',        0, 3, 0],

  // Carnivore Qurantine
  ['Carnivore Qurantine', 'Main Gate',    0, 1, 0],
  ['Carnivore Qurantine', 'Gallery',      0, 3, 0],
  ['Carnivore Qurantine', 'Keeper Room',  0, 1, 0],
  ['Carnivore Qurantine', 'Kaaral No-02', 1, 0, 0],

  // Commissary
  ['Commissary', 'Entrance Vehicle',  1, 0, 0],
  ['Commissary', 'Main Entrance',     0, 1, 0],
  ['Commissary', 'Office',            0, 1, 0],
  ['Commissary', 'Kitchen Room',      0, 0, 1],
  ['Commissary', 'Gram Soaking',      0, 0, 1],
  ['Commissary', 'Fruits & Veg Room', 0, 1, 0],
  ['Commissary', 'Husk Store',        0, 1, 0],
  ['Commissary', 'Mash Preparation',  0, 0, 1],
  ['Commissary', 'Mash Item',         0, 0, 1],
  ['Commissary', 'Beef',              0, 0, 1],
  ['Commissary', 'Cold Storage',      0, 0, 1],
  ['Commissary', 'Cold Storage Gate', 0, 1, 0],

  // Hospital
  ['Hospital', 'Outside Main Door',    1, 0, 0],
  ['Hospital', 'Inside Main Door',     0, 0, 1],
  ['Hospital', 'Right Side Gallery',   1, 0, 2],
  ['Hospital', 'Left Side Gallery',    0, 0, 1],
  ['Hospital', 'Laboratory Room',      0, 0, 1],
  ['Hospital', 'Pharmacy Room',        0, 0, 1],
  ['Hospital', 'Staff Room',           0, 0, 1],
  ['Hospital', "Doctor's Chamber-1",   0, 0, 1],
  ['Hospital', "Doctor's Chamber-2",   0, 0, 1],
  ['Hospital', 'Record Room',          0, 0, 1],
  ['Hospital', 'Equipment Store Room', 0, 0, 1],
  ['Hospital', 'Nursery Room',         1, 0, 1],
  ['Hospital', 'Operation Room',       0, 0, 1],
  ['Hospital', 'Surgical Room',        0, 0, 1],
  ['Hospital', 'X-Ray Room',           0, 0, 1],
  ['Hospital', 'Observation Room',     0, 0, 1],
  ['Hospital', 'Ultrasound Room',      0, 0, 1],
  ['Hospital', 'Kraal No-4',           1, 0, 0],
  ['Hospital', 'Kraal No-3',           0, 1, 0],
  ['Hospital', 'Behind The Hospital',  1, 0, 0],

  // Herbivore Retiring Room
  ['Herbivore Retiring Room', 'Block-A',                    0, 0, 8],
  ['Herbivore Retiring Room', 'Block-B',                    0, 0, 8],
  ['Herbivore Retiring Room', 'Block-C',                    1, 0, 9],
  ['Herbivore Retiring Room', 'Kraal',                      0, 1, 0],
  ['Herbivore Retiring Room', 'Jarasandh Gate',             1, 1, 0],
  ['Herbivore Retiring Room', 'Mrigvihar Gate',             1, 1, 0],
  ['Herbivore Retiring Room', 'DG-01',                      2, 1, 1],
  ['Herbivore Retiring Room', 'DG-02',                      2, 1, 1],
  ['Herbivore Retiring Room', 'Fire Station (Mrigvihar Gate)', 0, 2, 0],

  // 04 No & 05 Parking / Stone Wall
  ['04 No & 05 Parking / Stone Wall', 'Main Gate 04 No Parking',         1, 1, 0],
  ['04 No & 05 Parking / Stone Wall', '04 No Parking Pole Par (Behind)',  0, 2, 0],
  ['04 No & 05 Parking / Stone Wall', 'Bathroom Roof',                    0, 2, 0],
  ['04 No & 05 Parking / Stone Wall', 'Road Side N.H',                   1, 0, 0],
  ['04 No & 05 Parking / Stone Wall', 'Road Side N.H 4no & 5no (Middle)',0, 2, 0],
  ['04 No & 05 Parking / Stone Wall', '05 No (N.H) Road',                1, 0, 0],
  ['04 No & 05 Parking / Stone Wall', '05 No Parking Stone Wall',        1, 1, 0],
  ['04 No & 05 Parking / Stone Wall', 'Ticket Counter Cabin',            0, 1, 1],
  ['04 No & 05 Parking / Stone Wall', 'Gate No-3',                       0, 1, 0],
  ['04 No & 05 Parking / Stone Wall', 'Gate No-1',                       1, 1, 0],
  ['04 No & 05 Parking / Stone Wall', 'Gate No-2',                       0, 1, 0],

  // Admin Block
  ['Admin Block', 'Director Chamber',       0, 0, 1],
  ['Admin Block', 'Deputy Director Chamber',0, 0, 1],
  ['Admin Block', 'Division Office',        0, 1, 1],
  ['Admin Block', 'Video Conference Hall',  0, 0, 2],
  ['Admin Block', 'Library Room',           0, 0, 1],
  ['Admin Block', 'Main Gate Admin',        0, 0, 2],
  ['Admin Block', 'Training Area',          0, 0, 2],
  ['Admin Block', 'Forester Zone',          0, 0, 1],
  ['Admin Block', 'ROF-1',                  0, 0, 1],
  ['Admin Block', 'ROF-2',                  0, 0, 1],
  ['Admin Block', 'ROF-3',                  0, 0, 1],
  ['Admin Block', 'Facility Hall',          0, 0, 1],
  ['Admin Block', 'Portico',                1, 0, 0],

  // Lion Retiring room
  ['Lion Retiring room', 'Keeper room',             0, 0, 1],
  ['Lion Retiring room', 'Store room',              0, 0, 1],
  ['Lion Retiring room', 'Gallery',                 0, 3, 3],
  ['Lion Retiring room', 'Dark room',               1, 0, 2],
  ['Lion Retiring room', 'Cell No.-01',             0, 0, 1],
  ['Lion Retiring room', 'Cell No.-02',             1, 0, 2],
  ['Lion Retiring room', 'Cell No.-03',             0, 0, 1],
  ['Lion Retiring room', 'Cell No.-04',             0, 0, 1],
  ['Lion Retiring room', 'Cell No.-05',             0, 0, 1],
  ['Lion Retiring room', 'Cell No.-06',             0, 0, 1],
  ['Lion Retiring room', 'Cell No.-07',             1, 0, 2],
  ['Lion Retiring room', 'Kraal No.-01',            0, 2, 0],
  ['Lion Retiring room', 'Kraal No.-02',            1, 2, 0],
  ['Lion Retiring room', 'Kraal No.-03',            1, 2, 0],
  ['Lion Retiring room', 'Kraal No.-04',            0, 2, 0],
  ['Lion Retiring room', 'Main Gate',               1, 0, 0],
  ['Lion Retiring room', 'Behind of Retiring room', 2, 0, 0],

  // Lion Double Gate- 01
  ['Lion Double Gate- 01', 'DG Keeper room',       0, 0, 1],
  ['Lion Double Gate- 01', 'Gate 1st',             1, 0, 0],
  ['Lion Double Gate- 01', 'Gate 2nd',             1, 0, 0],
  ['Lion Double Gate- 01', 'B/W 1st and 2nd Gate', 0, 0, 0],

  // Lion Double Gate- 02
  ['Lion Double Gate- 02', 'DG Keeper room',       0, 0, 1],
  ['Lion Double Gate- 02', 'Gate 1st',             1, 0, 0],
  ['Lion Double Gate- 02', 'Gate 2nd',             1, 0, 0],
  ['Lion Double Gate- 02', 'B/W 1st and 2nd Gate', 0, 1, 0],

  // Tiger Retiring room
  ['Tiger Retiring room', 'Keeper room',             0, 0, 1],
  ['Tiger Retiring room', 'Store room',              0, 0, 1],
  ['Tiger Retiring room', 'Gallery',                 0, 4, 5],
  ['Tiger Retiring room', 'Dark room (1)',            0, 0, 1],
  ['Tiger Retiring room', 'Dark room (2)',            0, 0, 1],
  ['Tiger Retiring room', 'Half Dark room',           0, 0, 1],
  ['Tiger Retiring room', 'Cell No.-01',             0, 0, 1],
  ['Tiger Retiring room', 'Cell No.-02',             0, 0, 1],
  ['Tiger Retiring room', 'Cell No.-03',             0, 0, 1],
  ['Tiger Retiring room', 'Cell No.-04',             0, 0, 1],
  ['Tiger Retiring room', 'Cell No.-05',             0, 0, 1],
  ['Tiger Retiring room', 'Cell No.-06',             0, 0, 1],
  ['Tiger Retiring room', 'Cell No.-07',             0, 0, 1],
  ['Tiger Retiring room', 'Kraal No.-01',            0, 2, 0],
  ['Tiger Retiring room', 'Kraal No.-02',            0, 2, 0],
  ['Tiger Retiring room', 'Kraal No.-03',            0, 2, 0],
  ['Tiger Retiring room', 'Kraal No.-04',            0, 2, 0],
  ['Tiger Retiring room', 'Main Gate',               1, 0, 0],
  ['Tiger Retiring room', 'Behind of Retiring room', 2, 0, 0],

  // Tiger Double Gate- 01
  ['Tiger Double Gate- 01', 'DG Keeper room',       0, 0, 1],
  ['Tiger Double Gate- 01', 'Gate 1st',             1, 0, 0],
  ['Tiger Double Gate- 01', 'Gate 2nd',             1, 0, 0],
  ['Tiger Double Gate- 01', 'B/W 1st and 2nd Gate', 0, 1, 0],

  // Tiger Double Gate- 02
  ['Tiger Double Gate- 02', 'DG Keeper room',       0, 0, 1],
  ['Tiger Double Gate- 02', 'Gate 1st',             1, 0, 0],
  ['Tiger Double Gate- 02', 'Gate 2nd',             1, 0, 0],
  ['Tiger Double Gate- 02', 'B/W 1st and 2nd Gate', 0, 1, 0],

  // Leopard Retiring room
  ['Leopard Retiring room', 'Keeper room',             0, 0, 1],
  ['Leopard Retiring room', 'Store room',              0, 0, 0],
  ['Leopard Retiring room', 'Gallery',                 0, 2, 4],
  ['Leopard Retiring room', 'Dark room',               0, 0, 1],
  ['Leopard Retiring room', 'Cell No.-01',             0, 0, 1],
  ['Leopard Retiring room', 'Cell No.-02',             0, 0, 1],
  ['Leopard Retiring room', 'Cell No.-03',             0, 0, 1],
  ['Leopard Retiring room', 'Cell No.-04',             0, 0, 1],
  ['Leopard Retiring room', 'Cell No.-05',             0, 0, 1],
  ['Leopard Retiring room', 'Cell No.-06',             0, 0, 1],
  ['Leopard Retiring room', 'Cell No.-07',             0, 0, 2],
  ['Leopard Retiring room', 'Kraal No.-01',            0, 2, 0],
  ['Leopard Retiring room', 'Kraal No.-02',            1, 2, 0],
  ['Leopard Retiring room', 'Main Gate',               1, 0, 0],
  ['Leopard Retiring room', 'Behind of Retiring room', 2, 0, 0],

  // Leopard Double Gate- 01
  ['Leopard Double Gate- 01', 'DG Keeper room',  0, 1, 0],
  ['Leopard Double Gate- 01', 'Bus bay',          0, 1, 0],
  ['Leopard Double Gate- 01', 'In front of Gate', 1, 0, 0],
  ['Leopard Double Gate- 01', 'Behind of Gate',   1, 0, 0],

  // Leopard Double Gate- 02
  ['Leopard Double Gate- 02', 'DG Keeper room',  0, 1, 0],
  ['Leopard Double Gate- 02', 'Bus bay',          0, 1, 0],
  ['Leopard Double Gate- 02', 'In front of Gate', 1, 0, 0],
  ['Leopard Double Gate- 02', 'Behind of Gate',   1, 0, 0],

  // Bear Retiring room
  ['Bear Retiring room', 'Keeper room',             0, 0, 1],
  ['Bear Retiring room', 'Store room',              0, 0, 0],
  ['Bear Retiring room', 'Gallery',                 0, 2, 5],
  ['Bear Retiring room', 'Dark room',               1, 0, 2],
  ['Bear Retiring room', 'Cell No.-01',             0, 0, 1],
  ['Bear Retiring room', 'Cell No.-02',             0, 0, 1],
  ['Bear Retiring room', 'Cell No.-03',             0, 0, 1],
  ['Bear Retiring room', 'Cell No.-04',             0, 0, 1],
  ['Bear Retiring room', 'Cell No.-05',             0, 0, 1],
  ['Bear Retiring room', 'Cell No.-06',             0, 0, 1],
  ['Bear Retiring room', 'Cell No.-07',             0, 0, 1],
  ['Bear Retiring room', 'Cell No.-08',             0, 0, 1],
  ['Bear Retiring room', 'Cell No.-09',             0, 0, 1],
  ['Bear Retiring room', 'Kraal No.-01',            0, 2, 0],
  ['Bear Retiring room', 'Kraal No.-02',            0, 2, 0],
  ['Bear Retiring room', 'Campus Area',             2, 0, 0],
  ['Bear Retiring room', 'Main Gate',               0, 0, 0],
  ['Bear Retiring room', 'Behind of Retiring room', 2, 0, 0],

  // Bear Double Gate- 01
  ['Bear Double Gate- 01', 'DG Keeper room',  0, 1, 0],
  ['Bear Double Gate- 01', 'Bus bay',          0, 1, 0],
  ['Bear Double Gate- 01', 'In front of Gate', 1, 0, 0],
  ['Bear Double Gate- 01', 'Behind of Gate',   1, 0, 0],

  // Bear Double Gate- 02
  ['Bear Double Gate- 02', 'DG Keeper room',  0, 1, 0],
  ['Bear Double Gate- 02', 'Bus bay',          0, 1, 0],
  ['Bear Double Gate- 02', 'In front of Gate', 1, 0, 0],
  ['Bear Double Gate- 02', 'Behind of Gate',   1, 0, 0],
];

// Atomically increment lastSeq and return the new code (e.g. "CAM-000042")
async function nextCode() {
  const updated = await prisma.productCategory.update({
    where: { id: CAM_CAT_ID },
    data: { lastSeq: { increment: 1 } },
    select: { code: true, lastSeq: true },
  });
  return `${updated.code}-${String(updated.lastSeq).padStart(6, '0')}`;
}

async function main() {
  // Pre-load all zones for this client into a lookup map
  const allZones = await prisma.zone.findMany({
    where: { clientId: CLIENT_ID },
    select: { id: true, name: true, parentZoneId: true },
  });

  const topLevel = new Map(
    allZones.filter(z => !z.parentZoneId).map(z => [z.name.toLowerCase(), z])
  );
  const byParent = new Map(); // parentId → Map<subZoneName, zone>
  for (const z of allZones.filter(z => z.parentZoneId)) {
    if (!byParent.has(z.parentZoneId)) byParent.set(z.parentZoneId, new Map());
    byParent.get(z.parentZoneId).set(z.name.toLowerCase(), z);
  }

  let created = 0, skipped = 0, missing = 0;

  const TYPES = [
    { key: 'PTZ',    id: TYPE_IDS.PTZ,    label: 'PTZ Camera'    },
    { key: 'Bullet', id: TYPE_IDS.Bullet, label: 'Bullet Camera' },
    { key: 'Dome',   id: TYPE_IDS.Dome,   label: 'Dome Camera'   },
  ];

  for (const [parentName, subName, ptzCount, bulletCount, domeCount] of CAMERA_DATA) {
    const parent = topLevel.get(parentName.toLowerCase());
    if (!parent) {
      console.warn(`⚠  Parent not found: "${parentName}"`);
      missing++;
      continue;
    }

    const subZone = byParent.get(parent.id)?.get(subName.toLowerCase());
    if (!subZone) {
      console.warn(`⚠  Sub-zone not found: "${subName}" under "${parentName}"`);
      missing++;
      continue;
    }

    const counts = [ptzCount, bulletCount, domeCount];

    for (let t = 0; t < TYPES.length; t++) {
      const { id: productTypeId, label } = TYPES[t];
      const count = counts[t];
      if (count === 0) continue;

      // Count already-deployed devices of this type in this zone
      const existing = await prisma.device.count({
        where: { zoneId: subZone.id, productTypeId },
      });

      const toCreate = count - existing;
      if (toCreate <= 0) {
        skipped += count;
        continue;
      }

      for (let i = 0; i < toCreate; i++) {
        const code = await nextCode();
        await prisma.device.create({
          data: {
            companyId:     COMPANY_ID,
            zoneId:        subZone.id,
            categoryId:    CAM_CAT_ID,
            productTypeId,
            code,
            name:          label,
            status:        'active',
          },
        });
        created++;
      }

      console.log(`   ✓  ${label} ×${toCreate}  →  ${parentName} > ${subName}`);
    }
  }

  console.log('\n══════════════════════════════════════');
  console.log(`Cameras created : ${created}`);
  console.log(`Skipped (exist) : ${skipped}`);
  console.log(`Missing zones   : ${missing}`);
  console.log('Done ✓');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
