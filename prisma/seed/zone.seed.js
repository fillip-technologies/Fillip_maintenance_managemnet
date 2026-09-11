import { cctvZonesData } from './data/cctv_zones_data.js';

/**
 * Seeds all 21 Top-Level Zones and child locations as sub-zones.
 * Fully idempotent, strictly respects PostgreSQL (client_id, lower(name)) unique constraint.
 */
export async function seedZones(prisma, { client, superAdmin }) {
  console.log('🗺️  [3/4] Seeding 21 Top-Level Zones and child locations...');

  const topLevelZones = [];
  const zoneMap = {}; // { [parentZoneName]: { id: parentZoneId, locations: { [rawLocName]: childZoneId } } }

  // Track globally used names (lowercased) to prevent unique constraint violation on (client_id, lower(name))
  const usedZoneNames = new Set();

  // 1. First register and create all 21 Top-Level Zones
  for (const zoneData of cctvZonesData) {
    const parentName = zoneData.name.trim();

    let parentZone = await prisma.zone.findFirst({
      where: {
        clientId: client.id,
        parentZoneId: null,
        name: { equals: parentName, mode: 'insensitive' },
      },
    });

    if (!parentZone) {
      parentZone = await prisma.zone.create({
        data: {
          clientId: client.id,
          parentZoneId: null,
          name: parentName,
          status: 'active',
          createdById: superAdmin?.id ?? null,
        },
      });
    } else if (parentZone.status !== 'active') {
      parentZone = await prisma.zone.update({
        where: { id: parentZone.id },
        data: { status: 'active' },
      });
    }

    usedZoneNames.add(parentName.toLowerCase());
    topLevelZones.push(parentZone);
    zoneMap[parentName] = {
      id: parentZone.id,
      locations: {},
    };
  }

  // 2. Create child locations under their respective parent zones
  for (const zoneData of cctvZonesData) {
    const parentName = zoneData.name.trim();
    const parentZoneId = zoneMap[parentName].id;

    for (const loc of zoneData.locations) {
      const locName = loc.name.trim();
      if (!locName) continue;

      // If already mapped for this parent, skip (e.g. multiple "Dark room" rows in Tiger)
      if (zoneMap[parentName].locations[locName]) continue;

      // Determine a unique name for this child zone
      let targetName = locName;
      if (usedZoneNames.has(targetName.toLowerCase())) {
        targetName = `${locName} (${parentName})`;
      }

      let counter = 1;
      let finalName = targetName;
      while (usedZoneNames.has(finalName.toLowerCase())) {
        finalName = `${targetName} - ${counter++}`;
      }

      // Check if this child zone already exists in DB
      let childZone = await prisma.zone.findFirst({
        where: {
          clientId: client.id,
          parentZoneId: parentZoneId,
          name: { equals: finalName, mode: 'insensitive' },
        },
      });

      if (!childZone) {
        childZone = await prisma.zone.create({
          data: {
            clientId: client.id,
            parentZoneId: parentZoneId,
            name: finalName,
            status: 'active',
            createdById: superAdmin?.id ?? null,
          },
        });
      } else if (childZone.status !== 'active') {
        childZone = await prisma.zone.update({
          where: { id: childZone.id },
          data: { status: 'active' },
        });
      }

      usedZoneNames.add(finalName.toLowerCase());
      zoneMap[parentName].locations[locName] = childZone.id;
    }
  }

  const childCount = Object.values(zoneMap).reduce(
    (acc, z) => acc + Object.keys(z.locations).length,
    0
  );

  console.log(`   ✓ Seeded ${topLevelZones.length} Top-Level Zones`);
  console.log(`   ✓ Seeded ${childCount} Sub-locations / Child Zones`);

  return { topLevelZones, zoneMap };
}
