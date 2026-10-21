import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { requirePermission } from '../auth/middleware.js';
import { withAccess } from '../auth/access.js';
import { requireIdempotencyKey } from '../http/idempotency.js';
import { handle, validate, ifMatchVersion } from '../http/request.js';
import { pageQuery, pageWindow, pageOf } from '../http/page.js';
import * as wire from '../http/serialize.js';
import { P } from '../permissions.js';
import {
  approveTransfer, cancelTransfer, createTransfer, dispatchTransfer, receiveTransfer,
  transferInScope, transferInclude, transferWhere,
} from '../services/transfers.js';

/** Stock transfers between stores (and to / from repair and vendors). */
export const transfersRouter = Router();
const id = z.object({ id: z.string().uuid() });
const TYPES = ['platform_to_company', 'company_to_client', 'client_to_client', 'return_to_company', 'return_to_platform', 'replacement_dispatch', 'to_repair', 'from_repair', 'to_vendor_rma', 'from_vendor_rma'];
const STATUSES = ['draft', 'approved', 'dispatched', 'received', 'partially_received', 'rejected', 'cancelled'];
const CONDITIONS = ['new', 'good', 'refurbished', 'damaged', 'unknown'];

transfersRouter.get(
  '/stock-transfers',
  requirePermission(P.TRANSFER_READ),
  validate(z.object({
    query: z.object({
      ...pageQuery,
      status: z.string().transform((s) => s.split(',')).pipe(z.array(z.enum(STATUSES))).optional(),
      transfer_type: z.enum(TYPES).optional(),
      location_id: z.string().uuid().optional(),
      q: z.string().trim().min(1).optional(),
    }),
  })),
  withAccess(P.TRANSFER_READ),
  handle(async (req, res) => {
    const q = req.input.query;
    const where = {
      AND: [
        transferWhere(req.access),
        q.status ? { status: { in: q.status } } : {},
        q.transfer_type ? { transferType: q.transfer_type } : {},
        q.location_id ? { OR: [{ fromLocationId: q.location_id }, { toLocationId: q.location_id }] } : {},
        q.q ? { transferNumber: { contains: q.q } } : {},
      ],
    };
    const window = pageWindow(q);
    const rows = await prisma.stockTransfer.findMany({
      where,
      include: { fromLocation: transferInclude.fromLocation, toLocation: transferInclude.toLocation, _count: { select: { items: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
    });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map(wire.stockTransfer) });
  }),
);

transfersRouter.get(
  '/stock-transfers/:id',
  requirePermission(P.TRANSFER_READ),
  validate(z.object({ params: id })),
  withAccess(P.TRANSFER_READ),
  handle(async (req, res) => {
    const t = await transferInScope(prisma, req.access, req.params.id);
    res.set('ETag', `"${t.version}"`).json(wire.stockTransfer(t));
  }),
);

transfersRouter.post(
  '/stock-transfers',
  requirePermission(P.TRANSFER_WRITE),
  validate(z.object({
    body: z.object({
      transfer_type: z.enum(TYPES),
      from_location_id: z.string().uuid(),
      to_location_id: z.string().uuid(),
      device_ids: z.array(z.string().uuid()).min(1).max(500),
      notes: z.string().max(4000).optional(),
    }),
  })),
  withAccess(P.TRANSFER_WRITE),
  handle(async (req, res) => {
    const t = await createTransfer(req.access, req.actor, req.input.body);
    res.status(201).location(`${req.baseUrl}/stock-transfers/${t.id}`).json(wire.stockTransfer(t));
  }),
);

transfersRouter.post(
  '/stock-transfers/:id/approve',
  requirePermission(P.TRANSFER_APPROVE),
  validate(z.object({ params: id })),
  withAccess(P.TRANSFER_APPROVE),
  handle(async (req, res) => res.json(wire.stockTransfer(await approveTransfer(req.access, req.actor, req.params.id, ifMatchVersion(req))))),
);

transfersRouter.post(
  '/stock-transfers/:id/dispatch',
  requirePermission(P.TRANSFER_DISPATCH),
  requireIdempotencyKey,
  validate(z.object({
    params: id,
    body: z.object({
      challan_no: z.string().trim().max(60).optional(),
      carrier: z.string().trim().max(120).optional(),
      tracking_number: z.string().trim().max(120).optional(),
      condition_out: z.enum(CONDITIONS).optional(),
    }).default({}),
  })),
  withAccess(P.TRANSFER_DISPATCH),
  handle(async (req, res) => res.json(wire.stockTransfer(await dispatchTransfer(req.access, req.actor, req.params.id, ifMatchVersion(req), req.input.body)))),
);

transfersRouter.post(
  '/stock-transfers/:id/receive',
  requirePermission(P.TRANSFER_RECEIVE),
  validate(z.object({
    params: id,
    body: z.object({
      items: z.array(z.object({
        device_id: z.string().uuid(),
        status: z.enum(['received', 'damaged', 'missing']).default('received'),
        condition_in: z.enum(CONDITIONS).optional(),
        notes: z.string().max(1000).optional(),
      })).max(500).optional(),
    }).default({}),
  })),
  withAccess(P.TRANSFER_RECEIVE),
  handle(async (req, res) => res.json(wire.stockTransfer(await receiveTransfer(req.access, req.actor, req.params.id, ifMatchVersion(req), req.input.body)))),
);

transfersRouter.post(
  '/stock-transfers/:id/cancel',
  requirePermission(P.TRANSFER_WRITE),
  validate(z.object({ params: id, body: z.object({ reason: z.string().max(1000).optional() }).default({}) })),
  withAccess(P.TRANSFER_WRITE),
  handle(async (req, res) => res.json(wire.stockTransfer(await cancelTransfer(req.access, req.actor, req.params.id, ifMatchVersion(req), req.input.body.reason)))),
);
