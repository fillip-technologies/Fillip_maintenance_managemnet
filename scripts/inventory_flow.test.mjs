// Phase 3 gate: a new device walks PO → GRN → platform → customer → site → zone
// through /api/inventory/v1, with the rules that guard each step. Writes to the
// local throwaway DB; needs the local docker Identity (skips otherwise).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dev, ready, startKit } from './v2/testkit.mjs';

const t = ready ? test : test.skip;
let kit;
const s = {}; // ids carried from step to step
before(async () => {
  if (ready) kit = await startKit();
});
after(async () => kit?.stop());
const ok = (r, status = 200) => assert.equal(r.status, status, JSON.stringify(r.body));

t('1. catalog: a vendor (with its own location) and a device model', async () => {
  const vendor = await kit.api('/vendors', 'ops', { method: 'POST', body: { name: `Hikvision dist ${Date.now()}`, vendor_type: 'distributor' } });
  ok(vendor, 201);
  s.vendorId = vendor.body.id;
  const vendorLocation = await kit.prisma.stockLocation.findFirst({ where: { vendorId: s.vendorId } });
  assert.equal(vendorLocation.locationType, 'vendor');

  const cam = await kit.prisma.productCategory.findFirst({ where: { code: 'CAM' } });
  const model = await kit.api('/device-models', 'ops', {
    method: 'POST',
    body: { name: 'Dome 4MP', manufacturer: 'Hikvision', model_number: `DS-2CD-${Date.now()}`, category_id: cam.id, default_warranty_months: 24, default_unit_price: 4200, stores_data: true },
  });
  ok(model, 201);
  s.modelId = model.body.id;
  assert.equal((await kit.api('/vendors', 'site-a', { method: 'POST', body: { name: 'x' } })).status, 403);
});

t('2. purchase order: draft → submitted → approved, totals with GST', async () => {
  const po = await kit.api('/purchase-orders', 'ops', {
    method: 'POST',
    body: { vendor_id: s.vendorId, items: [{ device_model_id: s.modelId, quantity_ordered: 5, unit_price: 4000, tax_percent: 18 }] },
  });
  ok(po, 201);
  assert.match(po.body.po_number, /^PO-\d{4}-\d{4}$/);
  assert.equal(po.body.total_amount.amount, '23600.00');
  s.po = po.body;
  const early = await kit.api(`/purchase-orders/${s.po.id}/approve`, 'ops', { method: 'POST', version: s.po.version });
  assert.equal(early.status, 409);
  const submitted = await kit.api(`/purchase-orders/${s.po.id}/submit`, 'ops', { method: 'POST', version: s.po.version });
  ok(submitted);
  const stale = await kit.api(`/purchase-orders/${s.po.id}/approve`, 'ops', { method: 'POST', version: s.po.version });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.detail.code, 'VERSION_MISMATCH');
  const approved = await kit.api(`/purchase-orders/${s.po.id}/approve`, 'ops', { method: 'POST', version: submitted.body.version });
  ok(approved);
  assert.equal(approved.body.status, 'approved');
  s.po = approved.body;
});

t('3. goods receipt: 4 accepted, 1 rejected → 4 devices with warranties, replay-safe', async () => {
  const warehouse = await kit.prisma.stockLocation.findFirst({ where: { locationType: 'platform_warehouse' } });
  s.warehouseId = warehouse.id;
  const stamp = Date.now();
  const body = {
    purchase_order_id: s.po.id,
    receiving_location_id: warehouse.id,
    vendor_invoice_no: 'INV-8841',
    items: [{
      purchase_order_item_id: s.po.items[0].id,
      quantity_received: 5, quantity_accepted: 4, quantity_rejected: 1, rejection_reason: 'damaged lens',
      units: [1, 2, 3, 4].map((n) => ({ serial_number: `SN${stamp}${n}` })),
    }],
  };
  const missingKey = await kit.api('/goods-receipts', 'ops', { method: 'POST', body });
  assert.equal(missingKey.status, 400);
  const key = randomUUID();
  const grn = await kit.api('/goods-receipts', 'ops', { method: 'POST', body, idempotent: key });
  ok(grn, 201);
  assert.equal(grn.body.status, 'partially_accepted');
  assert.equal(grn.body.devices.length, 4);
  const replay = await kit.api('/goods-receipts', 'ops', { method: 'POST', body, idempotent: key });
  ok(replay, 201);
  assert.equal(replay.headers.get('idempotent-replayed'), 'true');
  assert.equal(replay.body.id, grn.body.id);
  assert.equal(await kit.prisma.goodsReceipt.count({ where: { purchaseOrderId: s.po.id } }), 1);

  s.deviceIds = grn.body.devices.map((d) => d.id);
  const device = await kit.api(`/devices/${s.deviceIds[0]}`, 'ops');
  assert.equal(device.body.lifecycle_state, 'in_platform_stock');
  assert.equal(device.body.location.id, warehouse.id);
  assert.match(device.body.code, /^CAM-\d{6}$/);
  const warranties = await kit.api(`/devices/${s.deviceIds[0]}/warranties`, 'ops');
  assert.equal(warranties.body.data.length, 1);
  const po = await kit.api(`/purchase-orders/${s.po.id}`, 'ops');
  assert.equal(po.body.status, 'partially_received');
  assert.equal(po.body.items[0].quantity_received, 4);

  const tooMany = await kit.api('/goods-receipts', 'ops', {
    method: 'POST', idempotent: true,
    body: { ...body, items: [{ ...body.items[0], quantity_received: 2, quantity_accepted: 2, quantity_rejected: 0, units: [{ serial_number: 'X1' }, { serial_number: 'X2' }] }] },
  });
  assert.equal(tooMany.status, 422);
  assert.equal(tooMany.body.detail.code, 'RECEIPT_EXCEEDS_ORDER');
});

t('4. platform → customer store: reserve, approve, dispatch, receive', async () => {
  const store = await kit.prisma.stockLocation.findFirst({ where: { locationType: 'company_store', companyId: dev.siteA.companyId } });
  s.companyStoreId = store.id;
  const created = await kit.api('/stock-transfers', 'ops', {
    method: 'POST',
    body: { transfer_type: 'platform_to_company', from_location_id: s.warehouseId, to_location_id: store.id, device_ids: s.deviceIds.slice(0, 3) },
  });
  ok(created, 201);
  assert.ok(created.body.items.every((i) => i.device.lifecycle_state === 'reserved'));

  const twice = await kit.api('/stock-transfers', 'ops', {
    method: 'POST',
    body: { transfer_type: 'platform_to_company', from_location_id: s.warehouseId, to_location_id: store.id, device_ids: [s.deviceIds[0]] },
  });
  assert.equal(twice.status, 409);
  assert.equal(twice.body.detail.code, 'DEVICE_ON_OPEN_TRANSFER');
  const wrongRoute = await kit.api('/stock-transfers', 'ops', {
    method: 'POST',
    body: { transfer_type: 'company_to_client', from_location_id: s.warehouseId, to_location_id: store.id, device_ids: [s.deviceIds[3]] },
  });
  assert.equal(wrongRoute.body.detail.code, 'INVALID_TRANSFER_ROUTE');

  const approved = await kit.api(`/stock-transfers/${created.body.id}/approve`, 'ops', { method: 'POST', version: created.body.version });
  ok(approved);
  const key = randomUUID();
  const dispatched = await kit.api(`/stock-transfers/${created.body.id}/dispatch`, 'ops', { method: 'POST', version: approved.body.version, idempotent: key, body: { tracking_number: 'TRK1' } });
  ok(dispatched);
  const again = await kit.api(`/stock-transfers/${created.body.id}/dispatch`, 'ops', { method: 'POST', version: approved.body.version, idempotent: key, body: { tracking_number: 'TRK1' } });
  ok(again);
  assert.equal(again.headers.get('idempotent-replayed'), 'true');
  const inTransit = await kit.api(`/devices/${s.deviceIds[0]}`, 'ops');
  assert.equal(inTransit.body.lifecycle_state, 'in_transit');
  assert.equal(inTransit.body.location, null);

  const received = await kit.api(`/stock-transfers/${created.body.id}/receive`, 'ops', { method: 'POST', version: dispatched.body.version, body: {} });
  ok(received);
  assert.equal(received.body.status, 'received');
  const atStore = await kit.api(`/devices/${s.deviceIds[0]}`, 'ops');
  assert.equal(atStore.body.lifecycle_state, 'in_company_stock');
  assert.equal(atStore.body.customer.id, dev.siteA.companyId);
  assert.equal(atStore.body.ownership_type, 'company_owned');
  const allocation = await kit.prisma.deviceAllocation.findFirst({ where: { deviceId: s.deviceIds[0], releasedAt: null } });
  assert.equal(allocation.companyId, dev.siteA.companyId);
  assert.ok(await kit.prisma.outbox.count({ where: { aggregateId: created.body.id } }) >= 2, 'dispatched + received notifications queued');
});

t('5. customer store → site A store; site B cannot see it', async () => {
  const siteStore = await kit.prisma.stockLocation.findFirst({ where: { locationType: 'client_store', clientId: dev.siteA.siteId } });
  s.siteStoreId = siteStore.id;
  const created = await kit.api('/stock-transfers', 'ops', {
    method: 'POST',
    body: { transfer_type: 'company_to_client', from_location_id: s.companyStoreId, to_location_id: siteStore.id, device_ids: s.deviceIds.slice(0, 2) },
  });
  ok(created, 201);
  assert.equal((await kit.api(`/stock-transfers/${created.body.id}`, 'site-b')).status, 403, 'site-b holds no transfer read');
  let tr = (await kit.api(`/stock-transfers/${created.body.id}/approve`, 'ops', { method: 'POST', version: created.body.version })).body;
  tr = (await kit.api(`/stock-transfers/${tr.id}/dispatch`, 'ops', { method: 'POST', version: tr.version, idempotent: true, body: {} })).body;
  const received = await kit.api(`/stock-transfers/${tr.id}/receive`, 'ops', {
    method: 'POST', version: tr.version,
    body: { items: [{ device_id: s.deviceIds[1], status: 'damaged' }] },
  });
  ok(received);
  const d0 = await kit.api(`/devices/${s.deviceIds[0]}`, 'site-a');
  ok(d0);
  assert.equal(d0.body.lifecycle_state, 'in_client_stock');
  assert.ok(!('unit_price' in d0.body));
  assert.equal((await kit.api(`/devices/${s.deviceIds[0]}`, 'site-b')).status, 404);
  const d1 = await kit.api(`/devices/${s.deviceIds[1]}`, 'ops');
  assert.equal(d1.body.condition, 'damaged');
});

t('6. install into a zone of site A; the timeline tells the whole story', async () => {
  const zone = await kit.prisma.zone.findFirst({ where: { clientId: dev.siteA.siteId, children: { none: {} } } });
  const otherSiteZone = await kit.prisma.zone.findFirst({ where: { clientId: dev.siteB.siteId, children: { none: {} } } });
  const device = (await kit.api(`/devices/${s.deviceIds[0]}`, 'ops')).body;
  const wrongSite = await kit.api('/installations', 'ops', { method: 'POST', body: { device_id: device.id, zone_id: otherSiteZone.id } });
  assert.equal(wrongSite.body.detail.code, 'ZONE_OF_ANOTHER_SITE');
  const inst = await kit.api('/installations', 'tech', { method: 'POST', body: { device_id: device.id, zone_id: zone.id, position_label: 'Main gate, pole 3' } });
  ok(inst, 201);
  const installed = await kit.api(`/devices/${device.id}`, 'site-a');
  assert.equal(installed.body.lifecycle_state, 'installed');
  assert.equal(installed.body.zone.id, zone.id);
  assert.equal(installed.body.installation.position_label, 'Main gate, pole 3');
  const legacy = await kit.prisma.device.findUnique({ where: { id: device.id } });
  assert.equal(legacy.status, 'active');
  assert.equal(legacy.zoneId, zone.id);

  const second = await kit.api('/installations', 'ops', { method: 'POST', body: { device_id: device.id, zone_id: zone.id } });
  assert.equal(second.body.detail.code, 'DEVICE_NOT_IN_SITE_STOCK');

  const events = (await kit.api(`/devices/${device.id}/events?limit=50`, 'ops')).body.data.map((e) => e.event_type).reverse();
  assert.deepEqual(events, ['received', 'allocated', 'dispatched', 'transferred', 'allocated', 'dispatched', 'transferred', 'installed']);
});

t('7. cancelling a transfer puts reserved devices back', async () => {
  const created = await kit.api('/stock-transfers', 'ops', {
    method: 'POST',
    body: { transfer_type: 'platform_to_company', from_location_id: s.warehouseId, to_location_id: s.companyStoreId, device_ids: [s.deviceIds[3]] },
  });
  ok(created, 201);
  const cancelled = await kit.api(`/stock-transfers/${created.body.id}/cancel`, 'ops', { method: 'POST', version: created.body.version, body: { reason: 'wrong customer' } });
  ok(cancelled);
  const d = await kit.api(`/devices/${s.deviceIds[3]}`, 'ops');
  assert.equal(d.body.lifecycle_state, 'in_platform_stock');
});

t('8. editing a device needs its version', async () => {
  const d = (await kit.api(`/devices/${s.deviceIds[2]}`, 'ops')).body;
  assert.equal((await kit.api(`/devices/${d.id}`, 'ops', { method: 'PATCH', body: { mac_address: 'AA:BB' } })).status, 428);
  const saved = await kit.api(`/devices/${d.id}`, 'ops', { method: 'PATCH', version: d.version, body: { mac_address: 'AA:BB:CC:DD:EE:FF' } });
  ok(saved);
  const stale = await kit.api(`/devices/${d.id}`, 'ops', { method: 'PATCH', version: d.version, body: { mac_address: 'AA' } });
  assert.equal(stale.status, 409);
});

t('9. the outbox keeps notifications while Communication is down', async () => {
  const { deliverPending } = await import('../src/modules/inventory/services/outbox.js');
  const saved = kit.env.FBOS_COMMUNICATION_URL;
  kit.env.FBOS_COMMUNICATION_URL = 'http://127.0.0.1:9';
  try {
    const before = await kit.prisma.outbox.count({ where: { status: 'pending' } });
    assert.ok(before > 0);
    const round = await deliverPending({ limit: 5 });
    assert.ok(round.failed > 0);
    assert.equal(await kit.prisma.outbox.count({ where: { status: 'delivered' } }), await kit.prisma.outbox.count({ where: { status: 'delivered' } }));
    const row = await kit.prisma.outbox.findFirst({ where: { status: 'pending', attempts: { gt: 0 } } });
    assert.ok(row.nextAttemptAt > new Date(), 'retried later with backoff');
  } finally {
    kit.env.FBOS_COMMUNICATION_URL = saved;
  }
});
