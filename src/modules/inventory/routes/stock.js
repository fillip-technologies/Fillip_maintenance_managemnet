import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { requirePermission } from '../auth/middleware.js';
import { withAccess } from '../auth/access.js';
import { handle, validate } from '../http/request.js';
import { pageQuery, pageWindow, pageOf } from '../http/page.js';
import { notFound } from '../http/errors.js';
import * as wire from '../http/serialize.js';
import { P } from '../permissions.js';

/** Stock locations and what sits in them. */
export const stockRouter = Router();
const LOCATION_TYPES = ['platform_warehouse', 'company_store', 'client_store', 'in_transit', 'vendor', 'service_center', 'disposal'];
const STOCKED = ['in_platform_stock', 'reserved', 'in_company_stock', 'in_client_stock', 'under_repair', 'at_vendor_rma', 'retired'];

export async function locationInScope(access, locationId) {
  const row = await prisma.stockLocation.findFirst({ where: { AND: [access.locationWhere(), { id: locationId }] } });
  if (!row) throw notFound('stock location', { location_id: locationId });
  return row;
}

stockRouter.get(
  '/stock-locations',
  requirePermission(P.DEVICE_READ),
  validate(
    z.object({
      query: z.object({
        ...pageQuery,
        location_type: z.enum(LOCATION_TYPES).optional(),
        customer_id: z.string().uuid().optional(),
        site_id: z.string().uuid().optional(),
      }),
    }),
  ),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    const q = req.input.query;
    const where = {
      AND: [
        req.access.locationWhere(),
        q.location_type ? { locationType: q.location_type } : {},
        q.customer_id ? { companyId: q.customer_id } : {},
        q.site_id ? { clientId: q.site_id } : {},
      ],
    };
    const window = pageWindow(q);
    const rows = await prisma.stockLocation.findMany({
      where,
      include: { _count: { select: { devices: true } } },
      orderBy: [{ locationType: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      skip: window.skip,
      take: window.take,
    });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map(wire.stockLocation) });
  }),
);

// Stock on hand at one location, per model (design doc §10 "stock on hand").
stockRouter.get(
  '/stock-locations/:id/stock',
  requirePermission(P.DEVICE_READ),
  validate(z.object({ params: z.object({ id: z.string().uuid() }) })),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    const location = await locationInScope(req.access, req.params.id);
    const groups = await prisma.device.groupBy({
      by: ['deviceModelId', 'lifecycleState'],
      where: { currentLocationId: location.id, deletedAt: null, lifecycleState: { in: STOCKED } },
      _count: { _all: true },
    });
    const models = await prisma.deviceModel.findMany({
      where: { id: { in: [...new Set(groups.map((g) => g.deviceModelId).filter(Boolean))] } },
      select: { id: true, name: true, manufacturer: true },
    });
    const name = new Map(models.map((m) => [m.id, m]));
    res.json({
      location: wire.stockLocation(location),
      data: groups.map((g) => ({
        model: g.deviceModelId ? { id: g.deviceModelId, name: name.get(g.deviceModelId)?.name ?? null } : null,
        lifecycle_state: g.lifecycleState,
        quantity: g._count._all,
      })),
    });
  }),
);

// Places away from the store tiers: an outside service centre, a scrap yard, a second warehouse.
stockRouter.post(
  '/stock-locations',
  requirePermission(P.SETUP_MANAGE),
  validate(z.object({
    body: z.object({
      code: z.string().trim().min(1).max(40),
      name: z.string().trim().min(1).max(160),
      location_type: z.enum(['platform_warehouse', 'service_center', 'disposal', 'vendor']),
      vendor_id: z.string().uuid().optional(),
      address: z.string().trim().max(2000).optional(),
    }),
  })),
  withAccess(P.SETUP_MANAGE),
  handle(async (req, res) => {
    if (!req.access.all) throw notFound('stock location');
    const b = req.input.body;
    const row = await prisma.stockLocation.create({
      data: { organizationId: env.FBOS_ORGANIZATION_ID ?? null, code: b.code, name: b.name, locationType: b.location_type, vendorId: b.vendor_id ?? null, address: b.address ?? null },
    });
    res.status(201).json(wire.stockLocation(row));
  }),
);

stockRouter.patch(
  '/stock-locations/:id',
  requirePermission(P.SETUP_MANAGE),
  validate(z.object({ params: z.object({ id: z.string().uuid() }), body: z.object({ name: z.string().trim().min(1).max(160).optional(), address: z.string().trim().max(2000).nullable().optional(), is_active: z.boolean().optional() }) })),
  withAccess(P.SETUP_MANAGE),
  handle(async (req, res) => {
    const location = await locationInScope(req.access, req.params.id);
    const b = req.input.body;
    res.json(wire.stockLocation(await prisma.stockLocation.update({
      where: { id: location.id },
      data: { ...(b.name ? { name: b.name } : {}), ...(b.address !== undefined ? { address: b.address } : {}), ...(b.is_active !== undefined ? { isActive: b.is_active } : {}) },
    })));
  }),
);
