import { withTx } from '../db.js';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { requirePermission } from '../auth/middleware.js';
import { withAccess } from '../auth/access.js';
import { handle, validate } from '../http/request.js';
import { pageQuery, pageWindow, pageOf } from '../http/page.js';
import { conflict, notFound, unprocessable } from '../http/errors.js';
import { env } from '../../../config/env.js';
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

// ---- writes (inventory.setup.manage): customers, sites and zones ----------
// A customer and each site get their store when they are created.

const shortId = (uuid) => uuid.replace(/-/g, '').slice(0, 8).toUpperCase();
const orgId = () => env.FBOS_ORGANIZATION_ID ?? null;

const customerBody = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().max(40).nullable().optional(),
  contact_name: z.string().trim().max(160).nullable().optional(),
  contact_email: z.string().trim().email().max(200).nullable().optional(),
  contact_phone: z.string().trim().max(40).nullable().optional(),
  gst_number: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(2000).nullable().optional(),
  fbos_customer_id: z.string().uuid().nullable().optional(),
  org_unit_id: z.string().uuid().nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});
const customerData = (b) => Object.fromEntries(Object.entries({
  name: b.name, companyCode: b.code, contactName: b.contact_name, contactEmail: b.contact_email, contactPhone: b.contact_phone,
  gstNumber: b.gst_number, address: b.address, fbosCustomerId: b.fbos_customer_id, fbosOrgUnitId: b.org_unit_id, status: b.status,
}).filter(([, v]) => v !== undefined));

organizationRouter.post(
  '/customers',
  requirePermission(P.SETUP_MANAGE),
  validate(z.object({ body: customerBody })),
  handle(async (req, res) => {
    const row = await withTx(async (tx) => {
      const c = await tx.company.create({ data: { organizationId: orgId(), ...customerData(req.input.body) } });
      await tx.stockLocation.create({ data: { organizationId: orgId(), code: `CS-${shortId(c.id)}`, name: `${c.name} store`, locationType: 'company_store', companyId: c.id } });
      return c;
    });
    res.status(201).json(wire.customer(row));
  }),
);

organizationRouter.patch(
  '/customers/:id',
  requirePermission(P.SETUP_MANAGE),
  validate(z.object({ params: id, body: customerBody.partial() })),
  withAccess(P.SETUP_MANAGE),
  handle(async (req, res) => {
    const existing = await prisma.company.findFirst({ where: { AND: [req.access.customerWhere(), { id: req.params.id }] } });
    if (!existing) throw notFound('customer');
    res.json(wire.customer(await prisma.company.update({ where: { id: existing.id }, data: customerData(req.input.body) })));
  }),
);

const siteBody = z.object({
  customer_id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().max(40).nullable().optional(),
  type: z.string().trim().max(60).nullable().optional(),
  facility_name: z.string().trim().max(200).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  contact_person: z.string().trim().max(160).nullable().optional(),
  contact_phone: z.string().trim().max(40).nullable().optional(),
  org_unit_id: z.string().uuid().nullable().optional(),
});
const siteData = (b) => Object.fromEntries(Object.entries({
  companyId: b.customer_id, name: b.name, clientCode: b.code, type: b.type, facilityName: b.facility_name, location: b.location,
  contactPerson: b.contact_person, contactPhone: b.contact_phone, fbosOrgUnitId: b.org_unit_id,
}).filter(([, v]) => v !== undefined));

organizationRouter.post(
  '/sites',
  requirePermission(P.SETUP_MANAGE),
  validate(z.object({ body: siteBody })),
  withAccess(P.SETUP_MANAGE),
  handle(async (req, res) => {
    const customer = await prisma.company.findFirst({ where: { AND: [req.access.customerWhere(), { id: req.input.body.customer_id }] } });
    if (!customer) throw notFound('customer');
    const row = await withTx(async (tx) => {
      const s = await tx.client.create({ data: { organizationId: orgId(), ...siteData(req.input.body) }, include: { company: { select: { name: true } } } });
      await tx.stockLocation.create({ data: { organizationId: orgId(), code: `SS-${shortId(s.id)}`, name: `${s.name} site store`, locationType: 'client_store', companyId: s.companyId, clientId: s.id } });
      return s;
    });
    res.status(201).json(wire.site(row));
  }),
);

organizationRouter.patch(
  '/sites/:id',
  requirePermission(P.SETUP_MANAGE),
  validate(z.object({ params: id, body: siteBody.omit({ customer_id: true }).partial() })),
  withAccess(P.SETUP_MANAGE),
  handle(async (req, res) => {
    const existing = await prisma.client.findFirst({ where: { AND: [req.access.siteWhere(), { id: req.params.id }] } });
    if (!existing) throw notFound('site');
    res.json(wire.site(await prisma.client.update({ where: { id: existing.id }, data: siteData(req.input.body), include: { company: { select: { name: true } } } })));
  }),
);

async function zoneInScope(access, zoneId) {
  const zone = await prisma.zone.findUnique({ where: { id: zoneId }, include: { client: { select: { companyId: true } } } });
  if (!zone || !access.coversHolder({ companyId: zone.client.companyId, clientId: zone.clientId })) throw notFound('zone');
  return zone;
}

organizationRouter.post(
  '/zones',
  requirePermission(P.SETUP_MANAGE),
  validate(z.object({ body: z.object({ site_id: z.string().uuid(), parent_id: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(120), status: z.enum(['draft', 'active', 'inactive']).default('active') }) })),
  withAccess(P.SETUP_MANAGE),
  handle(async (req, res) => {
    const b = req.input.body;
    const site = await prisma.client.findFirst({ where: { AND: [req.access.siteWhere(), { id: b.site_id }] } });
    if (!site) throw notFound('site');
    if (b.parent_id) {
      const parent = await zoneInScope(req.access, b.parent_id);
      if (parent.clientId !== site.id) throw unprocessable('PARENT_ZONE_OF_ANOTHER_SITE', 'The parent zone is at another site');
      if (await prisma.device.count({ where: { zoneId: parent.id } })) {
        throw conflict('ZONE_HAS_DEVICES', 'Devices sit in the parent zone; sub-zones go under zones without devices');
      }
    }
    const zone = await prisma.zone.create({ data: { clientId: site.id, parentZoneId: b.parent_id ?? null, name: b.name, status: b.status } });
    res.status(201).json(wire.zone(zone));
  }),
);

organizationRouter.patch(
  '/zones/:id',
  requirePermission(P.SETUP_MANAGE),
  validate(z.object({ params: id, body: z.object({ name: z.string().trim().min(1).max(120).optional(), status: z.enum(['draft', 'active', 'inactive']).optional() }) })),
  withAccess(P.SETUP_MANAGE),
  handle(async (req, res) => {
    const zone = await zoneInScope(req.access, req.params.id);
    res.json(wire.zone(await prisma.zone.update({ where: { id: zone.id }, data: req.input.body })));
  }),
);

// Same guard as the legacy app: a zone with devices or past installations stays.
organizationRouter.delete(
  '/zones/:id',
  requirePermission(P.SETUP_MANAGE),
  validate(z.object({ params: id })),
  withAccess(P.SETUP_MANAGE),
  handle(async (req, res) => {
    const zone = await zoneInScope(req.access, req.params.id);
    const [children, devices, installs] = await Promise.all([
      prisma.zone.count({ where: { parentZoneId: zone.id } }),
      prisma.device.count({ where: { zoneId: zone.id } }),
      prisma.deviceInstallation.count({ where: { zoneId: zone.id } }),
    ]);
    if (children) throw conflict('ZONE_HAS_CHILDREN', 'Delete its sub-zones first');
    if (devices) throw conflict('ZONE_HAS_DEVICES', `This zone has ${devices} device(s). Move them first.`, { device_count: devices });
    if (installs) throw conflict('ZONE_HAS_HISTORY', 'Devices have been installed here before. Set the zone inactive instead.');
    await prisma.zone.delete({ where: { id: zone.id } });
    res.status(204).end();
  }),
);
