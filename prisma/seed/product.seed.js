/**
 * Seeds Product Categories, Product Types (PTZ, Bullet, Dome), and Hardware Types.
 * Fully idempotent.
 */
export async function seedProducts(prisma) {
  console.log('📦 [2/4] Seeding Product Categories, Product Types, and Hardware Types...');

  // 1. Core Category: Camera
  const cameraCategory = await prisma.productCategory.upsert({
    where: { code: 'CAM' },
    update: { name: 'CCTV Camera' },
    create: {
      name: 'CCTV Camera',
      code: 'CAM',
    },
  });

  // Additional platform categories
  const otherCategories = [
    { name: 'Access Control', code: 'ACS' },
    { name: 'Fire Alarm', code: 'FIR' },
    { name: 'Network Device', code: 'NET' },
    { name: 'HVAC Unit', code: 'HVC' },
    { name: 'PA System', code: 'PAS' },
    { name: 'Sensor', code: 'SEN' },
  ];
  for (const pc of otherCategories) {
    await prisma.productCategory.upsert({
      where: { code: pc.code },
      update: {},
      create: pc,
    });
  }

  // 2. Product Types under Camera category (PTZ, Bullet, Dome)
  const typeNames = ['PTZ', 'Bullet', 'Dome'];
  const productTypes = {};

  for (const name of typeNames) {
    productTypes[name] = await prisma.productType.upsert({
      where: {
        categoryId_name: {
          categoryId: cameraCategory.id,
          name,
        },
      },
      update: {},
      create: {
        categoryId: cameraCategory.id,
        name,
      },
    });
  }

  // 3. Hardware Types
  const hardwareType = await prisma.hardwareType.upsert({
    where: { name: 'CCTV Camera' },
    update: {},
    create: {
      name: 'CCTV Camera',
      specFields: {
        model: 'string',
        serial: 'string',
        ip: 'string',
        resolution: 'string',
      },
    },
  });

  console.log(`   ✓ Category: "${cameraCategory.name}" (${cameraCategory.code})`);
  console.log(`   ✓ Product Types: ${Object.keys(productTypes).join(', ')}`);
  console.log(`   ✓ Hardware Type: "${hardwareType.name}"`);

  return { category: cameraCategory, productTypes, hardwareType };
}
