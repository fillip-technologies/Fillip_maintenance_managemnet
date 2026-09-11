import { PrismaClient } from '@prisma/client';
import { runSeed } from './seed/index.js';

const prisma = new PrismaClient();

async function main() {
  await runSeed(prisma);
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
