// DB integrity / type-drift guard.
//
// Catches the class of bug we hit in the wild: `users.company_id` silently became
// `integer` instead of `uuid` (a stray `migrate dev`/`db push` re-synced the column
// to the wrong type), which broke every insert with "incorrect binary data format".
//
// Asserts that EVERY id / *_id column in the public schema is `uuid` (the app's
// universal key type), and spot-checks a few critical columns explicitly. Exits
// non-zero on any drift so CI (or a pre-deploy step) can block on it.
//
// Run:  node scripts/db_verify.mjs
import { prisma } from '../src/lib/prisma.js';

let pass = 0;
let fail = 0;
const ok = (name) => { pass++; console.log(`  ✅ ${name}`); };
const bad = (name, extra = '') => { fail++; console.log(`  ❌ ${name} ${extra}`); };

// Columns intentionally NOT uuid (framework-owned) — excluded from the sweep.
const ALLOW_NON_UUID = new Set([
  '_prisma_migrations.id', // Prisma bookkeeping — varchar checksum id
]);

// Critical columns we assert explicitly (belt-and-suspenders on top of the sweep).
const CRITICAL = [
  ['users', 'id'], ['users', 'company_id'], ['users', 'client_id'],
  ['companies', 'id'], ['clients', 'id'], ['clients', 'company_id'],
  ['zones', 'id'], ['zones', 'client_id'], ['zones', 'parent_zone_id'],
  ['devices', 'id'], ['devices', 'zone_id'],
  ['products', 'id'], ['products', 'company_id'],
  ['issues', 'id'], ['issues', 'device_id'],
  ['refresh_tokens', 'user_id'],
];

async function main() {
  console.log('DB type-drift verification\n');

  const rows = await prisma.$queryRaw`
    SELECT table_name, column_name, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (column_name = 'id' OR column_name LIKE '%\\_id')
    ORDER BY table_name, column_name`;

  const typeOf = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r.udt_name]));

  // 1) Sweep: every id / *_id column must be uuid (unless explicitly allowed).
  console.log('Sweep — all id / *_id columns are uuid:');
  let drift = 0;
  for (const r of rows) {
    const key = `${r.table_name}.${r.column_name}`;
    if (ALLOW_NON_UUID.has(key)) continue;
    if (r.udt_name !== 'uuid') { bad(`${key} is '${r.udt_name}' (expected uuid)`); drift++; }
  }
  if (drift === 0) ok(`all ${rows.length} id/​*_id columns are uuid`);

  // 2) Critical columns must exist AND be uuid.
  console.log('\nCritical columns present and uuid:');
  for (const [table, col] of CRITICAL) {
    const key = `${table}.${col}`;
    const t = typeOf.get(key);
    if (!t) bad(`${key} MISSING`);
    else if (t !== 'uuid') bad(`${key} is '${t}' (expected uuid)`);
    else ok(key);
  }

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — ${pass} ok, ${fail} problem(s)`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('db_verify crashed:', err.message);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
