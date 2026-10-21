#!/usr/bin/env node
/**
 * Legacy smoke test for Fixly v2 phases (development plan, rule 7): the v1 API
 * still works on the migrated schema, and its writes keep the v2 columns in step.
 * Runs against a server started on the LOCAL throwaway DB (a restored dump):
 *
 *   npm run dev            # in another terminal, DATABASE_URL = test_* database
 *   node scripts/v2/legacy_smoke.mjs
 *
 * Because the dump's password hashes are unknown, it sets a known password on
 * the dump's super admin. It refuses to do that on anything but a local test_* DB.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const BASE = process.env.LEGACY_BASE ?? 'http://localhost:3000/api/v1';
const PASSWORD = 'LegacySmoke@123';
const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) || !/\/test_[^/?]*/.test(url)) {
  console.error('Only runs against a local test_* database.');
  process.exit(1);
}
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? '✅' : '❌'} ${name}${cond ? '' : ` ${extra}`}`);
}
async function req(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'super_admin' } });
  await prisma.user.update({
    where: { id: admin.id },
    data: { passwordHash: await bcrypt.hash(PASSWORD, 4), accountStatus: 'active' },
  });

  console.log('\n== Reads ==');
  const login = await req('POST', '/auth/login', { body: { email: admin.email, password: PASSWORD } });
  check('super admin login 200', login.status === 200, JSON.stringify(login.json));
  const token = login.json?.data?.accessToken;
  const devices = await req('GET', '/devices?limit=5', { token });
  check('GET /devices 200', devices.status === 200, `got ${devices.status}`);
  // 445 from the dump, plus one unit per earlier run of this script.
  const smokeUnits = await prisma.device.count({ where: { name: 'Smoke test camera' } });
  check('445 dump devices listed', devices.json?.data?.totalItems === 445 + smokeUnits, `totalItems=${devices.json?.data?.totalItems}`);
  const first = await prisma.device.findFirst({ where: { name: { not: 'Smoke test camera' }, lifecycleState: 'installed' } });
  check('GET /devices/:id 200', (await req('GET', `/devices/${first.id}`, { token })).status === 200);
  for (const path of ['/zones?limit=5', '/issues?limit=5', '/replacement-requests?limit=5', '/companies', '/clients', '/technicians']) {
    const r = await req('GET', path, { token });
    check(`GET ${path} 200`, r.status === 200, `got ${r.status}`);
  }

  console.log('\n== Legacy deploy keeps v2 placement in step ==');
  // A dump device whose site has another leaf zone to move it to.
  let device;
  let otherZone;
  for (const candidate of await prisma.device.findMany({
    where: { name: { not: 'Smoke test camera' }, lifecycleState: 'installed' },
    include: { zone: true },
    take: 50,
  })) {
    otherZone = await prisma.zone.findFirst({
      where: { clientId: candidate.zone.clientId, id: { not: candidate.zoneId }, children: { none: {} } },
    });
    if (otherZone) {
      device = candidate;
      break;
    }
  }
  const moved = await req('POST', `/devices/${device.id}/deploy`, { token, body: { zoneId: otherZone.id } });
  check('POST /devices/:id/deploy 200', moved.status === 200, JSON.stringify(moved.json));
  const active = await prisma.deviceInstallation.findFirst({ where: { deviceId: device.id, status: 'active' } });
  check('active installation follows the new zone', active?.zoneId === otherZone.id);
  const lastEvent = await prisma.deviceLifecycleEvent.findFirst({ where: { deviceId: device.id }, orderBy: { occurredAt: 'desc' } });
  check('a relocated event was written', lastEvent?.eventType === 'relocated' && lastEvent.fromZoneId === device.zoneId, JSON.stringify(lastEvent));
  const back = await req('POST', `/devices/${device.id}/deploy`, { token, body: { zoneId: device.zoneId } });
  check('deploy back to the original zone 200', back.status === 200);

  console.log('\n== New unit through the legacy API ==');
  const category = await prisma.productCategory.findFirst({ where: { code: 'CAM' } });
  const unit = await req('POST', '/devices', {
    token,
    body: { categoryId: category.id, companyId: device.companyId, name: 'Smoke test camera' },
  });
  check('POST /devices (in stock) 201', unit.status === 201, JSON.stringify(unit.json));
  const created = await prisma.device.findUnique({ where: { id: unit.json?.data?.id } });
  const companyStore = await prisma.stockLocation.findFirst({ where: { locationType: 'company_store', companyId: device.companyId } });
  check('new unit is in_company_stock at the company store', created?.lifecycleState === 'in_company_stock' && created.currentLocationId === companyStore.id, JSON.stringify(created));
  check('new unit carries the operator organization', created?.organizationId === process.env.FBOS_ORGANIZATION_ID);
  const deployed = await req('POST', `/devices/${created.id}/deploy`, { token, body: { zoneId: otherZone.id } });
  check('deploy the new unit 200', deployed.status === 200);
  const afterDeploy = await prisma.device.findUnique({ where: { id: created.id } });
  check('deployed unit is installed, location cleared', afterDeploy.lifecycleState === 'installed' && afterDeploy.currentLocationId === null);
  const retired = await req('PATCH', `/devices/${created.id}/status`, { token, body: { status: 'retired' } });
  const redeploy = await req('POST', `/devices/${created.id}/deploy`, { token, body: { zoneId: otherZone.id } });
  check('PATCH status retired 200', retired.status === 200, JSON.stringify(retired.json));
  const afterRetire = await prisma.device.findUnique({ where: { id: created.id } });
  check('retired in v2 too', afterRetire.lifecycleState === 'retired');
  check('a retired unit cannot be deployed again → 409 DEVICE_RETIRED', redeploy.status === 409 && JSON.stringify(redeploy.json).includes('DEVICE_RETIRED'), JSON.stringify(redeploy.json));
  const events = await prisma.deviceLifecycleEvent.findMany({ where: { deviceId: created.id }, orderBy: { occurredAt: 'asc' } });
  check('history: registered → installed → retired', events.map((e) => e.eventType).join(',') === 'registered,installed,retired', events.map((e) => e.eventType).join(','));

  console.log('\n== Delete guards ==');
  const zoneDelete = await req('DELETE', `/zones/${device.zoneId}`, { token });
  check('DELETE a zone with devices → 409 ZONE_HAS_DEVICES', zoneDelete.status === 409 && JSON.stringify(zoneDelete.json).includes('ZONE_HAS_DEVICES'), JSON.stringify(zoneDelete.json));
  const clientDelete = await req('DELETE', `/clients/${device.zone.clientId}`, { token });
  check('DELETE a client with devices → 409 CLIENT_HAS_DEVICES', clientDelete.status === 409 && JSON.stringify(clientDelete.json).includes('CLIENT_HAS_DEVICES'), JSON.stringify(clientDelete.json));
  const companyDelete = await req('DELETE', `/companies/${device.companyId}`, { token });
  check('DELETE a company with devices → 409 COMPANY_HAS_DEVICES', companyDelete.status === 409 && JSON.stringify(companyDelete.json).includes('COMPANY_HAS_DEVICES'), JSON.stringify(companyDelete.json));

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
