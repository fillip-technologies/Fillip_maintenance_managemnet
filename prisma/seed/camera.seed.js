import { cctvZonesData } from './data/cctv_zones_data.js';

/**
 * Seeds all ~340 Camera hardware devices across all zones and locations.
 * Every device is seeded with status: 'active' (fully working), as requested.
 * Fully idempotent.
 */
export async function seedCameras(prisma, { company, superAdmin, products, zones }) {
  console.log('📷 [4/4] Seeding Camera Devices (all status: active / working)...');

  let deviceSeq = 0;
  let createdOrUpdated = 0;
  const typeCounts = { PTZ: 0, Bullet: 0, Dome: 0 };
  const cameraIndexMap = {}; // Tracks camera count per (parentZone, location, type)

  const { category, productTypes, hardwareType } = products;
  const { zoneMap } = zones;

  for (const zoneData of cctvZonesData) {
    const parentName = zoneData.name.trim();
    const zoneInfo = zoneMap[parentName];
    if (!zoneInfo) continue;

    for (const loc of zoneData.locations) {
      const locName = loc.name.trim();
      const targetZoneId = zoneInfo.locations[locName] || zoneInfo.id;

      const typesToCreate = [
        { typeName: 'PTZ', count: loc.ptz || 0 },
        { typeName: 'Bullet', count: loc.bullet || 0 },
        { typeName: 'Dome', count: loc.dome || 0 },
      ];

      for (const { typeName, count } of typesToCreate) {
        const prodType = productTypes[typeName];
        if (!prodType || count <= 0) continue;

        for (let i = 1; i <= count; i++) {
          deviceSeq++;
          typeCounts[typeName]++;

          const key = `${parentName}::${locName}::${typeName}`;
          cameraIndexMap[key] = (cameraIndexMap[key] || 0) + 1;
          const camIndex = cameraIndexMap[key];

          const code = `CAM-${String(deviceSeq).padStart(6, '0')}`;
          const deviceName = `${locName} ${typeName} Camera ${camIndex}`;

          await prisma.device.upsert({
            where: { code },
            update: {
              name: deviceName,
              location: locName,
              zoneId: targetZoneId,
              companyId: company.id,
              categoryId: category.id,
              productTypeId: prodType.id,
              hardwareTypeId: hardwareType?.id ?? null,
              status: 'active', // ALL WORKING
            },
            create: {
              code,
              name: deviceName,
              location: locName,
              zoneId: targetZoneId,
              companyId: company.id,
              categoryId: category.id,
              productTypeId: prodType.id,
              hardwareTypeId: hardwareType?.id ?? null,
              status: 'active', // ALL WORKING
              addedById: superAdmin?.id ?? null,
            },
          });

          createdOrUpdated++;
        }
      }
    }
  }

  // Update category lastSeq counter
  await prisma.productCategory.update({
    where: { id: category.id },
    data: { lastSeq: deviceSeq },
  });

  console.log(`   ✓ Seeded ${createdOrUpdated} Cameras with status "active"`);
  console.log(`     - PTZ:    ${typeCounts.PTZ}`);
  console.log(`     - Bullet: ${typeCounts.Bullet}`);
  console.log(`     - Dome:   ${typeCounts.Dome}`);
  console.log(`   ✓ Updated ${category.code} lastSeq counter to ${deviceSeq}`);

  return { totalDevices: createdOrUpdated, typeCounts };
}
