import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { requirePermission } from '../auth/middleware.js';
import { withAccess } from '../auth/access.js';
import { handle, validate, ifMatchVersion } from '../http/request.js';
import { pageQuery, pageWindow, pageOf } from '../http/page.js';
import { InventoryError, notFound } from '../http/errors.js';
import { Prisma } from '@prisma/client';
import * as wire from '../http/serialize.js';
import { P } from '../permissions.js';

export const devicesRouter = Router();

const id = z.object({ id: z.string().uuid() });
const STATES = [
  'in_platform_stock', 'reserved', 'in_transit', 'in_company_stock', 'in_client_stock', 'installed',
  'under_maintenance', 'faulty', 'pending_replacement', 'under_repair', 'at_vendor_rma', 'retired', 'disposed', 'lost',
];

export const deviceInclude = {
  deviceModel: { select: { id: true, name: true, manufacturer: true } },
  category: { select: { name: true, imageUrl: true } },
  productType: { select: { imageUrl: true } },
  company: { select: { id: true, name: true } },
  currentClient: { select: { id: true, name: true } },
  zone: { select: { id: true, name: true } },
  currentLocation: { select: { id: true, name: true, locationType: true } },
  installations: { where: { status: 'active' }, take: 1 },
};

/** A device the caller may see, or 404 (also for other customers' devices). */
export async function deviceInScope(access, deviceId, include = deviceInclude) {
  const device = await prisma.device.findFirst({ where: { AND: [access.deviceWhere(), { id: deviceId, deletedAt: null }] }, include });
  if (!device) throw notFound('device', { device_id: deviceId });
  return device;
}

const listQuery = z.object({
  query: z.object({
    ...pageQuery,
    q: z.string().trim().min(1).max(120).optional(),
    lifecycle_state: z
      .string()
      .transform((s) => s.split(','))
      .pipe(z.array(z.enum(STATES)))
      .optional(),
    health_status: z.enum(['working', 'not_working', 'needs_attention']).optional(),
    model_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
    site_id: z.string().uuid().optional(),
    zone_id: z.string().uuid().optional(),
    location_id: z.string().uuid().optional(),
    warranty: z.enum(['active', 'expired', 'none']).optional(),
    sort: z.enum(['code', '-created_at', 'created_at', 'warranty_end_date']).default('-created_at'),
  }),
});

const SORT = {
  code: { code: 'asc' },
  created_at: { createdAt: 'asc' },
  '-created_at': { createdAt: 'desc' },
  warranty_end_date: { warrantyEndDate: 'asc' },
};

devicesRouter.get(
  '/devices',
  requirePermission(P.DEVICE_READ),
  validate(listQuery),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    const q = req.input.query;
    const today = new Date(new Date().toISOString().slice(0, 10));
    const filters = [
      req.access.deviceWhere(),
      { deletedAt: null },
      q.q ? { OR: [{ code: { contains: q.q } }, { name: { contains: q.q } }, { serialNumber: { contains: q.q } }] } : {},
      q.lifecycle_state ? { lifecycleState: { in: q.lifecycle_state } } : {},
      q.health_status ? { healthStatus: q.health_status } : {},
      q.model_id ? { deviceModelId: q.model_id } : {},
      q.customer_id ? { companyId: q.customer_id } : {},
      q.site_id ? { currentClientId: q.site_id } : {},
      q.zone_id ? { zoneId: q.zone_id } : {},
      q.location_id ? { currentLocationId: q.location_id } : {},
      q.warranty === 'active' ? { warrantyEndDate: { gte: today } } : {},
      q.warranty === 'expired' ? { warrantyEndDate: { lt: today } } : {},
      q.warranty === 'none' ? { warrantyEndDate: null } : {},
    ];
    const where = { AND: filters };
    const window = pageWindow(q);
    const [rows, total] = await Promise.all([
      prisma.device.findMany({ where, include: deviceInclude, orderBy: [SORT[q.sort], { id: 'asc' }], skip: window.skip, take: window.take }),
      prisma.device.count({ where }),
    ]);
    const page = pageOf(rows, window, total);
    res.json({ ...page, data: page.data.map((d) => wire.device(d, req.actor)) });
  }),
);

devicesRouter.get(
  '/devices/:id',
  requirePermission(P.DEVICE_READ),
  validate(z.object({ params: id })),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    const device = await deviceInScope(req.access, req.params.id);
    res.set('ETag', `"${device.version}"`).json(wire.device(device, req.actor));
  }),
);

devicesRouter.get(
  '/devices/:id/events',
  requirePermission(P.DEVICE_READ),
  validate(z.object({ params: id, query: z.object(pageQuery) })),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    await deviceInScope(req.access, req.params.id, {});
    const window = pageWindow(req.input.query);
    const rows = await prisma.deviceLifecycleEvent.findMany({
      where: { deviceId: req.params.id },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: window.skip,
      take: window.take,
    });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map(wire.lifecycleEvent) });
  }),
);

devicesRouter.get(
  '/devices/:id/installations',
  requirePermission(P.DEVICE_READ),
  validate(z.object({ params: id })),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    await deviceInScope(req.access, req.params.id, {});
    const rows = await prisma.deviceInstallation.findMany({
      where: { deviceId: req.params.id },
      include: { zone: { select: { id: true, name: true } } },
      orderBy: { installedAt: 'desc' },
    });
    res.json({ data: rows.map(wire.installation) });
  }),
);

devicesRouter.get(
  '/devices/:id/warranties',
  requirePermission(P.WARRANTY_READ),
  validate(z.object({ params: id })),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    await deviceInScope(req.access, req.params.id, {});
    const rows = await prisma.warranty.findMany({ where: { deviceId: req.params.id }, orderBy: { startDate: 'desc' } });
    res.json({ data: rows.map(wire.warranty) });
  }),
);

devicesRouter.get(
  '/devices/:id/documents',
  requirePermission(P.DEVICE_READ),
  validate(z.object({ params: id })),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    await deviceInScope(req.access, req.params.id, {});
    const rows = await prisma.deviceDocument.findMany({ where: { deviceId: req.params.id }, orderBy: { createdAt: 'desc' } });
    res.json({ data: rows.map(wire.deviceDocument) });
  }),
);

// Link a file already uploaded to FBOS Documents (subject inventory.device/{id}).
devicesRouter.post(
  '/devices/:id/documents',
  requirePermission(P.DEVICE_WRITE),
  validate(
    z.object({
      params: id,
      body: z.object({
        document_id: z.string().uuid(),
        doc_type: z.enum(['invoice', 'warranty_card', 'photo', 'rma_form', 'disposal_certificate', 'other']).default('other'),
        title: z.string().trim().max(200).optional(),
      }),
    }),
  ),
  withAccess(P.DEVICE_WRITE),
  handle(async (req, res) => {
    await deviceInScope(req.access, req.params.id, {});
    const b = req.input.body;
    const doc = await prisma.deviceDocument.create({
      data: { deviceId: req.params.id, documentId: b.document_id, docType: b.doc_type, title: b.title ?? null, uploadedByUserId: req.actor.userId },
    });
    res.status(201).json(wire.deviceDocument(doc));
  }),
);

// Identity details only; where a device is changes through transfers and installations.
devicesRouter.patch(
  '/devices/:id',
  requirePermission(P.DEVICE_WRITE),
  validate(z.object({
    params: id,
    body: z.object({
      name: z.string().trim().min(1).max(120).optional(),
      serial_number: z.string().trim().min(1).max(120).nullable().optional(),
      mac_address: z.string().trim().max(40).nullable().optional(),
      barcode: z.string().trim().max(120).nullable().optional(),
      condition: z.enum(['new', 'good', 'refurbished', 'damaged', 'unknown']).optional(),
      device_model_id: z.string().uuid().optional(),
      spec: z.record(z.any()).nullable().optional(),
    }).refine((b) => Object.keys(b).length > 0, 'Send at least one field'),
  })),
  withAccess(P.DEVICE_WRITE),
  handle(async (req, res) => {
    const device = await deviceInScope(req.access, req.params.id, {});
    const expected = ifMatchVersion(req);
    if (expected === undefined) throw new InventoryError(428, 'IF_MATCH_REQUIRED', 'Send If-Match with the device version you edited');
    const b = req.input.body;
    const data = Object.fromEntries(Object.entries({
      name: b.name, serialNumber: b.serial_number, macAddress: b.mac_address, barcode: b.barcode, condition: b.condition,
      deviceModelId: b.device_model_id, customSpec: b.spec === null ? Prisma.DbNull : b.spec,
    }).filter(([, v]) => v !== undefined));
    // The version check and the write are one statement, so a concurrent edit loses cleanly.
    const { count } = await prisma.device.updateMany({ where: { id: device.id, version: expected }, data: { ...data, version: { increment: 1 } } });
    if (count === 0) {
      throw new InventoryError(409, 'VERSION_MISMATCH', 'Someone else changed this device. Reload and try again.', { meta: { expected_version: expected, current_version: device.version } });
    }
    const updated = await deviceInScope(req.access, device.id);
    res.set('ETag', `"${updated.version}"`).json(wire.device(updated, req.actor));
  }),
);
