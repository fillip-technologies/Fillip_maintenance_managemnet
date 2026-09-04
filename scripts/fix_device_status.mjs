/**
 * One-shot repair: finds every device that is still `under_maintenance`
 * but has no genuinely open issues (open / assigned / in_progress / on_hold /
 * reopened) and sets it back to `active`.
 *
 * Run:  node scripts/fix_device_status.mjs
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OPEN_ISSUE_STATES = ['open', 'assigned', 'in_progress', 'on_hold', 'reopened'];

try {
  // Show current state.
  const all = await prisma.device.findMany({
    where: { status: 'under_maintenance' },
    select: {
      id: true, name: true, status: true,
      zone: { select: { name: true } },
      issues: { select: { id: true, status: true } },
    },
  });

  console.log(`\nAll under_maintenance devices (${all.length}):`);
  for (const d of all) {
    const openIssues = d.issues.filter((i) => OPEN_ISSUE_STATES.includes(i.status));
    console.log(`  ${d.name} (zone: ${d.zone?.name ?? 'none'}) — ${d.issues.length} issue(s), ${openIssues.length} open`);
    for (const iss of d.issues) {
      console.log(`    • issue status: ${iss.status}`);
    }
  }

  // Fix stale ones.
  const stale = all.filter((d) => !d.issues.some((i) => OPEN_ISSUE_STATES.includes(i.status)));

  if (stale.length === 0) {
    console.log('\nNothing to fix — all under_maintenance devices have real open issues.\n');
  } else {
    await prisma.device.updateMany({
      where: { id: { in: stale.map((d) => d.id) } },
      data: { status: 'active' },
    });
    console.log(`\nFixed ${stale.length} device(s) → active:`);
    for (const d of stale) {
      console.log(`  ✅ ${d.name} (zone: ${d.zone?.name ?? 'none'})`);
    }
    console.log('');
  }
} finally {
  await prisma.$disconnect();
}
