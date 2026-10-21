#!/usr/bin/env node
/**
 * LOCAL DEV ONLY. Builds the FBOS side of the Fixly v2 integration in a local
 * docker Identity (never the shared remote one), then links the local Fixly DB
 * to it (development plan Phase 0 spike + Phase 1 FBOS data prep):
 *
 *   - an Identity client "Fixly dev" whose first organization is the operator;
 *   - one org unit per Fixly company (branch) and per Fixly client/site (department);
 *   - test users (all @fixlydev.example.com, password FBOS_DEV_PASSWORD):
 *       ops@fixlydev.example.com         employee, every inventory code organization-wide
 *       site-a@fixlydev.example.com      client_user, device + issue reads scoped to site A
 *       site-b@fixlydev.example.com      client_user, device + issue reads scoped to site B
 *       tech@fixlydev.example.com        contractor, device read + own issues
 *   - Fixly companies/clients get fbos_org_unit_id + organization_id, and a
 *     Fixly technician is linked to tech@ (users.fbos_user_id), all logged in fbos_links.
 *
 * Writes scripts/v2/.fbos-dev.json (gitignored) with the ids for tests.
 * Idempotent: re-running finds what already exists.
 *
 *   node scripts/v2/fbos_dev_bootstrap.mjs
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const IDENTITY = (process.env.FBOS_IDENTITY_URL ?? 'http://localhost:8001') + '/api/identity/v1';
const PASSWORD = process.env.FBOS_DEV_PASSWORD ?? 'FixlyDev@12345';
const DB_CONTAINER = process.env.FBOS_DB_CONTAINER ?? 'fbos_services-db-1';
const FBOS_ROOT_ENV = join(here, '../../../../fbos_services/.env');

if (!/localhost|127\.0\.0\.1/.test(IDENTITY)) {
  console.error('FBOS_IDENTITY_URL must be a local Identity.');
  process.exit(1);
}
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  console.error('DATABASE_URL must be the local throwaway Fixly DB.');
  process.exit(1);
}

const rootPassword = readFileSync(FBOS_ROOT_ENV, 'utf8').match(/^MYSQL_ROOT_PASSWORD=(.*)$/m)?.[1]?.trim();
function identitySql(sql) {
  const out = execFileSync('docker', ['exec', DB_CONTAINER, 'mysql', '-uroot', `-p${rootPassword}`, 'fbos_identity', '-N', '-B', '-e', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return out.trim();
}

async function call(method, path, { token, org, body } = {}) {
  const res = await fetch(IDENTITY + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(org ? { 'x-organization-id': org } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return data;
}

async function acceptInvitation(email) {
  const token = identitySql(
    `SELECT c.invitation_token FROM user_credentials c JOIN users u ON u.id = c.user_id WHERE u.email = '${email}' AND u.status = 'invited'`,
  );
  if (token) await call('POST', '/auth/invitations/accept', { body: { token, password: PASSWORD } });
}

const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: PASSWORD } }));
const userIdByEmail = (email) => identitySql(`SELECT id FROM users WHERE email = '${email}'`) || null;

async function main() {
  const prisma = new PrismaClient();
  const platform = await call('POST', '/auth/platform/login', {
    body: { email: 'superadmin@fbos.platform', password: process.env.FBOS_PLATFORM_PASSWORD ?? 'Password@123' },
  });

  // 1. The operator: an Identity client + its first organization.
  const adminEmail = 'admin@fixlydev.example.com';
  if (!userIdByEmail(adminEmail)) {
    await call('POST', '/clients', {
      token: platform.access_token,
      body: {
        name: 'Fixly dev',
        code: 'FIXLYDEV',
        contact_email: 'contact@fixlydev.example.com',
        admin_email: adminEmail,
        admin_name: 'Fixly dev admin',
        max_organizations: 2,
        max_users_per_org: 100,
      },
    });
  }
  await acceptInvitation(adminEmail);
  const admin = await login(adminEmail);
  const org = admin.user.organization.id;
  const token = admin.access_token;

  // 2. Org units: customer (branch) → site (department).
  const units = (await call('GET', '/org-units?limit=100', { token, org })).data ?? [];
  const unitByCode = new Map(units.map((u) => [u.code, u]));
  async function ensureUnit(code, name, unitType, parentId) {
    if (unitByCode.has(code)) return unitByCode.get(code);
    const unit = await call('POST', '/org-units', { token, org, body: { code, name, unit_type: unitType, ...(parentId ? { parent_id: parentId } : {}) } });
    unitByCode.set(code, unit);
    return unit;
  }
  const short = (id) => id.replace(/-/g, '').slice(0, 8).toUpperCase();
  const companies = await prisma.company.findMany({ orderBy: { name: 'asc' }, include: { clients: { orderBy: { name: 'asc' } } } });
  const siteUnits = [];
  for (const company of companies) {
    const branch = await ensureUnit(`CUST-${short(company.id)}`, company.name, 'branch');
    await prisma.company.update({ where: { id: company.id }, data: { fbosOrgUnitId: branch.id, organizationId: org } });
    await link(prisma, 'company', company.id, 'org_unit', branch.id);
    for (const site of company.clients) {
      const unit = await ensureUnit(`SITE-${short(site.id)}`, site.name, 'department', branch.id);
      await prisma.client.update({ where: { id: site.id }, data: { fbosOrgUnitId: unit.id, organizationId: org } });
      await link(prisma, 'client', site.id, 'org_unit', unit.id);
      siteUnits.push({ siteId: site.id, siteName: site.name, companyId: company.id, unitId: unit.id });
    }
  }

  // 3. Test users. Sites A and B belong to different customers.
  const siteA = siteUnits.find((s) => s.siteName === 'Rajgir Zoo Safari') ?? siteUnits[0];
  const siteB = siteUnits.find((s) => s.companyId !== siteA.companyId);
  const inventoryCodes = identitySql("SELECT code FROM permissions WHERE code LIKE 'inventory.%' ORDER BY code").split('\n').filter(Boolean);
  if (inventoryCodes.length === 0) throw new Error('Identity has no inventory.* codes: restart identity on this branch first');

  const scoped = (codes, unitId, selfOnly = false) => codes.map((code) => ({ code, scope_unit_id: unitId, self_only: selfOnly }));
  const people = [
    { email: 'ops@fixlydev.example.com', name: 'Ops manager', user_type: 'employee', permissions: inventoryCodes.map((code) => ({ code })) },
    { email: 'site-a@fixlydev.example.com', name: `Staff ${siteA.siteName}`, user_type: 'client_user', permissions: scoped(['inventory.device.read', 'inventory.issue.read', 'inventory.issue.write', 'inventory.warranty.read'], siteA.unitId) },
    { email: 'site-b@fixlydev.example.com', name: `Staff ${siteB.siteName}`, user_type: 'client_user', permissions: scoped(['inventory.device.read', 'inventory.issue.read', 'inventory.issue.write'], siteB.unitId) },
    {
      email: 'tech@fixlydev.example.com', name: 'Field technician', user_type: 'contractor',
      permissions: [
        { code: 'inventory.device.read' }, { code: 'inventory.device.write' },
        { code: 'inventory.issue.read', self_only: true }, { code: 'inventory.issue.write' },
      ],
    },
  ];
  const users = {};
  for (const p of people) {
    if (!userIdByEmail(p.email)) {
      await call('POST', '/users', { token, org, body: { name: p.name, email: p.email, user_type: p.user_type, permissions: p.permissions } });
    }
    await acceptInvitation(p.email);
    users[p.email] = userIdByEmail(p.email);
  }

  // 4. Link one Fixly technician to the FBOS technician.
  const technician = await prisma.technician.findFirst({ orderBy: { createdAt: 'asc' }, include: { user: true } });
  if (technician && !technician.user.fbosUserId) {
    await prisma.user.update({ where: { id: technician.userId }, data: { fbosUserId: users['tech@fixlydev.example.com'] } });
  }
  if (technician) await link(prisma, 'user', technician.userId, 'identity_user', users['tech@fixlydev.example.com']);

  const out = { identityUrl: IDENTITY, organizationId: org, password: PASSWORD, adminEmail, users, siteA, siteB, siteUnits, technicianId: technician?.id ?? null };
  writeFileSync(join(here, '.fbos-dev.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ organizationId: org, siteA: siteA.siteName, siteB: siteB.siteName, users }, null, 2));
  console.log(`\nSet FBOS_ORGANIZATION_ID=${org} in .env, then run the backfill.`);
  await prisma.$disconnect();
}

async function link(prisma, entityType, entityId, fbosType, fbosId) {
  await prisma.fbosLink.upsert({
    where: { entityType_entityId_fbosType: { entityType, entityId, fbosType } },
    create: { entityType, entityId, fbosType, fbosId, source: 'fbos_dev_bootstrap' },
    update: { fbosId },
  });
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
