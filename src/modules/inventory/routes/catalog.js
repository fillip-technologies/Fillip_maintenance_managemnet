import { withTx } from '../db.js';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { requirePermission } from '../auth/middleware.js';
import { handle, validate } from '../http/request.js';
import { pageQuery, pageWindow, pageOf } from '../http/page.js';
import { notFound } from '../http/errors.js';
import * as wire from '../http/serialize.js';
import { P } from '../permissions.js';

/** Device models and vendors (operator master data). */
export const catalogRouter = Router();
const id = z.object({ id: z.string().uuid() });
const org = () => (env.FBOS_ORGANIZATION_ID ? { organizationId: env.FBOS_ORGANIZATION_ID } : {});

catalogRouter.get(
  '/device-models',
  requirePermission(P.CATALOG_READ),
  validate(z.object({ query: z.object({ ...pageQuery, q: z.string().trim().min(1).optional(), active: z.enum(['true', 'false']).optional() }) })),
  handle(async (req, res) => {
    const q = req.input.query;
    const where = {
      AND: [
        org(),
        q.q ? { OR: [{ name: { contains: q.q } }, { manufacturer: { contains: q.q } }, { modelNumber: { contains: q.q } }] } : {},
        q.active ? { isActive: q.active === 'true' } : {},
      ],
    };
    const window = pageWindow(q);
    const rows = await prisma.deviceModel.findMany({
      where,
      include: { category: { select: { name: true } }, _count: { select: { devices: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
    });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map((m) => wire.deviceModel(m, req.actor)) });
  }),
);

catalogRouter.get(
  '/device-models/:id',
  requirePermission(P.CATALOG_READ),
  validate(z.object({ params: id })),
  handle(async (req, res) => {
    const row = await prisma.deviceModel.findFirst({ where: { ...org(), id: req.params.id }, include: { category: { select: { name: true } } } });
    if (!row) throw notFound('device model');
    res.json(wire.deviceModel(row, req.actor));
  }),
);

// The legacy product categories: a model needs one, because device codes come from its series.
catalogRouter.get(
  '/device-categories',
  requirePermission(P.CATALOG_READ),
  handle(async (_req, res) => {
    const rows = await prisma.productCategory.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } });
    res.json({ data: rows });
  }),
);

catalogRouter.get(
  '/vendors',
  requirePermission(P.CATALOG_READ),
  validate(z.object({ query: z.object({ ...pageQuery, q: z.string().trim().min(1).optional(), vendor_type: z.enum(['manufacturer', 'distributor', 'service_center', 'other']).optional() }) })),
  handle(async (req, res) => {
    const q = req.input.query;
    const where = { AND: [org(), q.q ? { name: { contains: q.q } } : {}, q.vendor_type ? { vendorType: q.vendor_type } : {}] };
    const window = pageWindow(q);
    const rows = await prisma.vendor.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: window.skip, take: window.take });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map(wire.vendor) });
  }),
);

catalogRouter.get(
  '/vendors/:id',
  requirePermission(P.CATALOG_READ),
  validate(z.object({ params: id })),
  handle(async (req, res) => {
    const row = await prisma.vendor.findFirst({ where: { ...org(), id: req.params.id } });
    if (!row) throw notFound('vendor');
    res.json(wire.vendor(row));
  }),
);

// ---- writes (inventory.catalog.write) -------------------------------------

const modelBody = z.object({
  name: z.string().trim().min(1).max(160),
  manufacturer: z.string().trim().min(1).max(120),
  model_number: z.string().trim().min(1).max(120),
  category_id: z.string().uuid().nullable().optional(),
  product_type_id: z.string().uuid().nullable().optional(),
  default_warranty_months: z.number().int().min(0).max(240).optional(),
  default_unit_price: z.number().nonnegative().nullable().optional(),
  tax_percent: z.number().min(0).max(100).nullable().optional(),
  hsn_sac: z.string().trim().max(20).nullable().optional(),
  stores_data: z.boolean().optional(),
  spec: z.record(z.any()).nullable().optional(),
  is_active: z.boolean().optional(),
});
const modelData = (b) => ({
  ...(b.name !== undefined ? { name: b.name } : {}),
  ...(b.manufacturer !== undefined ? { manufacturer: b.manufacturer } : {}),
  ...(b.model_number !== undefined ? { modelNumber: b.model_number } : {}),
  ...(b.category_id !== undefined ? { categoryId: b.category_id } : {}),
  ...(b.product_type_id !== undefined ? { productTypeId: b.product_type_id } : {}),
  ...(b.default_warranty_months !== undefined ? { defaultWarrantyMonths: b.default_warranty_months } : {}),
  ...(b.default_unit_price !== undefined ? { defaultUnitPrice: b.default_unit_price } : {}),
  ...(b.tax_percent !== undefined ? { taxPercent: b.tax_percent } : {}),
  ...(b.hsn_sac !== undefined ? { hsnSac: b.hsn_sac } : {}),
  ...(b.stores_data !== undefined ? { storesData: b.stores_data } : {}),
  ...(b.spec !== undefined ? { specJson: b.spec ?? undefined } : {}),
  ...(b.is_active !== undefined ? { isActive: b.is_active } : {}),
});

catalogRouter.post(
  '/device-models',
  requirePermission(P.CATALOG_WRITE),
  validate(z.object({ body: modelBody })),
  handle(async (req, res) => {
    const row = await prisma.deviceModel.create({ data: { organizationId: env.FBOS_ORGANIZATION_ID ?? null, ...modelData(req.input.body) }, include: { category: { select: { name: true } } } });
    res.status(201).json(wire.deviceModel(row, req.actor));
  }),
);

catalogRouter.patch(
  '/device-models/:id',
  requirePermission(P.CATALOG_WRITE),
  validate(z.object({ params: id, body: modelBody.partial() })),
  handle(async (req, res) => {
    const existing = await prisma.deviceModel.findFirst({ where: { ...org(), id: req.params.id } });
    if (!existing) throw notFound('device model');
    const row = await prisma.deviceModel.update({ where: { id: existing.id }, data: modelData(req.input.body), include: { category: { select: { name: true } } } });
    res.json(wire.deviceModel(row, req.actor));
  }),
);

const vendorBody = z.object({
  name: z.string().trim().min(1).max(160),
  vendor_type: z.enum(['manufacturer', 'distributor', 'service_center', 'other']).optional(),
  contact_name: z.string().trim().max(160).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  gst_number: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(2000).nullable().optional(),
  is_active: z.boolean().optional(),
});
const vendorData = (b) => Object.fromEntries(
  Object.entries({
    name: b.name, vendorType: b.vendor_type, contactName: b.contact_name, email: b.email,
    phone: b.phone, gstNumber: b.gst_number, address: b.address, isActive: b.is_active,
  }).filter(([, v]) => v !== undefined),
);

// A vendor also gets a stock location, so units sent to it for RMA have a place.
catalogRouter.post(
  '/vendors',
  requirePermission(P.CATALOG_WRITE),
  validate(z.object({ body: vendorBody })),
  handle(async (req, res) => {
    const row = await withTx(async (tx) => {
      const vendor = await tx.vendor.create({ data: { organizationId: env.FBOS_ORGANIZATION_ID ?? null, ...vendorData(req.input.body) } });
      await tx.stockLocation.create({
        data: {
          organizationId: env.FBOS_ORGANIZATION_ID ?? null,
          code: `VN-${vendor.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
          name: `${vendor.name} (vendor)`,
          locationType: vendor.vendorType === 'service_center' ? 'service_center' : 'vendor',
          vendorId: vendor.id,
        },
      });
      return vendor;
    });
    res.status(201).json(wire.vendor(row));
  }),
);

catalogRouter.patch(
  '/vendors/:id',
  requirePermission(P.CATALOG_WRITE),
  validate(z.object({ params: id, body: vendorBody.partial() })),
  handle(async (req, res) => {
    const existing = await prisma.vendor.findFirst({ where: { ...org(), id: req.params.id } });
    if (!existing) throw notFound('vendor');
    res.json(wire.vendor(await prisma.vendor.update({ where: { id: existing.id }, data: vendorData(req.input.body) })));
  }),
);
