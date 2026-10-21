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
