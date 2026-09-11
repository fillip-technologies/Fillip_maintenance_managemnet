import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CLIENT_ID = 'b62751fd-901d-4779-bf62-480ae9df182a'; // Rajgir Zoo Safari

const ZONES = [
  {
    name: 'Entrance Plaza',
    subZones: [
      'Ticket counter',
      'Control room & ticket counter gallery',
      'Control room',
      'Interpecation room',
      'Vip room',
      '180 Theather',
      'Exibhition hall',
      'Entrance Corridor',
      'Sapat stambh (Web Camera)',
      'Back side of ticket counter',
      'Nature Safari Bus Shed (Pick Up)',
      'Bus Shed',
    ],
  },
  {
    name: 'Safari  Plaza',
    subZones: [
      'Orientation Room',
      'Control room T/C',
      'Control room',
      'Administrative room',
      'Corridor',
      'Entry Point',
      'Pickup Point',
      'Drop Point',
    ],
  },
  {
    name: 'Bird Avivary',
    subZones: [
      'Drain Area',
      'Pond Area',
      'Service Corridor',
      'Viewing Deck Upper Corridor',
      'Keeper Room',
      'Store Room',
      "Doctor's Chamber",
      'Equipment Room',
      'Children Park',
      'Near Open Theater',
      'Near Avivary Sinageg Bord',
      'Near Safari Plaza Road',
    ],
  },
  {
    name: 'Carnivore Qurantine',
    subZones: [
      'Main Gate',
      'Gallery',
      'Keeper Room',
      'Kaaral No-02',
    ],
  },
  {
    name: 'Commissary',
    subZones: [
      'Entrance Vehicle',
      'Main Entrance',
      'Office',
      'Kitchen Room',
      'Gram Soaking',
      'Fruits & Veg Room',
      'Husk Store',
      'Mash Preparation',
      'Mash Item',
      'Beef',
      'Cold Storage',
      'Cold Storage Gate',
    ],
  },
  {
    name: 'Hospital',
    subZones: [
      'Outside Main Door',
      'Inside Main Door',
      'Right Side Gallery',
      'Left Side Gallery',
      'Laboratory Room',
      'Pharmacy Room',
      'Staff Room',
      "Doctor's Chamber-1",
      "Doctor's Chamber-2",
      'Record Room',
      'Equipment Store Room',
      'Nursery Room',
      'Operation Room',
      'Surgical Room',
      'X-Ray Room',
      'Observation Room',
      'Ultrasound Room',
      'Kraal No-4',
      'Kraal No-3',
      'Behind The Hospital',
    ],
  },
  {
    name: 'Herbivore Retiring Room',
    subZones: [
      'Block-A',
      'Block-B',
      'Block-C',
      'Kraal',
      'Jarasandh Gate',
      'Mrigvihar Gate',
      'DG-01',
      'DG-02',
      'Fire Station (Mrigvihar Gate)',
    ],
  },
  {
    name: '04 No & 05 Parking / Stone Wall',
    subZones: [
      'Main Gate 04 No Parking',
      '04 No Parking Pole Par (Behind)',
      'Bathroom Roof',
      'Road Side N.H',
      'Road Side N.H 4no & 5no (Middle)',
      '05 No (N.H) Road',
      '05 No Parking Stone Wall',
      'Ticket Counter Cabin',
      'Gate No-3',
      'Gate No-1',
      'Gate No-2',
    ],
  },
  {
    name: 'Admin Block',
    subZones: [
      'Director Chamber',
      'Deputy Director Chamber',
      'Division Office',
      'Video Conference Hall',
      'Library Room',
      'Main Gate Admin',
      'Training Area',
      'Forester Zone',
      'ROF-1',
      'ROF-2',
      'ROF-3',
      'Facility Hall',
      'Portico',
    ],
  },
  {
    name: 'Lion Retiring room',
    subZones: [
      'Keeper room',
      'Store room',
      'Gallery',
      'Dark room',
      'Cell No.-01',
      'Cell No.-02',
      'Cell No.-03',
      'Cell No.-04',
      'Cell No.-05',
      'Cell No.-06',
      'Cell No.-07',
      'Kraal No.-01',
      'Kraal No.-02',
      'Kraal No.-03',
      'Kraal No.-04',
      'Main Gate',
      'Behind of Retiring room',
    ],
  },
  {
    name: 'Lion Double Gate- 01',
    subZones: [
      'DG Keeper room',
      'Gate 1st',
      'Gate 2nd',
      'B/W 1st and 2nd Gate',
    ],
  },
  {
    name: 'Lion Double Gate- 02',
    subZones: [
      'DG Keeper room',
      'Gate 1st',
      'Gate 2nd',
      'B/W 1st and 2nd Gate',
    ],
  },
  {
    name: 'Tiger Retiring room',
    subZones: [
      'Keeper room',
      'Store room',
      'Gallery',
      'Dark room (1)',
      'Dark room (2)',
      'Half Dark room',
      'Cell No.-01',
      'Cell No.-02',
      'Cell No.-03',
      'Cell No.-04',
      'Cell No.-05',
      'Cell No.-06',
      'Cell No.-07',
      'Kraal No.-01',
      'Kraal No.-02',
      'Kraal No.-03',
      'Kraal No.-04',
      'Main Gate',
      'Behind of Retiring room',
    ],
  },
  {
    name: 'Tiger Double Gate- 01',
    subZones: [
      'DG Keeper room',
      'Gate 1st',
      'Gate 2nd',
      'B/W 1st and 2nd Gate',
    ],
  },
  {
    name: 'Tiger Double Gate- 02',
    subZones: [
      'DG Keeper room',
      'Gate 1st',
      'Gate 2nd',
      'B/W 1st and 2nd Gate',
    ],
  },
  {
    name: 'Leopard Retiring room',
    subZones: [
      'Keeper room',
      'Store room',
      'Gallery',
      'Dark room',
      'Cell No.-01',
      'Cell No.-02',
      'Cell No.-03',
      'Cell No.-04',
      'Cell No.-05',
      'Cell No.-06',
      'Cell No.-07',
      'Kraal No.-01',
      'Kraal No.-02',
      'Main Gate',
      'Behind of Retiring room',
    ],
  },
  {
    name: 'Leopard Double Gate- 01',
    subZones: [
      'DG Keeper room',
      'Bus bay',
      'In front of Gate',
      'Behind of Gate',
    ],
  },
  {
    name: 'Leopard Double Gate- 02',
    subZones: [
      'DG Keeper room',
      'Bus bay',
      'In front of Gate',
      'Behind of Gate',
    ],
  },
  {
    name: 'Bear Retiring room',
    subZones: [
      'Keeper room',
      'Store room',
      'Gallery',
      'Dark room',
      'Cell No.-01',
      'Cell No.-02',
      'Cell No.-03',
      'Cell No.-04',
      'Cell No.-05',
      'Cell No.-06',
      'Cell No.-07',
      'Cell No.-08',
      'Cell No.-09',
      'Kraal No.-01',
      'Kraal No.-02',
      'Campus Area',
      'Main Gate',
      'Behind of Retiring room',
    ],
  },
  {
    name: 'Bear Double Gate- 01',
    subZones: [
      'DG Keeper room',
      'Bus bay',
      'In front of Gate',
      'Behind of Gate',
    ],
  },
  {
    name: 'Bear Double Gate- 02',
    subZones: [
      'DG Keeper room',
      'Bus bay',
      'In front of Gate',
      'Behind of Gate',
    ],
  },
];

async function main() {
  let topCreated = 0, topSkipped = 0;
  let subCreated = 0, subSkipped = 0;

  for (const { name, subZones } of ZONES) {
    // Upsert top-level zone
    let parent = await prisma.zone.findFirst({
      where: { clientId: CLIENT_ID, name: { equals: name, mode: 'insensitive' }, parentZoneId: null },
    });

    if (parent) {
      console.log(`\n⟳ Exists: "${parent.name}"`);
      topSkipped++;
    } else {
      parent = await prisma.zone.create({
        data: { clientId: CLIENT_ID, name, status: 'active' },
      });
      console.log(`\n✓ Created: "${name}"`);
      topCreated++;
    }

    // Create sub-zones (unique per parent thanks to new migration)
    for (const subName of subZones) {
      const existing = await prisma.zone.findFirst({
        where: {
          clientId: CLIENT_ID,
          parentZoneId: parent.id,
          name: { equals: subName, mode: 'insensitive' },
        },
      });

      if (existing) {
        console.log(`   ⟳  skip     "${existing.name}"`);
        subSkipped++;
      } else {
        await prisma.zone.create({
          data: { clientId: CLIENT_ID, parentZoneId: parent.id, name: subName, status: 'active' },
        });
        console.log(`   ✓  created  "${subName}"`);
        subCreated++;
      }
    }
  }

  console.log('\n══════════════════════════════════════');
  console.log(`Top-level zones  created: ${topCreated}  skipped: ${topSkipped}`);
  console.log(`Sub-zones        created: ${subCreated}  skipped: ${subSkipped}`);
  console.log('Done ✓');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
