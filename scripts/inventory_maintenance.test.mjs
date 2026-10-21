// Phase 5: preventive maintenance plans generate visits once per due date; AMC
// cover is recorded; a repair links to a Revenue invoice. Local DB + Identity.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dev, ready, startKit } from './v2/testkit.mjs';

const t = ready ? test : test.skip;
let kit;
const ok = (r, status = 200) => assert.equal(r.status, status, JSON.stringify(r.body));
before(async () => { if (ready) kit = await startKit(['ops', 'site-a', 'site-b']); });
after(async () => kit?.stop());

t('a plan due now generates its visit once, and moves on by its frequency', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const plan = await kit.api('/maintenance-plans', 'ops', { method: 'POST', body: { name: `Quarterly camera check ${Date.now()}`, site_id: dev.siteA.siteId, frequency_days: 90, lead_days: 3, next_due_at: today } });
  ok(plan, 201);
  const run = await kit.api('/maintenance-plans/generate', 'ops', { method: 'POST' });
  ok(run);
  assert.ok(run.body.created >= 1);
  const visits = await kit.prisma.serviceVisit.findMany({ where: { maintenancePlanId: plan.body.id } });
  assert.equal(visits.length, 1);
  assert.equal(visits[0].visitType, 'preventive');
  const after = await kit.prisma.maintenancePlan.findUnique({ where: { id: plan.body.id } });
  assert.equal(after.nextDueAt.toISOString().slice(0, 10), new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10));
  ok(await kit.api('/maintenance-plans/generate', 'ops', { method: 'POST' }));
  assert.equal(await kit.prisma.serviceVisit.count({ where: { maintenancePlanId: plan.body.id } }), 1, 'not generated twice');

  const listed = await kit.api('/visits?visit_type=preventive&status=scheduled&limit=100', 'ops');
  assert.ok(listed.body.data.some((v) => v.id === visits[0].id));
  ok(await kit.api(`/visits/${visits[0].id}/start`, 'ops', { method: 'POST', body: {} }));
  const done = await kit.api(`/visits/${visits[0].id}/complete`, 'ops', { method: 'POST', body: { findings: 'Lenses cleaned', outcome: 'fixed' } });
  ok(done);
  assert.equal(done.body.status, 'completed');
  assert.equal((await kit.api('/maintenance-plans', 'site-b')).status, 403, 'site staff do not read plans by default');
});

t('AMC cover can be added and extends the device warranty date', async () => {
  const device = await kit.prisma.device.findFirst({ where: { currentClientId: dev.siteA.siteId, lifecycleState: 'installed' } });
  const end = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
  const w = await kit.api('/warranties', 'ops', { method: 'POST', body: { device_id: device.id, warranty_type: 'amc', start_date: new Date().toISOString().slice(0, 10), end_date: end, contract_id: randomUUID() } });
  ok(w, 201);
  assert.equal((await kit.api(`/devices/${device.id}`, 'ops')).body.warranty_end_date, end);
});

t('a billable repair links to a Revenue invoice', async () => {
  const ro = await kit.prisma.repairOrder.findFirst();
  if (!ro) return;
  const invoice = randomUUID();
  assert.equal((await kit.api(`/repair-orders/${ro.id}/billing`, 'ops', { method: 'PATCH', body: { billable: false, invoice_id: invoice } })).body.detail.code, 'NOT_BILLABLE');
  const linked = await kit.api(`/repair-orders/${ro.id}/billing`, 'ops', { method: 'PATCH', body: { billable: true, invoice_id: invoice } });
  ok(linked);
  assert.equal(linked.body.invoice_id, invoice);
});
