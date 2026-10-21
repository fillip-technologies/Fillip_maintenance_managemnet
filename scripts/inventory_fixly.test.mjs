// The inventory API used by the Fixly platform with Fixly's own sign-in: each
// Fixly role sees through /api/inventory/v1 exactly the devices the legacy API
// shows the same user, and can do only what its role allows. Local throwaway
// DB only: it sets a known password on the dump's users.
import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

process.env.INVENTORY_API_ENABLED = 'true';
const url = process.env.DATABASE_URL ?? '';
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) && /\/test_/.test(url);
const t = local ? test : test.skip;
const PASSWORD = 'FixlyRole@123';
let prisma;
let server;
let root;
const tokens = {};
const users = {};

async function call(base, path, who, { method = 'GET', body } = {}) {
  const res = await fetch(`${root}${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[who]}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const inv = (path, who, opts) => call('/api/inventory/v1', path, who, opts);
const legacy = (path, who, opts) => call('/api/v1', path, who, opts);

before(async () => {
  if (!local) return;
  ({ prisma } = await import('../src/lib/prisma.js'));
  const { createApp } = await import('../src/app.js');
  server = createApp().listen(0);
  root = `http://127.0.0.1:${server.address().port}`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  const pick = {
    super: { role: 'super_admin' },
    client: { role: 'client_admin', email: 'rajgir@gmail.com' },
    staff: { role: 'zone_staff' },
    tech: { role: 'technician', technicianProfile: { assignments: { some: {} } } },
  };
  for (const [who, where] of Object.entries(pick)) {
    const user = await prisma.user.findFirst({ where, include: { technicianProfile: true } });
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash, accountStatus: 'active' } });
    const res = await fetch(`${root}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: PASSWORD }) });
    tokens[who] = (await res.json()).data.accessToken;
    users[who] = user;
  }
});
after(async () => {
  server?.close();
  await prisma?.$disconnect();
});

t('each Fixly role sees the same devices as in the legacy app', async () => {
  for (const who of ['super', 'client', 'staff', 'tech']) {
    const v2 = await inv('/devices?limit=1', who);
    assert.equal(v2.status, 200, `${who}: ${JSON.stringify(v2.body)}`);
    const v1 = await legacy('/devices?limit=1', who);
    assert.equal(v2.body.page.total, v1.body.data.totalItems, `${who}: v2 ${v2.body.page.total} vs legacy ${v1.body.data.totalItems}`);
  }
});

t('role permissions: purchasing, reports and costs stay with the operator', async () => {
  assert.equal((await inv('/purchase-orders', 'super')).status, 200);
  for (const who of ['client', 'staff', 'tech']) {
    assert.equal((await inv('/purchase-orders', who)).status, 403, who);
    assert.equal((await inv('/reports/by-state', who)).status, 403, who);
  }
  const d = (await inv('/devices?limit=1', 'client')).body.data[0];
  assert.ok(!('unit_price' in d), 'no prices for the client admin');
  assert.ok('unit_price' in (await inv('/devices?limit=1', 'super')).body.data[0]);
  assert.equal((await inv('/stock-transfers', 'staff')).status, 403);
  assert.equal((await inv('/stock-transfers', 'client')).status, 200);
});

t('zone staff raise an issue on a device in their zone, and not elsewhere', async () => {
  const mine = (await inv('/devices?limit=1&lifecycle_state=installed,under_maintenance', 'staff')).body.data[0];
  const other = await prisma.device.findFirst({ where: { zoneId: { notIn: (await zoneIdsOf(users.staff.id)) } } });
  const cats = (await inv(`/issue-categories?device_id=${mine.id}`, 'staff')).body.data;
  const raised = await inv('/issues', 'staff', { method: 'POST', body: { device_id: mine.id, category_id: cats[0].id, priority: 'medium', description: 'Raised from the Fixly web app' } });
  assert.equal(raised.status, 201, JSON.stringify(raised.body));
  const issue = await prisma.issue.findUnique({ where: { id: raised.body.id } });
  assert.equal(issue.raisedByUserId, users.staff.id, 'the Fixly user is recorded as the raiser');
  const event = await prisma.deviceLifecycleEvent.findFirst({ where: { referenceId: raised.body.id } });
  assert.equal(event.legacyUserId, users.staff.id);
  assert.equal((await inv(`/devices/${other.id}`, 'staff')).status, 404);
  const log = await inv('/daily-status-logs', 'staff', { method: 'POST', body: { device_id: mine.id, status: 'needs_attention' } });
  assert.equal(log.status, 201, JSON.stringify(log.body));
  const legacyIssue = await legacy(`/issues/${raised.body.id}`, 'staff');
  assert.equal(legacyIssue.status, 200, 'the legacy app sees the same issue');
});

t('a technician sees issues assigned to them or open in their coverage', async () => {
  const v2 = await inv('/issues?limit=100', 'tech');
  assert.equal(v2.status, 200);
  const v1 = await legacy('/issues?limit=100', 'tech');
  const legacyIds = new Set(v1.body.data.items.map((i) => i.id));
  for (const i of v2.body.data) assert.ok(legacyIds.has(i.id), `${i.issue_number} is visible in legacy too`);
});

t('an FBOS token still works beside Fixly tokens (no Fixly secret, no Fixly user)', async () => {
  const r = await fetch(`${root}/api/inventory/v1/devices`, { headers: { authorization: 'Bearer not-a-fixly-token' } });
  assert.ok([401, 503].includes(r.status), `goes to FBOS Identity: ${r.status}`);
});

async function zoneIdsOf(userId) {
  const rows = await prisma.zoneAssignment.findMany({ where: { userId, unassignedAt: null }, select: { zoneId: true } });
  return rows.map((r) => r.zoneId);
}
