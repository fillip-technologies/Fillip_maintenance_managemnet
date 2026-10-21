import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { requirePermission } from '../auth/middleware.js';
import { withAccess } from '../auth/access.js';
import { handle, validate } from '../http/request.js';
import { pageQuery, pageWindow, pageOf } from '../http/page.js';
import { notFound } from '../http/errors.js';
import * as wire from '../http/serialize.js';
import { P } from '../permissions.js';

/** Customers (Fixly companies), sites (Fixly clients) and zones, read side. */
export const organizationRouter = Router();
const id = z.object({ id: z.string().uuid() });

organizationRouter.get(
  '/customers',
  requirePermission(P.DEVICE_READ),
  validate(z.object({ query: z.object({ ...pageQuery, q: z.string().trim().min(1).optional() }) })),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    const q = req.input.query;
    const where = { AND: [req.access.customerWhere(), q.q ? { name: { contains: q.q } } : {}] };
    const window = pageWindow(q);
    const rows = await prisma.company.findMany({
      where,
      include: { _count: { select: { clients: true, devices: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
    });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map(wire.customer) });
  }),
);

organizationRouter.get(
  '/customers/:id',
  requirePermission(P.DEVICE_READ),
  validate(z.object({ params: id })),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    const row = await prisma.company.findFirst({
      where: { AND: [req.access.customerWhere(), { id: req.params.id }] },
      include: { _count: { select: { clients: true, devices: true } } },
    });
    if (!row) throw notFound('customer');
    res.json(wire.customer(row));
  }),
);

organizationRouter.get(
  '/sites',
  requirePermission(P.DEVICE_READ),
  validate(z.object({ query: z.object({ ...pageQuery, customer_id: z.string().uuid().optional() }) })),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    const q = req.input.query;
    const where = { AND: [req.access.siteWhere(), q.customer_id ? { companyId: q.customer_id } : {}] };
    const window = pageWindow(q);
    const rows = await prisma.client.findMany({
      where,
      include: { company: { select: { name: true } }, _count: { select: { zones: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
    });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map(wire.site) });
  }),
);

organizationRouter.get(
  '/sites/:id',
  requirePermission(P.DEVICE_READ),
  validate(z.object({ params: id })),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    const row = await prisma.client.findFirst({
      where: { AND: [req.access.siteWhere(), { id: req.params.id }] },
      include: { company: { select: { name: true } }, _count: { select: { zones: true } } },
    });
    if (!row) throw notFound('site');
    res.json(wire.site(row));
  }),
);

organizationRouter.get(
  '/zones',
  requirePermission(P.DEVICE_READ),
  validate(
    z.object({
      query: z.object({
        ...pageQuery,
        site_id: z.string().uuid().optional(),
        parent_id: z.union([z.string().uuid(), z.literal('root')]).optional(),
        q: z.string().trim().min(1).optional(),
      }),
    }),
  ),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    const q = req.input.query;
    const where = {
      AND: [
        req.access.all ? {} : { clientId: { in: (await prisma.client.findMany({ where: req.access.siteWhere(), select: { id: true } })).map((s) => s.id) } },
        q.site_id ? { clientId: q.site_id } : {},
        q.parent_id === 'root' ? { parentZoneId: null } : q.parent_id ? { parentZoneId: q.parent_id } : {},
        q.q ? { name: { contains: q.q } } : {},
      ],
    };
    const window = pageWindow(q);
    const rows = await prisma.zone.findMany({
      where,
      include: { _count: { select: { children: true, devices: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
    });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map(wire.zone) });
  }),
);
