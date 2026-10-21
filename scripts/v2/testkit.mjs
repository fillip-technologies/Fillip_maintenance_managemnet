// Shared setup for the inventory API tests: the app in-process on a free port,
// the local docker Identity, and the users from fbos_dev_bootstrap.mjs.
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

process.env.INVENTORY_API_ENABLED = 'true';
const file = new URL('./.fbos-dev.json', import.meta.url);
export const dev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
const identityUp = dev && (await fetch(`${process.env.FBOS_IDENTITY_URL ?? 'http://localhost:8001'}/health`).then((r) => r.ok).catch(() => false));
const url = process.env.DATABASE_URL ?? '';
export const ready = Boolean(identityUp && /@(localhost|127\.0\.0\.1)[:/]/.test(url) && /\/test_/.test(url));

export async function startKit(people = ['ops', 'site-a', 'site-b', 'tech']) {
  const { prisma } = await import('../../src/lib/prisma.js');
  const { env } = await import('../../src/config/env.js');
  const { createApp } = await import('../../src/app.js');
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/inventory/v1`;
  const tokens = {};
  for (const who of people) {
    const res = await fetch(`${dev.identityUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${who}@fixlydev.example.com`, password: dev.password }),
    });
    tokens[who] = (await res.json()).access_token;
  }
  async function api(path, who, { method = 'GET', body, headers = {}, version, idempotent } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(who ? { authorization: `Bearer ${tokens[who]}`, 'x-organization-id': dev.organizationId } : {}),
        ...(version !== undefined ? { 'if-match': `"${version}"` } : {}),
        ...(idempotent ? { 'idempotency-key': idempotent === true ? randomUUID() : idempotent } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null), headers: res.headers };
  }
  return {
    prisma, env, base, tokens, api,
    stop: async () => {
      server.close();
      await prisma.$disconnect();
    },
  };
}

/**
 * Buys `count` new devices (vendor, model that stores data, PO, GRN) and moves
 * them warehouse → customer store of site A → site A store. Returns
 * { vendorId, modelId, deviceIds, siteStoreId, companyStoreId, warehouseId }.
 */
export async function provisionAtSiteA(kit, count, { toSite = count } = {}) {
  const { api, prisma } = kit;
  const must = (r, status = 200) => {
    if (r.status !== status) throw new Error(`${status} expected, got ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const stamp = Date.now();
  const vendor = must(await api('/vendors', 'ops', { method: 'POST', body: { name: `Vendor ${stamp}`, vendor_type: 'manufacturer' } }), 201);
  const cam = await prisma.productCategory.findFirst({ where: { code: 'CAM' } });
  const model = must(await api('/device-models', 'ops', { method: 'POST', body: { name: 'Bullet 2MP', manufacturer: 'CP Plus', model_number: `CP-${stamp}`, category_id: cam.id, default_warranty_months: 12, stores_data: true } }), 201);
  let po = must(await api('/purchase-orders', 'ops', { method: 'POST', body: { vendor_id: vendor.id, items: [{ device_model_id: model.id, quantity_ordered: count, unit_price: 2500, tax_percent: 18 }] } }), 201);
  po = must(await api(`/purchase-orders/${po.id}/submit`, 'ops', { method: 'POST', version: po.version }));
  po = must(await api(`/purchase-orders/${po.id}/approve`, 'ops', { method: 'POST', version: po.version }));
  const warehouse = await prisma.stockLocation.findFirst({ where: { locationType: 'platform_warehouse' } });
  const grn = must(await api('/goods-receipts', 'ops', {
    method: 'POST', idempotent: true,
    body: { purchase_order_id: po.id, receiving_location_id: warehouse.id, items: [{ purchase_order_item_id: po.items[0].id, quantity_received: count, quantity_accepted: count, units: Array.from({ length: count }, (_, i) => ({ serial_number: `P${stamp}${i}` })) }] },
  }), 201);
  const deviceIds = grn.devices.map((d) => d.id);
  const companyStore = await prisma.stockLocation.findFirst({ where: { locationType: 'company_store', companyId: dev.siteA.companyId } });
  const siteStore = await prisma.stockLocation.findFirst({ where: { locationType: 'client_store', clientId: dev.siteA.siteId } });
  async function move(type, from, to, ids) {
    let t = must(await api('/stock-transfers', 'ops', { method: 'POST', body: { transfer_type: type, from_location_id: from, to_location_id: to, device_ids: ids } }), 201);
    t = must(await api(`/stock-transfers/${t.id}/approve`, 'ops', { method: 'POST', version: t.version }));
    t = must(await api(`/stock-transfers/${t.id}/dispatch`, 'ops', { method: 'POST', version: t.version, idempotent: true, body: {} }));
    return must(await api(`/stock-transfers/${t.id}/receive`, 'ops', { method: 'POST', version: t.version, body: {} }));
  }
  await move('platform_to_company', warehouse.id, companyStore.id, deviceIds);
  if (toSite > 0) await move('company_to_client', companyStore.id, siteStore.id, deviceIds.slice(0, toSite));
  return { vendorId: vendor.id, modelId: model.id, deviceIds, siteStoreId: siteStore.id, companyStoreId: companyStore.id, warehouseId: warehouse.id };
}
