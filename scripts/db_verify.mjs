// DB integrity / type-drift guard.
//
// Catches the class of bug we hit in the wild: `users.company_id` silently became
// `integer` instead of `char(36)` (a stray `migrate dev`/`db push` re-synced the
// column to the wrong type), which broke every insert with a type mismatch.
//
// Asserts that EVERY id / *_id column in the database is `char(36)` (the app's
// universal key type, holding a UUID string — MySQL has no native UUID type), and
// spot-checks a few critical columns explicitly. Exits non-zero on any drift so
// CI (or a pre-deploy step) can block on it.
//
// Run:  node scripts/db_verify.mjs
import { prisma } from '../src/lib/prisma.js';

let pass = 0;
let fail = 0;
const ok = (name) => { pass++; console.log(`  ✅ ${name}`); };
const bad = (name, extra = '') => { fail++; console.log(`  ❌ ${name} ${extra}`); };

// Columns intentionally NOT char(36) (framework-owned) — excluded from the sweep.
const ALLOW_NON_UUID = new Set([
  '_prisma_migrations.id', // Prisma bookkeeping — varchar checksum id
]);

// Critical columns we assert explicitly (belt-and-suspenders on top of the sweep).
const CRITICAL = [
  ['users', 'id'], ['users', 'company_id'], ['users', 'client_id'],
  ['companies', 'id'], ['clients', 'id'], ['clients', 'company_id'],
  ['zones', 'id'], ['zones', 'client_id'], ['zones', 'parent_zone_id'],
  ['devices', 'id'], ['devices', 'zone_id'], ['devices', 'company_id'], ['devices', 'category_id'],
  ['product_categories', 'id'],
  ['issues', 'id'], ['issues', 'device_id'],
  ['refresh_tokens', 'user_id'],
];

async function main() {
  console.log('DB type-drift verification\n');

  const rows = await prisma.$queryRaw`
    SELECT table_name, column_name, data_type, character_maximum_length
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND (column_name = 'id' OR column_name LIKE '%\\_id')
    ORDER BY table_name, column_name`;

  const isChar36 = (r) => r.data_type === 'char' && Number(r.character_maximum_length) === 36;
  const typeLabel = (r) => `${r.data_type}(${r.character_maximum_length ?? '?'})`;
  const typeOf = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r]));

  // 1) Sweep: every id / *_id column must be char(36) (unless explicitly allowed).
  console.log('Sweep — all id / *_id columns are char(36):');
  let drift = 0;
  for (const r of rows) {
    const key = `${r.table_name}.${r.column_name}`;
    if (ALLOW_NON_UUID.has(key)) continue;
    if (!isChar36(r)) { bad(`${key} is '${typeLabel(r)}' (expected char(36))`); drift++; }
  }
  if (drift === 0) ok(`all ${rows.length} id/​*_id columns are char(36)`);

  // 2) Critical columns must exist AND be char(36).
  console.log('\nCritical columns present and char(36):');
  for (const [table, col] of CRITICAL) {
    const key = `${table}.${col}`;
    const r = typeOf.get(key);
    if (!r) bad(`${key} MISSING`);
    else if (!isChar36(r)) bad(`${key} is '${typeLabel(r)}' (expected char(36))`);
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
