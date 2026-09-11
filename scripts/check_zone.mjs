import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const ZONE_ID = '7ca30ad3-a4ed-4ec2-8f57-22632b87c07d';

const zone = await p.zone.findUnique({ where: { id: ZONE_ID }, select: { id: true, name: true, parentZoneId: true } });
console.log('Zone:', JSON.stringify(zone));

const children = await p.zone.findMany({ where: { parentZoneId: ZONE_ID }, select: { id: true, name: true } });
console.log('\nChildren:', children.length);
children.forEach(c => console.log(' -', c.name, c.id));

// Devices directly in this zone
const directDevices = await p.device.findMany({
  where: { zoneId: ZONE_ID },
  select: { id: true, name: true, zoneId: true, status: true, productTypeId: true }
});
console.log('\nDirect devices in zone:', directDevices.length);
directDevices.forEach(d => console.log(' -', d.name, d.status, d.zoneId));

// Devices in child zones
for (const child of children) {
  const devs = await p.device.findMany({
    where: { zoneId: child.id },
    select: { id: true, name: true, status: true }
  });
  console.log(`\n  "${child.name}" devices: ${devs.length}`);
  devs.forEach(d => console.log('   -', d.name, d.status));
}

await p.$disconnect();
