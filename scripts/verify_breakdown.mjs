import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const CLIENT_ID = 'b62751fd-901d-4779-bf62-480ae9df182a';

const groups = await p.device.groupBy({
  by: ['zoneId', 'status'],
  where: { zone: { clientId: CLIENT_ID }, status: { not: 'retired' } },
  _count: { _all: true },
});

const allZones = await p.zone.findMany({
  where: { clientId: CLIENT_ID },
  select: { id: true, name: true, parentZoneId: true },
});
const zoneById = new Map(allZones.map(z => [z.id, z]));

function topLevelAncestor(zoneId) {
  let z = zoneById.get(zoneId);
  while (z && z.parentZoneId) z = zoneById.get(z.parentZoneId);
  return z ?? null;
}

const byZone = new Map();
for (const row of groups) {
  const ancestor = topLevelAncestor(row.zoneId);
  if (!ancestor) continue;
  if (!byZone.has(ancestor.id)) byZone.set(ancestor.id, { zoneName: ancestor.name, total: 0, working: 0 });
  const b = byZone.get(ancestor.id);
  b.total += row._count._all;
  if (row.status === 'active') b.working += row._count._all;
}

const result = [...byZone.values()].sort((a, b) => b.total - a.total);
console.log('Top-level zones with rolled-up device counts:\n');
result.forEach(z => console.log(`  ${z.zoneName.padEnd(38)} total=${z.total}  active=${z.working}`));
console.log(`\nZones with cameras : ${result.length}`);
console.log(`Grand total devices: ${result.reduce((s, z) => s + z.total, 0)}`);

await p.$disconnect();
