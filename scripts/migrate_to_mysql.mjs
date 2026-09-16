// One-time data migration: Postgres (Neon, source) → MySQL (Hostinger, target).
//
// SAFETY: this script only ever READS from the source Postgres database (via
// plain `pg`, since the Prisma schema/client now targets MySQL only) and only
// ever WRITES to the target MySQL database (via the app's Prisma client). It
// never issues an INSERT/UPDATE/DELETE/DDL statement against the source.
//
// Required env vars:
//   MIGRATION_SOURCE_DATABASE_URL  — the OLD Postgres/Neon connection string
//                                    (read-only use; e.g. copy the value your
//                                    .env's DATABASE_URL had before you
//                                    switched it over to MySQL)
//   DATABASE_URL                   — the NEW MySQL connection string (already
//                                    loaded by src/config/env.js / .env; this
//                                    is what the Prisma client below writes to)
//
// Idempotent/resumable: before inserting into each table, it reads which ids
// already exist in the MySQL target and skips them — safe to re-run after a
// partial failure.
//
// Run:  node scripts/migrate_to_mysql.mjs
import pg from 'pg';
import { prisma } from '../src/lib/prisma.js';

const SOURCE_URL = process.env.MIGRATION_SOURCE_DATABASE_URL;
if (!SOURCE_URL) {
  console.error('❌ MIGRATION_SOURCE_DATABASE_URL is not set. Refusing to run.');
  console.error('   Set it to the Postgres/Neon connection string (read-only use).');
  process.exit(1);
}

// Two irregular column→field mappings that don't follow snake_case→camelCase
// (see prisma/schema.prisma: Zone.createdById @map("created_by"), Device.addedById @map("added_by")).
const FIELD_OVERRIDES = {
  created_by: 'createdById',
  added_by: 'addedById',
};

function toCamelField(column) {
  if (FIELD_OVERRIDES[column]) return FIELD_OVERRIDES[column];
  return column.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function mapRow(row) {
  const out = {};
  for (const [column, value] of Object.entries(row)) {
    out[toCamelField(column)] = value;
  }
  return out;
}

// Tables in FK-safe (parents-before-children) order, matching prisma/schema.prisma.
const TABLES = [
  { table: 'companies', model: 'company' },
  { table: 'verticals', model: 'vertical' },
  { table: 'clients', model: 'client' },
  { table: 'client_verticals', model: 'clientVertical' },
  { table: 'users', model: 'user' },
  { table: 'zones', model: 'zone' },
  { table: 'zone_assignments', model: 'zoneAssignment' },
  { table: 'hardware_types', model: 'hardwareType' },
  { table: 'product_categories', model: 'productCategory' },
  { table: 'product_types', model: 'productType' },
  { table: 'devices', model: 'device' },
  { table: 'issue_categories', model: 'issueCategory' },
  { table: 'technicians', model: 'technician' },
  { table: 'issues', model: 'issue' },
  { table: 'issue_status_history', model: 'issueStatusHistory' },
  { table: 'daily_status_logs', model: 'dailyStatusLog' },
  { table: 'technician_assignments', model: 'technicianAssignment' },
  { table: 'refresh_tokens', model: 'refreshToken' },
  { table: 'device_tokens', model: 'deviceToken' },
];

const CHUNK_SIZE = 500;

async function copyTable(pgClient, { table, model }) {
  // Read-only against the source.
  const { rows } = await pgClient.query(`SELECT * FROM ${table}`);
  const sourceRows = rows.map(mapRow);

  const existing = await prisma[model].findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((r) => r.id));
  const toInsert = sourceRows.filter((r) => !existingIds.has(r.id));

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + CHUNK_SIZE);
    const res = await prisma[model].createMany({ data: chunk });
    inserted += res.count;
  }

  const status = inserted === toInsert.length ? '✅' : '⚠️ ';
  console.log(
    `${status} ${table}: source=${sourceRows.length} alreadyInTarget=${existingIds.size} inserted=${inserted}`
  );
  if (inserted !== toInsert.length) {
    console.warn(`   mismatch: expected to insert ${toInsert.length}, actually inserted ${inserted}`);
  }
  return { table, source: sourceRows.length, inserted, alreadyInTarget: existingIds.size };
}

async function main() {
  console.log('Postgres (Neon) → MySQL data migration\n');
  console.log('Source: read-only Postgres connection (MIGRATION_SOURCE_DATABASE_URL)');
  console.log('Target: MySQL via Prisma (DATABASE_URL)\n');

  const pgClient = new pg.Client({ connectionString: SOURCE_URL });
  await pgClient.connect();

  const results = [];
  try {
    for (const t of TABLES) {
      results.push(await copyTable(pgClient, t));
    }
  } finally {
    await pgClient.end();
    await prisma.$disconnect();
  }

  const totalSource = results.reduce((s, r) => s + r.source, 0);
  const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
  const anyMismatch = results.some((r) => r.inserted + r.alreadyInTarget !== r.source);

  console.log(`\nDone. ${totalInserted} row(s) inserted across ${results.length} table(s).`);
  console.log(`Total source rows seen: ${totalSource}`);
  if (anyMismatch) {
    console.error('❌ At least one table has a row-count mismatch — review the log above.');
    process.exit(1);
  }
  console.log('✅ All tables fully accounted for in the target.');
}

main().catch(async (err) => {
  console.error('migrate_to_mysql crashed:', err);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
