import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { requirePermission } from '../auth/middleware.js';
import { handle, validate } from '../http/request.js';
import { iso, day, money } from '../http/serialize.js';
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

// ---------------------------------------------------------------------------
// The CEO Command Center's procurement, hardware and field cards (FBOS gateway).
// Totals only. A PO counts by its order date (its created date when it has none);
// committed spend leaves out POs not yet approved and cancelled ones.

const COMMITTED_PO = ['approved', 'partially_received', 'received'];
const OPEN_REPAIR_EXCLUDED = ['closed', 'cancelled'];
const MAX_PERIOD_DAYS = 3 * 366;
const DAY_MS = 86_400_000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** The same number of days immediately before [from, to] (both inclusive). */
export function previousPeriod(from, to) {
  const days = Math.round((to - from) / DAY_MS) + 1;
  return { from: new Date(from.getTime() - days * DAY_MS), to: new Date(from.getTime() - DAY_MS) };
}

const orderedIn = (from, to) => ({
  OR: [
    { orderDate: { gte: from, lte: to } },
    { orderDate: null, createdAt: { gte: from, lt: new Date(to.getTime() + DAY_MS) } },
  ],
});

async function committedSpend(from, to) {
  const totals = await prisma.purchaseOrder.aggregate({
    where: { ...org(), status: { in: COMMITTED_PO }, ...orderedIn(from, to) },
    _sum: { totalAmount: true },
    _count: { _all: true },
  });
  return { amount: Number(totals._sum.totalAmount ?? 0), count: totals._count._all };
}

async function mainCurrency() {
  const groups = await prisma.purchaseOrder.groupBy({ by: ['currency'], where: org(), _count: { _all: true } });
  if (!groups.length) return { currency: 'INR', mixed: false };
  const top = groups.reduce((a, b) => (b._count._all > a._count._all ? b : a));
  return { currency: top.currency || 'INR', mixed: groups.length > 1 };
}

/** Committed PO lines by their model's product category, largest first. */
async function spendByCategory(from, to) {
  const lines = await prisma.purchaseOrderItem.groupBy({
    by: ['deviceModelId'],
    where: { purchaseOrder: { ...org(), status: { in: COMMITTED_PO }, ...orderedIn(from, to) } },
    _sum: { lineTotal: true },
  });
  const models = await prisma.deviceModel.findMany({
    where: { id: { in: lines.map((l) => l.deviceModelId) } },
    select: { id: true, category: { select: { name: true } } },
  });
  const categoryOf = new Map(models.map((m) => [m.id, m.category?.name ?? null]));
  const totals = new Map();
  for (const line of lines) {
    const key = categoryOf.get(line.deviceModelId) ?? 'Uncategorized';
    totals.set(key, (totals.get(key) ?? 0) + Number(line._sum.lineTotal ?? 0));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

/** Today on the server's clock: [its midnight, the next midnight). */
export function todayWindow(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * Today's field visits as the CEO sees them (CEO design gaps plan, decision D2): a visit still
 * `scheduled` after its time is escalated (stuck); one not due yet is pending. Cancelled visits
 * are left out.
 */
export function countVisits(visits, now = new Date()) {
  const counts = { completed: 0, in_progress: 0, pending: 0, escalated: 0 };
  for (const visit of visits) {
    if (visit.status === 'completed') counts.completed += 1;
    else if (visit.status === 'in_progress') counts.in_progress += 1;
    else if (visit.status === 'scheduled') counts[visit.scheduledAt < now ? 'escalated' : 'pending'] += 1;
  }
  return counts;
}

async function visitsToday(now = new Date()) {
  const { start, end } = todayWindow(now);
  const visits = await prisma.serviceVisit.findMany({
    where: { ...org(), status: { not: 'cancelled' }, scheduledAt: { gte: start, lt: end } },
    select: { status: true, scheduledAt: true },
  });
  return countVisits(visits, now);
}

/** Each technician's FBOS user, for the gateway to ask People who is in or on leave. */
async function technicianUsers() {
  const technicians = await prisma.technician.findMany({ select: { user: { select: { fbosUserId: true } } } });
  const linked = technicians.map((t) => t.user?.fbosUserId).filter(Boolean);
  return { fbos_user_ids: linked, unlinked: technicians.length - linked.length };
}

/** The summary's period, `from` and `to` as YYYY-MM-DD (the public and the internal route share it). */
export const summaryPeriod = z
  .object({ from: isoDate, to: isoDate })
  .refine((q) => q.to >= q.from, { message: "'to' must be on or after 'from'", path: ['to'] })
  .refine((q) => (new Date(q.to) - new Date(q.from)) / DAY_MS < MAX_PERIOD_DAYS, {
    message: `the period may cover at most ${MAX_PERIOD_DAYS} days`,
    path: ['from'],
  });

reportsRouter.get(
  '/reports/summary',
  requirePermission(P.REPORT_READ),
  validate(z.object({ query: summaryPeriod })),
  handle(async (req, res) => {
    res.json(await procurementSummary(req.input.query.from, req.input.query.to));
  }),
);

/**
 * Purchases, receipts, installations, technicians and open repairs over a period, for the CEO
 * Command Center (`/reports/summary`) and the gateway's nightly snapshots (`/internal/reports/summary`).
 */
export async function procurementSummary(fromDay, toDay) {
  const from = new Date(`${fromDay}T00:00:00.000Z`);
  const to = new Date(`${toDay}T00:00:00.000Z`);
  const previous = previousPeriod(from, to);
  const toEnd = new Date(to.getTime() + DAY_MS);

  const [
    { currency, mixed }, spend, spendPrevious, byStatus, byCategory, receipts, installs, technicians, available, openRepairs,
    visits, technicianLinks,
  ] =
    await Promise.all([
      mainCurrency(),
      committedSpend(from, to),
      committedSpend(previous.from, previous.to),
      prisma.purchaseOrder.groupBy({
        by: ['status'],
        where: { ...org(), ...orderedIn(from, to) },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      spendByCategory(from, to),
      prisma.goodsReceipt.groupBy({
        by: ['status'],
        where: { ...org(), receivedAt: { gte: from, lt: toEnd } },
        _count: { _all: true },
      }),
      prisma.deviceInstallation.groupBy({
        by: ['installationType'],
        where: { ...org(), installedAt: { gte: from, lt: toEnd } },
        _count: { _all: true },
      }),
      // Technicians are the operator's field staff; they carry no organization of their own.
      prisma.technician.count(),
      prisma.technician.count({ where: { isAvailable: true } }),
      prisma.repairOrder.count({ where: { ...org(), status: { notIn: OPEN_REPAIR_EXCLUDED } } }),
      visitsToday(),
      technicianUsers(),
    ]);

  return {
    currency,
    mixed_currencies: mixed,
    period: { from_date: day(from), to_date: day(to) },
    previous_period: { from_date: day(previous.from), to_date: day(previous.to) },
    purchase_orders: {
      committed: money(spend.amount, currency),
      committed_count: spend.count,
      committed_previous: money(spendPrevious.amount, currency),
      by_status: byStatus
        .map((g) => ({ status: g.status, count: g._count._all, total: money(Number(g._sum.totalAmount ?? 0), currency) }))
        .sort((a, b) => b.count - a.count),
      by_category: byCategory.map(([category, amount]) => ({ category, amount: money(amount, currency) })),
    },
    goods_receipts: {
      total: receipts.reduce((sum, g) => sum + g._count._all, 0),
      by_status: receipts.map((g) => ({ status: g.status, count: g._count._all })),
    },
    installations: {
      total: installs.reduce((sum, g) => sum + g._count._all, 0),
      new_installs: installs.find((g) => g.installationType === 'new_install')?._count._all ?? 0,
      by_type: installs.map((g) => ({ installation_type: g.installationType, count: g._count._all })),
    },
    technicians: { total: technicians, available, ...technicianLinks },
    open_repairs: openRepairs,
    // Today, not the period: what the field team is doing now.
    visits_today: visits,
  };
}
