import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { requirePermission } from '../auth/middleware.js';
import { handle, validate } from '../http/request.js';
import { iso, day } from '../http/serialize.js';
import { P } from '../permissions.js';

/** The design doc §10 queries as reports (operator, inventory.report.read). */
export const reportsRouter = Router();
const org = () => (env.FBOS_ORGANIZATION_ID ? { organizationId: env.FBOS_ORGANIZATION_ID } : {});
const STOCKED = ['in_platform_stock', 'reserved', 'in_company_stock', 'in_client_stock'];

reportsRouter.get(
  '/reports/stock-on-hand',
  requirePermission(P.REPORT_READ),
  handle(async (_req, res) => {
    const groups = await prisma.device.groupBy({
      by: ['currentLocationId', 'deviceModelId'],
      where: { ...org(), deletedAt: null, lifecycleState: { in: STOCKED } },
      _count: { _all: true },
    });
    const [locations, models] = await Promise.all([
      prisma.stockLocation.findMany({ where: { id: { in: groups.map((g) => g.currentLocationId).filter(Boolean) } }, select: { id: true, name: true, locationType: true } }),
      prisma.deviceModel.findMany({ where: { id: { in: groups.map((g) => g.deviceModelId).filter(Boolean) } }, select: { id: true, name: true } }),
    ]);
    const L = new Map(locations.map((l) => [l.id, l]));
    const M = new Map(models.map((m) => [m.id, m]));
    res.json({
      data: groups
        .map((g) => ({
          location: { id: g.currentLocationId, name: L.get(g.currentLocationId)?.name ?? null, location_type: L.get(g.currentLocationId)?.locationType ?? null },
          model: { id: g.deviceModelId, name: M.get(g.deviceModelId)?.name ?? null },
          quantity: g._count._all,
        }))
        .sort((a, b) => (a.location.name ?? '').localeCompare(b.location.name ?? '')),
    });
  }),
);

reportsRouter.get(
  '/reports/by-state',
  requirePermission(P.REPORT_READ),
  handle(async (_req, res) => {
    const groups = await prisma.device.groupBy({ by: ['lifecycleState'], where: { ...org(), deletedAt: null }, _count: { _all: true } });
    res.json({ data: groups.map((g) => ({ lifecycle_state: g.lifecycleState, quantity: g._count._all })) });
  }),
);

reportsRouter.get(
  '/reports/warranty-expiry',
  requirePermission(P.REPORT_READ),
  validate(z.object({ query: z.object({ days: z.coerce.number().int().min(1).max(365).default(60) }) })),
  handle(async (req, res) => {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const until = new Date(today.getTime() + req.input.query.days * 86_400_000);
    const rows = await prisma.warranty.findMany({
      where: { ...org(), status: 'active', endDate: { gte: today, lte: until }, device: { lifecycleState: { notIn: ['disposed', 'lost', 'retired'] } } },
      include: { device: { select: { id: true, code: true, name: true } }, vendor: { select: { name: true } } },
      orderBy: { endDate: 'asc' },
    });
    res.json({ data: rows.map((w) => ({ device: w.device, end_date: day(w.endDate), warranty_type: w.warrantyType, vendor_name: w.vendor?.name ?? null })) });
  }),
);

reportsRouter.get(
  '/reports/open-repairs',
  requirePermission(P.REPORT_READ),
  handle(async (_req, res) => {
    const rows = await prisma.repairOrder.findMany({
      where: { ...org(), status: { notIn: ['closed', 'cancelled'] } },
      include: { device: { select: { id: true, code: true, name: true } }, vendor: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ data: rows.map((r) => ({ id: r.id, repair_number: r.repairNumber, device: r.device, repair_type: r.repairType, status: r.status, vendor_name: r.vendor?.name ?? null, rma_number: r.rmaNumber, sent_at: iso(r.sentAt) })) });
  }),
);

reportsRouter.get(
  '/reports/repeat-failures',
  requirePermission(P.REPORT_READ),
  validate(z.object({ query: z.object({ months: z.coerce.number().int().min(1).max(36).default(12), min_issues: z.coerce.number().int().min(2).max(50).default(2) }) })),
  handle(async (req, res) => {
    const since = new Date(Date.now() - req.input.query.months * 30 * 86_400_000);
    const groups = await prisma.issue.groupBy({ by: ['deviceId'], where: { ...org(), createdAt: { gte: since } }, _count: { _all: true } });
    const hits = groups.filter((g) => g._count._all >= req.input.query.min_issues);
    const devices = await prisma.device.findMany({ where: { id: { in: hits.map((h) => h.deviceId) } }, select: { id: true, code: true, name: true, repairCount: true } });
    const D = new Map(devices.map((d) => [d.id, d]));
    res.json({ data: hits.map((h) => ({ device: D.get(h.deviceId), issues: h._count._all, repair_count: D.get(h.deviceId)?.repairCount ?? 0 })).sort((a, b) => b.issues - a.issues) });
  }),
);

reportsRouter.get(
  '/reports/transfers-in-transit',
  requirePermission(P.REPORT_READ),
  handle(async (_req, res) => {
    const rows = await prisma.stockTransfer.findMany({
      where: { ...org(), status: 'dispatched' },
      include: { fromLocation: { select: { name: true } }, toLocation: { select: { name: true } }, _count: { select: { items: true } } },
      orderBy: { dispatchedAt: 'asc' },
    });
    res.json({ data: rows.map((t) => ({ id: t.id, transfer_number: t.transferNumber, transfer_type: t.transferType, from: t.fromLocation.name, to: t.toLocation.name, devices: t._count.items, dispatched_at: iso(t.dispatchedAt), tracking_number: t.trackingNumber })) });
  }),
);
