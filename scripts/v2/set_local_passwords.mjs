#!/usr/bin/env node
/**
 * LOCAL TESTING ONLY. Gives every user in the local throwaway Fixly DB the same
 * password, so you can sign in to the Fixly web app as any role. Refuses any
 * database that is not a local test_* one (never the live Hostinger DB).
 *
 *   npm run v2:local-passwords            # password Fixly@12345
 *   node scripts/v2/set_local_passwords.mjs MyPass@1
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) || !/\/test_[^/?]*/.test(url)) {
  console.error('Only for a local test_* database.');
  process.exit(1);
}
const password = process.argv[2] ?? 'Fixly@12345';
const prisma = new PrismaClient();
const hash = await bcrypt.hash(password, 10);
const users = await prisma.user.findMany({ where: { accountStatus: { not: 'removed' } }, orderBy: { role: 'asc' }, select: { email: true, role: true } });
await prisma.user.updateMany({ where: { accountStatus: { not: 'removed' } }, data: { passwordHash: hash, accountStatus: 'active' } });
console.log(`Password for every user: ${password}`);
for (const u of users) console.log(`  ${u.role.padEnd(14)} ${u.email}`);
await prisma.$disconnect();
