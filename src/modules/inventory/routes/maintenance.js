import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { withTx } from '../db.js';
import { env } from '../../../config/env.js';
import { requirePermission } from '../auth/middleware.js';
import { withAccess } from '../auth/access.js';
import { handle, validate } from '../http/request.js';
import { pageQuery, pageWindow, pageOf } from '../http/page.js';
import { conflict, notFound, unprocessable } from '../http/errors.js';
import { iso, day, money } from '../http/serialize.js';
import { P } from '../permissions.js';
import { generateDueVisits } from '../services/maintenance.js';
import { deviceInScope } from './devices.js';

/** Phase 5: preventive maintenance plans and visits, AMC warranties, links to FBOS records. */
export const maintenanceRouter = Router();
const id = z.object({ id: z.string().uuid() });
const org = () => (env.FBOS_ORGANIZATION_ID ? { organizationId: env.FBOS_ORGANIZATION_ID } : {});

const wirePlan = (p) => ({
  id: p.id, name: p.name, site_id: p.clientId, customer_id: p.companyId ?? null, zone_id: p.zoneId ?? null,
  device_model_id: p.deviceModelId ?? null, warranty_id: p.warrantyId ?? null, contract_id: p.contractId ?? null,
  frequency_days: p.frequencyDays, lead_days: p.leadDays, next_due_at: day(p.nextDueAt), last_generated_at: iso(p.lastGeneratedAt),
  technician_id: p.technicianId ?? null, is_active: p.isActive, notes: p.notes ?? null,
  ...(p._count ? { visit_count: p._count.visits } : {}),
});
const wireVisit = (v) => ({
  id: v.id, visit_type: v.visitType, status: v.status, site_id: v.clientId ?? null, issue_id: v.issueId ?? null,
  maintenance_plan: v.maintenancePlan ? { id: v.maintenancePlan.id, name: v.maintenancePlan.name } : null,
  technician: v.technician ? { id: v.technician.id, name: v.technician.user?.name ?? null } : null,
  scheduled_at: iso(v.scheduledAt), check_in_at: iso(v.checkInAt), check_out_at: iso(v.checkOutAt),
  findings: v.findings ?? null, outcome: v.outcome ?? null,
});

const planBody = z.object({
  name: z.string().trim().min(1).max(160),
  site_id: z.string().uuid(),
  zone_id: z.string().uuid().nullable().optional(),
  device_model_id: z.string().uuid().nullable().optional(),
  warranty_id: z.string().uuid().nullable().optional(),
  contract_id: z.string().uuid().nullable().optional(),
  frequency_days: z.number().int().min(1).max(730),
  lead_days: z.number().int().min(0).max(90).optional(),
  next_due_at: z.string().date(),
  technician_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
  notes: z.string().max(4000).nullable().optional(),
});
const planData = (b) => Object.fromEntries(Object.entries({
  name: b.name, clientId: b.site_id, zoneId: b.zone_id, deviceModelId: b.device_model_id, warrantyId: b.warranty_id, contractId: b.contract_id,
  frequencyDays: b.frequency_days, leadDays: b.lead_days, nextDueAt: b.next_due_at ? new Date(b.next_due_at) : undefined,
  technicianId: b.technician_id, isActive: b.is_active, notes: b.notes,
}).filter(([, v]) => v !== undefined));

const plansWhere = (access) => (access.all ? org() : { ...org(), clientId: { in: [...access.siteIds, ...access.zoneSiteIds] } });

maintenanceRouter.get(
  '/maintenance-plans',
  requirePermission(P.MAINTENANCE_READ),
  validate(z.object({ query: z.object({ ...pageQuery, site_id: z.string().uuid().optional() }) })),
  withAccess(P.MAINTENANCE_READ),
  handle(async (req, res) => {
    const q = req.input.query;
    const window = pageWindow(q);
    const rows = await prisma.maintenancePlan.findMany({
      where: { AND: [plansWhere(req.access), q.site_id ? { clientId: q.site_id } : {}] },
      include: { _count: { select: { visits: true } } }, orderBy: [{ nextDueAt: 'asc' }, { id: 'asc' }], skip: window.skip, take: window.take,
    });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map(wirePlan) });
  }),
);

maintenanceRouter.post(
  '/maintenance-plans',
  requirePermission(P.MAINTENANCE_WRITE),
  validate(z.object({ body: planBody })),
  withAccess(P.MAINTENANCE_WRITE),
  handle(async (req, res) => {
    const site = await prisma.client.findFirst({ where: { AND: [req.access.siteWhere(), { id: req.input.body.site_id }] } });
    if (!site) throw notFound('site');
    const plan = await prisma.maintenancePlan.create({
      data: { organizationId: env.FBOS_ORGANIZATION_ID ?? null, companyId: site.companyId, createdByUserId: req.actor.userId, ...planData(req.input.body) },
    });
    res.status(201).json(wirePlan(plan));
  }),
);

maintenanceRouter.patch(
  '/maintenance-plans/:id',
  requirePermission(P.MAINTENANCE_WRITE),
  validate(z.object({ params: id, body: planBody.partial() })),
  withAccess(P.MAINTENANCE_WRITE),
  handle(async (req, res) => {
    const plan = await prisma.maintenancePlan.findFirst({ where: { AND: [plansWhere(req.access), { id: req.params.id }] } });
    if (!plan) throw notFound('maintenance plan');
    res.json(wirePlan(await prisma.maintenancePlan.update({ where: { id: plan.id }, data: planData(req.input.body) })));
  }),
);

// Normally the worker does this daily; operators can run it now.
maintenanceRouter.post(
  '/maintenance-plans/generate',
  requirePermission(P.MAINTENANCE_WRITE),
  withAccess(P.MAINTENANCE_WRITE),
  handle(async (req, res) => {
    if (!req.access.all) throw notFound('maintenance plan');
    res.json({ created: await generateDueVisits() });
  }),
);

const visitInclude = { maintenancePlan: { select: { id: true, name: true } }, technician: { select: { id: true, user: { select: { name: true } } } } };

/** Scheduled preventive visits; technicians see their own. */
maintenanceRouter.get(
  '/visits',
  requirePermission(P.ISSUE_READ),
  validate(z.object({ query: z.object({ ...pageQuery, status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional(), visit_type: z.enum(['corrective', 'preventive', 'installation', 'inspection']).optional() }) })),
  withAccess(P.ISSUE_READ),
  handle(async (req, res) => {
    const q = req.input.query;
    const a = req.access;
    const scope = a.all ? {} : a.ownOnly ? { technicianId: a.technicianId ?? '-' } : { clientId: { in: [...a.siteIds, ...a.zoneSiteIds] } };
    const window = pageWindow(q);
    const rows = await prisma.serviceVisit.findMany({
      where: { AND: [org(), scope, q.status ? { status: q.status } : {}, q.visit_type ? { visitType: q.visit_type } : {}] },
      include: visitInclude, orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }], skip: window.skip, take: window.take,
    });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map(wireVisit) });
  }),
);

async function visitInScope(access, visitId) {
  const v = await prisma.serviceVisit.findUnique({ where: { id: visitId }, include: visitInclude });
  if (!v || !v.maintenancePlanId) throw notFound('visit');
  if (!access.all && !(access.ownOnly ? v.technicianId === access.technicianId : [...access.siteIds, ...access.zoneSiteIds].includes(v.clientId))) throw notFound('visit');
  return v;
}

maintenanceRouter.post(
  '/visits/:id/start',
  requirePermission(P.ISSUE_WRITE),
  validate(z.object({ params: id, body: z.object({ latitude: z.number().optional(), longitude: z.number().optional() }).default({}) })),
  withAccess(P.ISSUE_WRITE),
  handle(async (req, res) => {
    const v = await visitInScope(req.access, req.params.id);
    if (v.status !== 'scheduled') throw conflict('VISIT_NOT_SCHEDULED', 'Only a scheduled visit can be started');
    const updated = await prisma.serviceVisit.update({
      where: { id: v.id },
      data: { status: 'in_progress', checkInAt: new Date(), checkInLat: req.input.body.latitude ?? null, checkInLng: req.input.body.longitude ?? null, technicianId: v.technicianId ?? req.access.technicianId ?? null },
      include: visitInclude,
    });
    res.json(wireVisit(updated));
  }),
);

maintenanceRouter.post(
  '/visits/:id/complete',
  requirePermission(P.ISSUE_WRITE),
  validate(z.object({ params: id, body: z.object({ findings: z.string().max(4000).optional(), outcome: z.enum(['fixed', 'needs_parts', 'needs_replacement', 'needs_repair', 'not_reproducible', 'other']).default('fixed') }) })),
  withAccess(P.ISSUE_WRITE),
  handle(async (req, res) => {
    const v = await visitInScope(req.access, req.params.id);
    if (v.status !== 'in_progress') throw conflict('VISIT_NOT_IN_PROGRESS', 'Start the visit first');
    const updated = await prisma.serviceVisit.update({
      where: { id: v.id }, data: { status: 'completed', checkOutAt: new Date(), findings: req.input.body.findings ?? null, outcome: req.input.body.outcome }, include: visitInclude,
    });
    res.json(wireVisit(updated));
  }),
);

// AMC and extended cover added by hand (manufacturer warranties come from goods receipts).
maintenanceRouter.post(
  '/warranties',
  requirePermission(P.WARRANTY_WRITE),
  validate(z.object({
    body: z.object({
      device_id: z.string().uuid(),
      warranty_type: z.enum(['manufacturer', 'extended', 'amc', 'seller']),
      start_date: z.string().date(),
      end_date: z.string().date(),
      vendor_id: z.string().uuid().optional(),
      coverage: z.string().max(255).optional(),
      contract_id: z.string().uuid().optional(),
      notes: z.string().max(2000).optional(),
    }).refine((b) => b.end_date >= b.start_date, { message: 'The cover must end after it starts', path: ['end_date'] }),
  })),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    const b = req.input.body;
    const device = await deviceInScope(req.access, b.device_id, {});
    const w = await withTx(async (tx) => {
      const row = await tx.warranty.create({
        data: {
          organizationId: env.FBOS_ORGANIZATION_ID ?? null, deviceId: device.id, warrantyType: b.warranty_type, startBasis: 'install_date',
          startDate: new Date(b.start_date), endDate: new Date(b.end_date), vendorId: b.vendor_id ?? null, coverage: b.coverage ?? null,
          contractId: b.contract_id ?? null, notes: b.notes ?? null,
        },
      });
      if (!device.warrantyEndDate || device.warrantyEndDate < row.endDate) await tx.device.update({ where: { id: device.id }, data: { warrantyEndDate: row.endDate } });
      return row;
    });
    res.status(201).json({ id: w.id, device_id: w.deviceId, warranty_type: w.warrantyType, start_date: day(w.startDate), end_date: day(w.endDate), contract_id: w.contractId });
  }),
);

// Links to FBOS records, set once those exist: a repair billed through a Revenue invoice.
maintenanceRouter.patch(
  '/repair-orders/:id/billing',
  requirePermission(P.REPAIR_WRITE),
  validate(z.object({ params: id, body: z.object({ billable: z.boolean().optional(), invoice_id: z.string().uuid().nullable().optional() }) })),
  handle(async (req, res) => {
    const ro = await prisma.repairOrder.findFirst({ where: { ...org(), id: req.params.id } });
    if (!ro) throw notFound('repair order');
    if (req.input.body.invoice_id && !(req.input.body.billable ?? ro.billable)) throw unprocessable('NOT_BILLABLE', 'Mark the repair billable before linking an invoice');
    const updated = await prisma.repairOrder.update({ where: { id: ro.id }, data: req.input.body.invoice_id === undefined ? { billable: req.input.body.billable } : { billable: req.input.body.billable ?? ro.billable, invoiceId: req.input.body.invoice_id } });
    res.json({ id: updated.id, billable: updated.billable, invoice_id: updated.invoiceId, final_cost: money(updated.finalCost, updated.currency) });
  }),
);
