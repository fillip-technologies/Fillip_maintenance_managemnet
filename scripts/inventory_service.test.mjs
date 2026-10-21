// Phase 4 gate: fault → visit → replacement → vendor RMA → back refurbished →
// reinstalled; a second device retired and disposed through the wipe gate.
// Writes to the local throwaway DB; needs the local docker Identity.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dev, ready, startKit, provisionAtSiteA } from './v2/testkit.mjs';

const t = ready ? test : test.skip;
let kit;
const s = {};
const ok = (r, status = 200) => assert.equal(r.status, status, JSON.stringify(r.body));
before(async () => {
  if (!ready) return;
  kit = await startKit();
  s.p = await provisionAtSiteA(kit, 3, { toSite: 2 });
  [s.d1, s.spare, s.d3] = s.p.deviceIds;
  s.zones = await kit.prisma.zone.findMany({ where: { clientId: dev.siteA.siteId, children: { none: {} } }, take: 2 });
  const d1 = (await kit.api(`/devices/${s.d1}`, 'ops')).body;
  ok(await kit.api('/installations', 'ops', { method: 'POST', version: d1.version, body: { device_id: s.d1, zone_id: s.zones[0].id, position_label: 'Gate 2' } }), 201);
});
after(async () => kit?.stop());

t('1. customer staff raise an issue: number, warranty, SLA, technicians told', async () => {
  const cats = await kit.api(`/issue-categories?device_id=${s.d1}`, 'site-a');
  ok(cats);
  const r = await kit.api('/issues', 'site-a', { method: 'POST', body: { device_id: s.d1, category_id: cats.body.data[0].id, priority: 'high', description: 'No video since morning' } });
  ok(r, 201);
  assert.match(r.body.issue_number, /^ISS-\d{4}-\d{4}$/);
  assert.equal(r.body.warranty_status, 'in_warranty');
  assert.equal(r.body.site_id, dev.siteA.siteId);
  const due = new Date(r.body.sla_due_at) - new Date(r.body.created_at);
  assert.ok(Math.abs(due - 24 * 3_600_000) < 5_000, 'high priority = 24 h');
  s.issue = r.body;
  assert.equal((await kit.api(`/issues/${s.issue.id}`, 'site-b')).status, 404, "another customer's issue does not exist for site B");
  const legacy = await kit.prisma.device.findUnique({ where: { id: s.d1 } });
  assert.equal(legacy.status, 'under_maintenance', 'legacy apps see the open issue');
});

t('2. assign, technician visits: needs replacement → device faulty', async () => {
  const assigned = await kit.api(`/issues/${s.issue.id}/assign`, 'ops', { method: 'POST', version: s.issue.version, body: { technician_id: dev.technicianId } });
  ok(assigned);
  assert.equal(assigned.body.status, 'assigned');
  const mine = await kit.api('/issues?mine=true', 'tech');
  assert.ok(mine.body.data.some((i) => i.id === s.issue.id), 'the technician sees it');
  const visit = await kit.api(`/issues/${s.issue.id}/visits`, 'tech', { method: 'POST', body: { latitude: 25.03, longitude: 85.42 } });
  ok(visit, 201);
  assert.equal((await kit.api(`/issues/${s.issue.id}`, 'tech')).body.status, 'in_progress');
  const out = await kit.api(`/visits/${visit.body.id}/check-out`, 'tech', { method: 'POST', body: { outcome: 'needs_replacement', findings: 'Board burnt' } });
  ok(out);
  const d1 = (await kit.api(`/devices/${s.d1}`, 'ops')).body;
  assert.equal(d1.lifecycle_state, 'faulty');
  assert.equal(d1.zone.id, s.zones[0].id, 'still in its zone');
});

t('3. replacement: request, approve picks the site spare, complete swaps them', async () => {
  const req = await kit.api('/replacements', 'ops', { method: 'POST', body: { issue_id: s.issue.id, reason: 'unrepairable', old_device_disposition: 'vendor_rma' } });
  ok(req, 201);
  assert.equal(req.body.replacement_basis, 'warranty');
  assert.equal((await kit.api(`/devices/${s.d1}`, 'ops')).body.lifecycle_state, 'pending_replacement');
  const blocked = await kit.api(`/issues/${s.issue.id}/status`, 'ops', { method: 'POST', body: { to_status: 'resolved' } });
  assert.equal(blocked.body.detail.code, 'REPLACEMENT_PENDING');

  const approved = await kit.api(`/replacements/${req.body.id}/approve`, 'ops', { method: 'POST', body: {} });
  ok(approved);
  assert.equal(approved.body.replacement_device.id, s.spare, 'nearest spare: same model in the site store');
  assert.equal(approved.body.stock_transfer, null, 'no transfer needed');
  assert.equal((await kit.api(`/devices/${s.spare}`, 'ops')).body.lifecycle_state, 'reserved');

  const done = await kit.api(`/replacements/${req.body.id}/complete`, 'tech', { method: 'POST', body: {} });
  ok(done);
  const spare = (await kit.api(`/devices/${s.spare}`, 'ops')).body;
  assert.equal(spare.lifecycle_state, 'installed');
  assert.equal(spare.zone.id, s.zones[0].id);
  assert.equal(spare.installation.installation_type, 'replacement');
  const old = (await kit.api(`/devices/${s.d1}`, 'ops')).body;
  assert.equal(old.lifecycle_state, 'faulty');
  assert.equal(old.location.id, s.p.siteStoreId);
  const issue = (await kit.api(`/issues/${s.issue.id}`, 'ops')).body;
  assert.equal(issue.status, 'resolved');
  assert.equal(issue.resolution_type, 'replaced');
});

t('4. warranty RMA: out to the vendor and back refurbished', async () => {
  const ro = await kit.api('/repair-orders', 'ops', { method: 'POST', body: { device_id: s.d1, issue_id: s.issue.id, repair_type: 'vendor_rma', vendor_id: s.p.vendorId, is_warranty_claim: true, rma_number: 'RMA-77' } });
  ok(ro, 201);
  assert.equal(ro.body.cost_borne_by, 'vendor');
  assert.equal((await kit.api(`/repair-orders/${ro.body.id}/dispatch`, 'ops', { method: 'POST', version: ro.body.version, idempotent: true, body: {} })).body.detail.code, 'INVALID_REPAIR_STATUS');
  const approved = await kit.api(`/repair-orders/${ro.body.id}/approve`, 'ops', { method: 'POST', version: ro.body.version });
  ok(approved);
  const key = randomUUID();
  const sent = await kit.api(`/repair-orders/${ro.body.id}/dispatch`, 'ops', { method: 'POST', version: approved.body.version, idempotent: key, body: { tracking_number: 'BD123' } });
  ok(sent);
  assert.equal(sent.body.status, 'sent');
  assert.equal((await kit.api(`/devices/${s.d1}`, 'ops')).body.lifecycle_state, 'in_transit');
  ok(await kit.api(`/repair-orders/${ro.body.id}/arrived`, 'ops', { method: 'POST' }));
  assert.equal((await kit.api(`/devices/${s.d1}`, 'ops')).body.lifecycle_state, 'at_vendor_rma');
  const closed = await kit.api(`/repair-orders/${ro.body.id}/close`, 'ops', { method: 'POST', version: sent.body.version, body: { outcome: 'repaired', return_location_id: s.p.siteStoreId, parts: [{ part_name: 'Main board', covered_by_warranty: true }] } });
  ok(closed);
  const back = (await kit.api(`/devices/${s.d1}`, 'ops')).body;
  assert.equal(back.lifecycle_state, 'in_client_stock');
  assert.equal(back.condition, 'refurbished');
  assert.equal(back.repair_count, 1);
});

t('5. the repaired unit is reinstalled in another zone', async () => {
  const d1 = (await kit.api(`/devices/${s.d1}`, 'ops')).body;
  const r = await kit.api('/installations', 'tech', { method: 'POST', version: d1.version, body: { device_id: s.d1, zone_id: s.zones[1].id, installation_type: 'reinstall_after_repair' } });
  ok(r, 201);
  const events = (await kit.api(`/devices/${s.d1}/events?limit=100`, 'ops')).body.data.map((e) => e.event_type);
  for (const e of ['issue_raised', 'visit_done', 'replaced', 'warranty_claimed', 'repair_returned', 'installed']) assert.ok(events.includes(e), `timeline has ${e}`);
});

t('6. retire and dispose: a data-storing device needs the wipe certificate', async () => {
  ok(await kit.api(`/devices/${s.d3}/retire`, 'ops', { method: 'POST', body: { reason: 'Damaged in storage' } }));
  const d = await kit.api('/disposals', 'ops', { method: 'POST', body: { device_id: s.d3, disposal_method: 'recycled' } });
  ok(d, 201);
  assert.equal((await kit.api(`/disposals/${d.body.id}/complete`, 'ops', { method: 'POST', body: { data_wiped: true } })).body.detail.code, 'INVALID_DISPOSAL_STATUS');
  ok(await kit.api(`/disposals/${d.body.id}/approve`, 'ops', { method: 'POST', body: {} }));
  const noCert = await kit.api(`/disposals/${d.body.id}/complete`, 'ops', { method: 'POST', body: { data_wiped: true } });
  assert.equal(noCert.body.detail.code, 'DATA_WIPE_REQUIRED');
  const done = await kit.api(`/disposals/${d.body.id}/complete`, 'ops', { method: 'POST', body: { data_wiped: true, certificate_document_id: randomUUID() } });
  ok(done);
  const gone = (await kit.api(`/devices/${s.d3}`, 'ops')).body;
  assert.equal(gone.lifecycle_state, 'disposed');
  assert.equal(gone.location, null);
});

t('7. daily status log sets health', async () => {
  const r = await kit.api('/daily-status-logs', 'tech', { method: 'POST', body: { device_id: s.spare, status: 'needs_attention', notes: 'Blurry at night' } });
  ok(r, 201);
  assert.equal((await kit.api(`/devices/${s.spare}`, 'ops')).body.health_status, 'needs_attention');
});

t('8. reports are for operator staff only', async () => {
  for (const path of ['stock-on-hand', 'by-state', 'warranty-expiry', 'open-repairs', 'repeat-failures', 'transfers-in-transit']) {
    ok(await kit.api(`/reports/${path}`, 'ops'));
  }
  assert.equal((await kit.api('/reports/stock-on-hand', 'site-a')).status, 403);
});

t('9. warranty notices go out once per step', async () => {
  const { queueWarrantyNotices } = await import('../src/modules/inventory/services/warrantyNotices.js');
  const w = await kit.prisma.warranty.findFirst({ where: { deviceId: s.spare } });
  await kit.prisma.warranty.update({ where: { id: w.id }, data: { endDate: new Date(Date.now() + 5 * 86_400_000), lastNoticeDays: null } });
  assert.ok((await queueWarrantyNotices()) >= 1);
  assert.equal((await kit.prisma.warranty.findUnique({ where: { id: w.id } })).lastNoticeDays, 7);
  const again = await kit.prisma.outbox.count({ where: { aggregateId: w.id } });
  await queueWarrantyNotices();
  assert.equal(await kit.prisma.outbox.count({ where: { aggregateId: w.id } }), again);
});
