// /api/inventory/v1 against a LOCAL FBOS Identity (docker) and the local
// throwaway Fixly DB, with the users from scripts/v2/fbos_dev_bootstrap.mjs.
// This is the Phase 0 spike and the Phase 2 gate: a client_user sees only their
// own site, sensitive fields stay hidden, Identity down means 503, never allow.
// Skips when Identity or the bootstrap file is not there.
import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

process.env.INVENTORY_API_ENABLED = 'true';
const bootstrapFile = new URL('./v2/.fbos-dev.json', import.meta.url);
const dev = existsSync(bootstrapFile) ? JSON.parse(readFileSync(bootstrapFile, 'utf8')) : null;
const identityUp = dev && (await fetch(`${process.env.FBOS_IDENTITY_URL ?? 'http://localhost:8001'}/health`).then((r) => r.ok).catch(() => false));
const localDb = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '') && /\/test_/.test(process.env.DATABASE_URL ?? '');
const t = identityUp && localDb ? test : test.skip;

let server;
let base;
let prisma;
let env;
let clearActorCache;
const tokens = {};

async function login(email) {
  const res = await fetch(`${dev.identityUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: dev.password }),
  });
  const body = await res.json();
  return body.access_token;
}

async function api(path, who, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(who ? { authorization: `Bearer ${tokens[who]}`, 'x-organization-id': dev.organizationId } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  if (!(identityUp && localDb)) return;
  ({ prisma } = await import('../src/lib/prisma.js'));
  ({ env } = await import('../src/config/env.js'));
  ({ clearActorCache } = await import('../src/modules/inventory/auth/identityClient.js'));
  const { createApp } = await import('../src/app.js');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/inventory/v1`;
  for (const who of ['ops', 'site-a', 'site-b', 'tech']) tokens[who] = await login(`${who}@fixlydev.example.com`);
});
after(async () => {
  server?.close();
  await prisma?.$disconnect();
});

t('no token → 401 in the FBOS error shape', async () => {
  const r = await api('/devices');
  assert.equal(r.status, 401);
  assert.equal(r.body.detail.code, 'UNAUTHORIZED');
});

t('health and readiness are open', async () => {
  assert.equal((await api('/health')).status, 200);
  const ready = await api('/ready');
  assert.equal(ready.status, 200, JSON.stringify(ready.body));
});

t('operator staff see every device, as an FBOS page', async () => {
  const total = await prisma.device.count({ where: { deletedAt: null } });
  const r = await api('/devices?limit=5', 'ops');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.length, 5);
  assert.equal(r.body.page.total, total);
  assert.equal(r.body.page.has_more, true);
  assert.ok('unit_price' in r.body.data[0], 'ops holds inventory.cost.read');
  const next = await api(`/devices?limit=5&cursor=${r.body.page.next_cursor}`, 'ops');
  assert.notEqual(next.body.data[0].id, r.body.data[0].id);
});

t('customer staff see only their own site, without costs', async () => {
  const a = await api('/devices?limit=100', 'site-a');
  assert.equal(a.status, 200);
  const siteADevices = await prisma.device.count({ where: { deletedAt: null, OR: [{ currentClientId: dev.siteA.siteId }, { zone: { clientId: dev.siteA.siteId } }] } });
  assert.equal(a.body.page.total, siteADevices);
  assert.ok(a.body.data.every((d) => d.site?.id === dev.siteA.siteId));
  assert.ok(a.body.data.every((d) => !('unit_price' in d)), 'no prices for customer staff');

  const b = await api('/devices?limit=100', 'site-b');
  assert.ok(b.body.data.every((d) => d.site?.id === dev.siteB.siteId));
  assert.ok(!b.body.data.some((d) => a.body.data.find((x) => x.id === d.id)));
});

t("another customer's device is 404, not 403", async () => {
  const deviceA = await prisma.device.findFirst({ where: { currentClientId: dev.siteA.siteId } });
  assert.equal((await api(`/devices/${deviceA.id}`, 'site-a')).status, 200);
  const r = await api(`/devices/${deviceA.id}`, 'site-b');
  assert.equal(r.status, 404);
  assert.equal(r.body.detail.code, 'DEVICE_NOT_FOUND');
  assert.equal((await api(`/devices/${deviceA.id}/events`, 'site-b')).status, 404);
});

t('customer staff see only their own customer and site', async () => {
  const customers = await api('/customers', 'site-a');
  assert.deepEqual(customers.body.data.map((c) => c.id), [dev.siteA.companyId]);
  const sites = await api('/sites', 'site-a');
  assert.deepEqual(sites.body.data.map((s) => s.id), [dev.siteA.siteId]);
  const zones = await api('/zones?limit=100', 'site-a');
  assert.ok(zones.body.data.every((z) => z.site_id === dev.siteA.siteId));
  const locations = await api('/stock-locations', 'site-a');
  assert.ok(locations.body.data.every((l) => l.site_id === dev.siteA.siteId || l.customer_id === dev.siteA.companyId));
  assert.ok(!locations.body.data.some((l) => l.location_type === 'platform_warehouse'));
});

t('a missing permission is 403 with the code it needs', async () => {
  const r = await api('/device-models', 'site-a');
  assert.equal(r.status, 403);
  assert.equal(r.body.detail.meta.required_permission, 'inventory.catalog.read');
  assert.equal((await api('/device-models', 'ops')).status, 200);
});

t('the device timeline starts with the v1 import', async () => {
  const d = await prisma.device.findFirst({ where: { name: { not: 'Smoke test camera' } } });
  const r = await api(`/devices/${d.id}/events?limit=50`, 'ops');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.at(-1).event_type, 'imported_from_v1');
  const installs = await api(`/devices/${d.id}/installations`, 'ops');
  assert.ok(installs.body.data.length >= 1);
});

t('Documents subject-access: allowed, other customer 404, no attach permission 403', async () => {
  const deviceA = await prisma.device.findFirst({ where: { currentClientId: dev.siteA.siteId } });
  const path = `/internal/subject-access/inventory.device/${deviceA.id}`;
  const ok = await api(`${path}?action=attach`, 'ops');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.organization_id, dev.organizationId);
  assert.match(ok.body.label, /\S/);
  assert.equal((await api(`${path}?action=read`, 'site-a')).status, 200);
  assert.equal((await api(`${path}?action=read`, 'site-b')).status, 404);
  assert.equal((await api(`${path}?action=attach`, 'site-a')).status, 403);
  assert.equal((await api(`/internal/subject-access/inventory.nothing/${deviceA.id}`, 'ops')).status, 404);
});

t('another organization is told nothing exists', async () => {
  const saved = env.FBOS_ORGANIZATION_ID;
  env.FBOS_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000000';
  try {
    const r = await api('/devices', 'ops');
    assert.equal(r.status, 404);
    assert.equal(r.body.detail.code, 'ORGANIZATION_NOT_SERVED');
  } finally {
    env.FBOS_ORGANIZATION_ID = saved;
  }
});

t('Identity unreachable → 503, never allowed', async () => {
  const saved = env.FBOS_IDENTITY_URL;
  env.FBOS_IDENTITY_URL = 'http://127.0.0.1:9';
  clearActorCache();
  try {
    const r = await api('/devices', 'ops');
    assert.equal(r.status, 503);
    assert.equal(r.body.detail.code, 'AUTH_SERVICE_UNAVAILABLE');
  } finally {
    env.FBOS_IDENTITY_URL = saved;
    clearActorCache();
  }
});

t('a bad token is relayed from Identity as 401', async () => {
  const r = await fetch(`${base}/devices`, { headers: { authorization: 'Bearer nope', 'x-organization-id': dev.organizationId } });
  assert.equal(r.status, 401);
});
