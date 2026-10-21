import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { requirePermission } from '../auth/middleware.js';
import { requireIdempotencyKey } from '../http/idempotency.js';
import { handle, validate, ifMatchVersion } from '../http/request.js';
import { pageQuery, pageWindow, pageOf } from '../http/page.js';
import { notFound } from '../http/errors.js';
import * as wire from '../http/serialize.js';
import { P } from '../permissions.js';
import { createPurchaseOrder, updatePurchaseOrder, movePurchaseOrder, receiveGoods, poInclude, grnInclude } from '../services/procurement.js';

/** Purchase orders to vendors and goods receipts against them (operator only). */
export const procurementRouter = Router();
const id = z.object({ id: z.string().uuid() });
const org = () => (env.FBOS_ORGANIZATION_ID ? { organizationId: env.FBOS_ORGANIZATION_ID } : {});
const PO_STATUSES = ['draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled'];

const line = z.object({
  device_model_id: z.string().uuid(),
  quantity_ordered: z.number().int().min(1).max(10_000),
  unit_price: z.number().nonnegative().max(1e9),
  tax_percent: z.number().min(0).max(100).optional(),
});
const poBody = z.object({
  vendor_id: z.string().uuid(),
  order_date: z.string().date().optional(),
  expected_date: z.string().date().nullable().optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  notes: z.string().max(4000).nullable().optional(),
  items: z.array(line).min(1).max(200),
});

procurementRouter.get(
  '/purchase-orders',
  requirePermission(P.PURCHASE_ORDER_READ),
  validate(z.object({ query: z.object({ ...pageQuery, status: z.enum(PO_STATUSES).optional(), vendor_id: z.string().uuid().optional(), q: z.string().trim().min(1).optional() }) })),
  handle(async (req, res) => {
    const q = req.input.query;
    const where = { AND: [org(), q.status ? { status: q.status } : {}, q.vendor_id ? { vendorId: q.vendor_id } : {}, q.q ? { poNumber: { contains: q.q } } : {}] };
    const window = pageWindow(q);
    const rows = await prisma.purchaseOrder.findMany({ where, include: poInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: window.skip, take: window.take });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map((po) => wire.purchaseOrder(po, req.actor)) });
  }),
);

procurementRouter.get(
  '/purchase-orders/:id',
  requirePermission(P.PURCHASE_ORDER_READ),
  validate(z.object({ params: id })),
  handle(async (req, res) => {
    const po = await prisma.purchaseOrder.findFirst({ where: { ...org(), id: req.params.id }, include: poInclude });
    if (!po) throw notFound('purchase order');
    res.set('ETag', `"${po.version}"`).json(wire.purchaseOrder(po, req.actor));
  }),
);

procurementRouter.post(
  '/purchase-orders',
  requirePermission(P.PURCHASE_ORDER_WRITE),
  validate(z.object({ body: poBody })),
  handle(async (req, res) => {
    const po = await createPurchaseOrder(req.actor, req.input.body);
    res.status(201).location(`${req.baseUrl}/purchase-orders/${po.id}`).json(wire.purchaseOrder(po, req.actor));
  }),
);

procurementRouter.patch(
  '/purchase-orders/:id',
  requirePermission(P.PURCHASE_ORDER_WRITE),
  validate(z.object({ params: id, body: poBody.partial() })),
  handle(async (req, res) => {
    const po = await updatePurchaseOrder(req.actor, req.params.id, ifMatchVersion(req), req.input.body);
    res.json(wire.purchaseOrder(po, req.actor));
  }),
);

for (const [move, code] of [['submit', P.PURCHASE_ORDER_WRITE], ['approve', P.PURCHASE_ORDER_APPROVE], ['cancel', P.PURCHASE_ORDER_WRITE]]) {
  procurementRouter.post(
    `/purchase-orders/:id/${move}`,
    requirePermission(code),
    validate(z.object({ params: id })),
    handle(async (req, res) => {
      const po = await movePurchaseOrder(req.actor, req.params.id, ifMatchVersion(req), move);
      res.json(wire.purchaseOrder(po, req.actor));
    }),
  );
}

procurementRouter.get(
  '/goods-receipts',
  requirePermission(P.PURCHASE_ORDER_READ),
  validate(z.object({ query: z.object({ ...pageQuery, purchase_order_id: z.string().uuid().optional() }) })),
  handle(async (req, res) => {
    const q = req.input.query;
    const where = { AND: [org(), q.purchase_order_id ? { purchaseOrderId: q.purchase_order_id } : {}] };
    const window = pageWindow(q);
    const rows = await prisma.goodsReceipt.findMany({ where, include: grnInclude, orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }], skip: window.skip, take: window.take });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map(wire.goodsReceipt) });
  }),
);

procurementRouter.get(
  '/goods-receipts/:id',
  requirePermission(P.PURCHASE_ORDER_READ),
  validate(z.object({ params: id })),
  handle(async (req, res) => {
    const grn = await prisma.goodsReceipt.findFirst({ where: { ...org(), id: req.params.id }, include: grnInclude });
    if (!grn) throw notFound('goods receipt');
    res.json(wire.goodsReceipt(grn));
  }),
);

const unit = z.object({
  serial_number: z.string().trim().min(1).max(120),
  mac_address: z.string().trim().max(40).optional(),
  barcode: z.string().trim().max(120).optional(),
});
procurementRouter.post(
  '/goods-receipts',
  requirePermission(P.GOODS_RECEIPT_WRITE),
  requireIdempotencyKey,
  validate(
    z.object({
      body: z.object({
        purchase_order_id: z.string().uuid(),
        receiving_location_id: z.string().uuid(),
        vendor_invoice_no: z.string().trim().max(60).optional(),
        delivery_challan_no: z.string().trim().max(60).optional(),
        notes: z.string().max(4000).optional(),
        items: z
          .array(
            z.object({
              purchase_order_item_id: z.string().uuid(),
              quantity_received: z.number().int().min(0),
              quantity_accepted: z.number().int().min(0),
              quantity_rejected: z.number().int().min(0).default(0),
              rejection_reason: z.string().max(255).optional(),
              units: z.array(unit).max(1000).default([]),
            }),
          )
          .min(1),
      }),
    }),
  ),
  handle(async (req, res) => {
    const { grn } = await receiveGoods(req.actor, req.input.body);
    res.status(201).location(`${req.baseUrl}/goods-receipts/${grn.id}`).json(wire.goodsReceipt(grn));
  }),
);
