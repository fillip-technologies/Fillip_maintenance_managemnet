import { withTx } from '../db.js';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { reconcileDeviceStatus } from '../../devices/device.service.js';
import { requirePermission } from '../auth/middleware.js';
import { withAccess } from '../auth/access.js';
import { requireIdempotencyKey } from '../http/idempotency.js';
import { handle, validate, ifMatchVersion } from '../http/request.js';
import { pageQuery, pageWindow, pageOf } from '../http/page.js';
import { notFound } from '../http/errors.js';
import { iso, day, money, canSeeCost } from '../http/serialize.js';
import { P } from '../permissions.js';
import { assignIssue, checkIn, checkOut, issueInScope, issueInclude, issueWhere, legacyUserFor, moveIssue, raiseIssue } from '../services/issues.js';
import { approveReplacement, completeReplacement, rejectReplacement, replacementInclude, replacementWhere, requestReplacement } from '../services/replacements.js';
import { approveRepair, cancelRepair, closeRepair, createRepair, dispatchRepair, markArrived, repairInclude } from '../services/repairs.js';
import { completeDisposal, decideDisposal, disposalInclude, requestDisposal, retireDevice } from '../services/disposals.js';
import { deviceInScope } from './devices.js';

/** Issues, visits, replacements, repairs, disposals and daily status logs. */
export const serviceRouter = Router();
const id = z.object({ id: z.string().uuid() });
const org = () => (env.FBOS_ORGANIZATION_ID ? { organizationId: env.FBOS_ORGANIZATION_ID } : {});
const ISSUE_STATUSES = ['open', 'assigned', 'in_progress', 'on_hold', 'resolved', 'closed', 'reopened'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

// ---- wire shapes ------------------------------------------------------------

const wireIssue = (i) => ({
  id: i.id,
  issue_number: i.issueNumber,
  status: i.status,
  priority: i.priority,
  description: i.description,
  category: i.category ? { id: i.category.id, name: i.category.name } : { id: i.categoryId },
  device: i.device ? { id: i.device.id, code: i.device.code, name: i.device.name, lifecycle_state: i.device.lifecycleState, zone: i.device.zone ? { id: i.device.zone.id, name: i.device.zone.name } : null } : { id: i.deviceId },
  site_id: i.clientId ?? null,
  customer_id: i.companyId ?? null,
  assigned_technician: i.assignedTechnician ? { id: i.assignedTechnician.id, name: i.assignedTechnician.user.name, user_id: i.assignedTechnician.user.fbosUserId ?? null } : null,
  warranty_status: i.warrantyStatus ?? 'unknown',
  warranty_end_date: day(i.warranty?.endDate),
  raised_via: i.raisedVia ?? null,
  raised_by_user_id: i.raisedByFbosUserId ?? null,
  diagnosis_summary: i.diagnosisSummary ?? null,
  resolution_type: i.resolutionType ?? null,
  sla_due_at: iso(i.slaDueAt),
  overdue: Boolean(i.slaDueAt && !['resolved', 'closed'].includes(i.status) && i.slaDueAt < new Date()),
  attachments: i.attachments ?? [],
  created_at: iso(i.createdAt),
  resolved_at: iso(i.resolvedAt),
  closed_at: iso(i.closedAt),
  version: i.version,
});

const wireVisit = (v) => ({
  id: v.id,
  issue_id: v.issueId,
  technician: v.technician ? { id: v.technician.id, name: v.technician.user?.name ?? null } : { id: v.technicianId },
  visit_type: v.visitType,
  status: v.status,
  check_in_at: iso(v.checkInAt),
  check_out_at: iso(v.checkOutAt),
  findings: v.findings ?? null,
  outcome: v.outcome ?? null,
  signatory_name: v.signatoryName ?? null,
});

const wireReplacement = (r) => ({
  id: r.id,
  status: r.status,
  issue: r.issue ? { id: r.issue.id, issue_number: r.issue.issueNumber, status: r.issue.status } : { id: r.issueId },
  faulty_device: r.faultyDevice ? { id: r.faultyDevice.id, code: r.faultyDevice.code, name: r.faultyDevice.name, lifecycle_state: r.faultyDevice.lifecycleState } : null,
  replacement_device: r.replacementDevice ? { id: r.replacementDevice.id, code: r.replacementDevice.code, name: r.replacementDevice.name, lifecycle_state: r.replacementDevice.lifecycleState } : null,
  stock_transfer: r.stockTransfer ? { id: r.stockTransfer.id, transfer_number: r.stockTransfer.transferNumber, status: r.stockTransfer.status } : null,
  reason: r.reason,
  replacement_basis: r.replacementBasis ?? null,
  old_device_disposition: r.oldDeviceDisposition ?? null,
  cost_borne_by: r.costBorneBy ?? null,
  notes: r.notes ?? null,
  review_note: r.reviewNote ?? null,
  created_at: iso(r.createdAt),
  reviewed_at: iso(r.reviewedAt),
  completed_at: iso(r.completedAt),
});

const wireRepair = (ro, actor) => {
  const cost = canSeeCost(actor);
  return {
    id: ro.id,
    repair_number: ro.repairNumber,
    status: ro.status,
    repair_type: ro.repairType,
    device: ro.device ? { id: ro.device.id, code: ro.device.code, name: ro.device.name, lifecycle_state: ro.device.lifecycleState } : { id: ro.deviceId },
    issue: ro.issue ? { id: ro.issue.id, issue_number: ro.issue.issueNumber } : null,
    vendor: ro.vendor ? { id: ro.vendor.id, name: ro.vendor.name } : null,
    is_warranty_claim: ro.isWarrantyClaim,
    rma_number: ro.rmaNumber ?? null,
    outcome: ro.outcome ?? null,
    cost_estimate: cost ? money(ro.costEstimate, ro.currency) : undefined,
    final_cost: cost ? money(ro.finalCost, ro.currency) : undefined,
    cost_borne_by: ro.costBorneBy ?? null,
    billable: ro.billable,
    invoice_id: ro.invoiceId ?? null,
    outbound_transfer: ro.outboundTransfer ? { id: ro.outboundTransfer.id, transfer_number: ro.outboundTransfer.transferNumber, status: ro.outboundTransfer.status } : null,
    return_transfer: ro.returnTransfer ? { id: ro.returnTransfer.id, transfer_number: ro.returnTransfer.transferNumber, status: ro.returnTransfer.status } : null,
    parts: (ro.parts ?? []).map((p) => ({ part_name: p.partName, quantity: p.quantity, unit_cost: cost ? money(p.unitCost, ro.currency) : undefined, covered_by_warranty: p.coveredByWarranty })),
    notes: ro.notes ?? null,
    sent_at: iso(ro.sentAt),
    returned_at: iso(ro.returnedAt),
    closed_at: iso(ro.closedAt),
    version: ro.version,
    created_at: iso(ro.createdAt),
  };
};

const wireDisposal = (d) => ({
  id: d.id,
  device: d.device ? { id: d.device.id, code: d.device.code, name: d.device.name, lifecycle_state: d.device.lifecycleState, stores_data: d.device.deviceModel?.storesData ?? false } : { id: d.deviceId },
  disposal_method: d.disposalMethod,
  status: d.status,
  reason: d.reason ?? null,
  data_wiped: d.dataWiped,
  certificate_document_id: d.certificateDocumentId ?? null,
  recovered_value: d.recoveredValue == null ? null : money(d.recoveredValue),
  requested_by_user_id: d.requestedByUserId ?? null,
  approved_by_user_id: d.approvedByUserId ?? null,
  approved_at: iso(d.approvedAt),
  disposed_at: iso(d.disposedAt),
  created_at: iso(d.createdAt),
});

// ---- lookups for the forms --------------------------------------------------

serviceRouter.get(
  '/issue-categories',
  requirePermission(P.ISSUE_READ),
  validate(z.object({ query: z.object({ device_id: z.string().uuid().optional() }) })),
  handle(async (req, res) => {
    let categoryId;
    if (req.input.query.device_id) categoryId = (await prisma.device.findUnique({ where: { id: req.input.query.device_id }, select: { categoryId: true } }))?.categoryId;
    const rows = await prisma.issueCategory.findMany({
      where: categoryId ? { OR: [{ categoryId: null }, { categoryId }] } : {},
      orderBy: { name: 'asc' },
    });
    res.json({ data: rows.map((c) => ({ id: c.id, name: c.name, product_category_id: c.categoryId ?? null })) });
  }),
);

serviceRouter.get(
  '/technicians',
  requirePermission(P.ISSUE_READ),
  validate(z.object({ query: z.object({ site_id: z.string().uuid().optional() }) })),
  handle(async (req, res) => {
    const siteId = req.input.query.site_id;
    const rows = await prisma.technician.findMany({
      where: siteId ? { assignments: { some: { OR: [{ clientId: siteId }, { zone: { clientId: siteId } }] } } } : {},
      include: { user: { select: { name: true, fbosUserId: true, accountStatus: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    res.json({ data: rows.filter((t) => t.user.accountStatus !== 'removed').map((t) => ({ id: t.id, name: t.user.name, user_id: t.user.fbosUserId ?? null, specialization: t.specialization ?? null, is_available: t.isAvailable })) });
  }),
);

// ---- issues -----------------------------------------------------------------

serviceRouter.get(
  '/issues',
  requirePermission(P.ISSUE_READ),
  validate(z.object({
    query: z.object({
      ...pageQuery,
      status: z.string().transform((s) => s.split(',')).pipe(z.array(z.enum(ISSUE_STATUSES))).optional(),
      priority: z.enum(PRIORITIES).optional(),
      device_id: z.string().uuid().optional(),
      site_id: z.string().uuid().optional(),
      mine: z.enum(['true']).optional(),
      overdue: z.enum(['true']).optional(),
      q: z.string().trim().min(1).optional(),
    }),
  })),
  withAccess(P.ISSUE_READ),
  handle(async (req, res) => {
    const q = req.input.query;
    const where = {
      AND: [
        issueWhere(req.access),
        q.status ? { status: { in: q.status } } : {},
        q.priority ? { priority: q.priority } : {},
        q.device_id ? { deviceId: q.device_id } : {},
        q.site_id ? { clientId: q.site_id } : {},
        q.mine ? { OR: [{ assignedTechnicianId: req.access.technicianId ?? '-' }, { raisedByFbosUserId: req.actor.userId }] } : {},
        q.overdue ? { slaDueAt: { lt: new Date() }, status: { notIn: ['resolved', 'closed'] } } : {},
        q.q ? { OR: [{ issueNumber: { contains: q.q } }, { description: { contains: q.q } }, { device: { code: { contains: q.q } } }] } : {},
      ],
    };
    const window = pageWindow(q);
    const [rows, total] = await Promise.all([
      prisma.issue.findMany({ where, include: issueInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: window.skip, take: window.take }),
      prisma.issue.count({ where }),
    ]);
    const page = pageOf(rows, window, total);
    res.json({ ...page, data: page.data.map(wireIssue) });
  }),
);

serviceRouter.get(
  '/issues/:id',
  requirePermission(P.ISSUE_READ),
  validate(z.object({ params: id })),
  withAccess(P.ISSUE_READ),
  handle(async (req, res) => {
    const issue = await issueInScope(prisma, req.access, req.params.id, {
      ...issueInclude,
      statusHistory: { orderBy: { changedAt: 'asc' }, include: { changedBy: { select: { name: true } } } },
      serviceVisits: { orderBy: { createdAt: 'asc' }, include: { technician: { select: { id: true, user: { select: { name: true } } } } } },
      replacementRequests: { orderBy: { createdAt: 'desc' }, include: replacementInclude },
      repairOrders: { orderBy: { createdAt: 'desc' }, select: { id: true, repairNumber: true, status: true, repairType: true } },
    });
    res.set('ETag', `"${issue.version}"`).json({
      ...wireIssue(issue),
      history: issue.statusHistory.map((h) => ({ from_status: h.fromStatus, to_status: h.toStatus, notes: h.notes, changed_at: iso(h.changedAt), changed_by_name: h.changedBy?.name ?? null, changed_by_user_id: h.changedByFbosUserId ?? null })),
      visits: issue.serviceVisits.map(wireVisit),
      replacements: issue.replacementRequests.map(wireReplacement),
      repair_orders: issue.repairOrders.map((r) => ({ id: r.id, repair_number: r.repairNumber, status: r.status, repair_type: r.repairType })),
    });
  }),
);

serviceRouter.post(
  '/issues',
  requirePermission(P.ISSUE_WRITE),
  validate(z.object({
    body: z.object({
      device_id: z.string().uuid(),
      category_id: z.string().uuid(),
      priority: z.enum(PRIORITIES).default('medium'),
      description: z.string().trim().min(1).max(4000),
      raised_via: z.enum(['manual', 'mobile', 'daily_log', 'alert']).optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      attachments: z.array(z.object({ document_id: z.string().uuid() })).max(10).optional(),
    }),
  })),
  withAccess(P.ISSUE_WRITE),
  handle(async (req, res) => res.status(201).json(wireIssue(await raiseIssue(req.access, req.actor, req.input.body)))),
);

serviceRouter.post(
  '/issues/:id/assign',
  requirePermission(P.ISSUE_ASSIGN),
  validate(z.object({ params: id, body: z.object({ technician_id: z.string().uuid() }) })),
  withAccess(P.ISSUE_ASSIGN),
  handle(async (req, res) => res.json(wireIssue(await assignIssue(req.access, req.actor, req.params.id, ifMatchVersion(req), req.input.body.technician_id)))),
);

serviceRouter.post(
  '/issues/:id/status',
  requirePermission(P.ISSUE_WRITE),
  validate(z.object({
    params: id,
    body: z.object({
      to_status: z.enum(ISSUE_STATUSES),
      notes: z.string().max(4000).optional(),
      resolution_type: z.enum(['fixed_onsite', 'replaced', 'repaired', 'no_fault_found', 'other']).optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
    }),
  })),
  withAccess(P.ISSUE_WRITE),
  handle(async (req, res) => res.json(wireIssue(await moveIssue(req.access, req.actor, req.params.id, ifMatchVersion(req), req.input.body)))),
);

// ---- visits -----------------------------------------------------------------

serviceRouter.post(
  '/issues/:id/visits',
  requirePermission(P.ISSUE_WRITE),
  validate(z.object({
    params: id,
    body: z.object({
      visit_type: z.enum(['corrective', 'preventive', 'installation', 'inspection']).optional(),
      technician_id: z.string().uuid().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
    }).default({}),
  })),
  withAccess(P.ISSUE_WRITE),
  handle(async (req, res) => res.status(201).json(wireVisit(await checkIn(req.access, req.actor, req.params.id, req.input.body)))),
);

serviceRouter.post(
  '/visits/:id/check-out',
  requirePermission(P.ISSUE_WRITE),
  validate(z.object({
    params: id,
    body: z.object({
      outcome: z.enum(['fixed', 'needs_parts', 'needs_replacement', 'needs_repair', 'not_reproducible', 'other']),
      findings: z.string().max(4000).optional(),
      signatory_name: z.string().max(160).optional(),
      signature_document_id: z.string().uuid().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
    }),
  })),
  withAccess(P.ISSUE_WRITE),
  handle(async (req, res) => res.json(wireVisit(await checkOut(req.access, req.actor, req.params.id, req.input.body)))),
);

// ---- replacements -----------------------------------------------------------

serviceRouter.get(
  '/replacements',
  requirePermission(P.ISSUE_READ),
  validate(z.object({ query: z.object({ ...pageQuery, status: z.enum(['pending', 'approved', 'rejected', 'completed', 'cancelled']).optional() }) })),
  withAccess(P.ISSUE_READ),
  handle(async (req, res) => {
    const q = req.input.query;
    const where = { AND: [replacementWhere(req.access), q.status ? { status: q.status } : {}, { faultyDeviceId: { not: null } }] };
    const window = pageWindow(q);
    const rows = await prisma.replacementRequest.findMany({ where, include: replacementInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: window.skip, take: window.take });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map(wireReplacement) });
  }),
);

serviceRouter.post(
  '/replacements',
  requirePermission(P.REPLACEMENT_WRITE),
  validate(z.object({
    body: z.object({
      issue_id: z.string().uuid(),
      reason: z.enum(['physical_damage', 'burnt_water', 'unrepairable', 'obsolete']),
      old_device_disposition: z.enum(['to_repair', 'vendor_rma', 'return_to_stock', 'scrap']),
      replacement_basis: z.enum(['warranty', 'paid', 'goodwill']).optional(),
      cost_borne_by: z.enum(['customer', 'operator', 'vendor']).optional(),
      cost_amount: z.number().nonnegative().optional(),
      notes: z.string().max(4000).optional(),
    }),
  })),
  withAccess(P.ISSUE_READ),
  handle(async (req, res) => res.status(201).json(wireReplacement(await requestReplacement(req.access, req.actor, req.input.body)))),
);

serviceRouter.post(
  '/replacements/:id/approve',
  requirePermission(P.REPLACEMENT_APPROVE),
  validate(z.object({ params: id, body: z.object({ spare_device_id: z.string().uuid().optional(), note: z.string().max(2000).optional() }).default({}) })),
  withAccess(P.REPLACEMENT_APPROVE),
  handle(async (req, res) => res.json(wireReplacement(await approveReplacement(req.access, req.actor, req.params.id, req.input.body)))),
);

serviceRouter.post(
  '/replacements/:id/reject',
  requirePermission(P.REPLACEMENT_APPROVE),
  validate(z.object({ params: id, body: z.object({ note: z.string().max(2000).optional() }).default({}) })),
  withAccess(P.REPLACEMENT_APPROVE),
  handle(async (req, res) => res.json(wireReplacement(await rejectReplacement(req.access, req.actor, req.params.id, req.input.body.note)))),
);

serviceRouter.post(
  '/replacements/:id/complete',
  requirePermission(P.DEVICE_WRITE),
  validate(z.object({ params: id, body: z.object({ position_label: z.string().max(200).optional() }).default({}) })),
  withAccess(P.DEVICE_WRITE),
  handle(async (req, res) => res.json(wireReplacement(await completeReplacement(req.access, req.actor, req.params.id, req.input.body)))),
);

// ---- repair orders (operator) -------------------------------------------------

serviceRouter.get(
  '/repair-orders',
  requirePermission(P.REPAIR_READ),
  validate(z.object({ query: z.object({ ...pageQuery, status: z.string().transform((s) => s.split(',')).optional(), device_id: z.string().uuid().optional() }) })),
  handle(async (req, res) => {
    const q = req.input.query;
    const where = { AND: [org(), q.status ? { status: { in: q.status } } : {}, q.device_id ? { deviceId: q.device_id } : {}] };
    const window = pageWindow(q);
    const rows = await prisma.repairOrder.findMany({ where, include: repairInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: window.skip, take: window.take });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map((r) => wireRepair(r, req.actor)) });
  }),
);

serviceRouter.get(
  '/repair-orders/:id',
  requirePermission(P.REPAIR_READ),
  validate(z.object({ params: id })),
  handle(async (req, res) => {
    const ro = await prisma.repairOrder.findFirst({ where: { ...org(), id: req.params.id }, include: repairInclude });
    if (!ro) throw notFound('repair order');
    res.set('ETag', `"${ro.version}"`).json(wireRepair(ro, req.actor));
  }),
);

serviceRouter.post(
  '/repair-orders',
  requirePermission(P.REPAIR_WRITE),
  validate(z.object({
    body: z.object({
      device_id: z.string().uuid(),
      issue_id: z.string().uuid().optional(),
      repair_type: z.enum(['in_house', 'service_center', 'vendor_rma']),
      vendor_id: z.string().uuid().optional(),
      is_warranty_claim: z.boolean().optional(),
      rma_number: z.string().max(60).optional(),
      cost_estimate: z.number().nonnegative().optional(),
      cost_borne_by: z.enum(['customer', 'operator', 'vendor']).optional(),
      billable: z.boolean().optional(),
      notes: z.string().max(4000).optional(),
    }),
  })),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => res.status(201).json(wireRepair(await createRepair(req.access, req.actor, req.input.body), req.actor))),
);

serviceRouter.post(
  '/repair-orders/:id/approve',
  requirePermission(P.REPAIR_APPROVE),
  validate(z.object({ params: id })),
  handle(async (req, res) => res.json(wireRepair(await approveRepair(req.actor, req.params.id, ifMatchVersion(req)), req.actor))),
);

serviceRouter.post(
  '/repair-orders/:id/dispatch',
  requirePermission(P.REPAIR_WRITE),
  requireIdempotencyKey,
  validate(z.object({ params: id, body: z.object({ carrier: z.string().max(120).optional(), tracking_number: z.string().max(120).optional(), challan_no: z.string().max(60).optional() }).default({}) })),
  handle(async (req, res) => res.json(wireRepair(await dispatchRepair(req.actor, req.params.id, ifMatchVersion(req), req.input.body), req.actor))),
);

serviceRouter.post(
  '/repair-orders/:id/arrived',
  requirePermission(P.REPAIR_WRITE),
  validate(z.object({ params: id })),
  handle(async (req, res) => res.json(wireRepair(await markArrived(req.actor, req.params.id), req.actor))),
);

serviceRouter.post(
  '/repair-orders/:id/close',
  requirePermission(P.REPAIR_WRITE),
  validate(z.object({
    params: id,
    body: z.object({
      outcome: z.enum(['repaired', 'replaced_by_vendor', 'beyond_repair']),
      return_location_id: z.string().uuid().optional(),
      final_cost: z.number().nonnegative().optional(),
      parts: z.array(z.object({ part_name: z.string().min(1).max(160), quantity: z.number().int().min(1).optional(), unit_cost: z.number().nonnegative().optional(), covered_by_warranty: z.boolean().optional() })).max(50).optional(),
    }).refine((b) => b.outcome === 'beyond_repair' || b.return_location_id, { message: 'Say which store the device comes back to', path: ['return_location_id'] }),
  })),
  handle(async (req, res) => res.json(wireRepair(await closeRepair(req.actor, req.params.id, ifMatchVersion(req), req.input.body), req.actor))),
);

serviceRouter.post(
  '/repair-orders/:id/cancel',
  requirePermission(P.REPAIR_WRITE),
  validate(z.object({ params: id })),
  handle(async (req, res) => res.json(wireRepair(await cancelRepair(req.actor, req.params.id, ifMatchVersion(req)), req.actor))),
);

// ---- retirement and disposal --------------------------------------------------

serviceRouter.post(
  '/devices/:id/retire',
  requirePermission(P.DISPOSAL_WRITE),
  validate(z.object({ params: id, body: z.object({ reason: z.string().trim().min(1).max(1000) }) })),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => {
    await retireDevice(req.access, req.actor, req.params.id, req.input.body.reason);
    res.json({ id: req.params.id, lifecycle_state: 'retired' });
  }),
);

serviceRouter.get(
  '/disposals',
  requirePermission(P.DISPOSAL_READ),
  validate(z.object({ query: z.object({ ...pageQuery, status: z.enum(['pending', 'approved', 'rejected', 'completed']).optional() }) })),
  handle(async (req, res) => {
    const q = req.input.query;
    const window = pageWindow(q);
    const rows = await prisma.deviceDisposal.findMany({ where: { AND: [org(), q.status ? { status: q.status } : {}] }, include: disposalInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: window.skip, take: window.take });
    const page = pageOf(rows, window);
    res.json({ ...page, data: page.data.map(wireDisposal) });
  }),
);

serviceRouter.post(
  '/disposals',
  requirePermission(P.DISPOSAL_WRITE),
  validate(z.object({ body: z.object({ device_id: z.string().uuid(), disposal_method: z.enum(['scrap', 'sold', 'recycled', 'returned_to_vendor', 'donated']), reason: z.string().max(2000).optional(), notes: z.string().max(2000).optional() }) })),
  withAccess(P.DEVICE_READ),
  handle(async (req, res) => res.status(201).json(wireDisposal(await requestDisposal(req.access, req.actor, req.input.body)))),
);

for (const [path, approve] of [['approve', true], ['reject', false]]) {
  serviceRouter.post(
    `/disposals/:id/${path}`,
    requirePermission(P.DISPOSAL_APPROVE),
    validate(z.object({ params: id, body: z.object({ note: z.string().max(2000).optional() }).default({}) })),
    handle(async (req, res) => res.json(wireDisposal(await decideDisposal(req.actor, req.params.id, approve, req.input.body.note)))),
  );
}

serviceRouter.post(
  '/disposals/:id/complete',
  requirePermission(P.DISPOSAL_WRITE),
  validate(z.object({ params: id, body: z.object({ data_wiped: z.boolean().default(false), certificate_document_id: z.string().uuid().optional(), recovered_value: z.number().nonnegative().optional() }) })),
  handle(async (req, res) => res.json(wireDisposal(await completeDisposal(req.actor, req.params.id, req.input.body)))),
);

// ---- daily status logs ----------------------------------------------------------

serviceRouter.post(
  '/daily-status-logs',
  requirePermission(P.DEVICE_WRITE),
  validate(z.object({ body: z.object({ device_id: z.string().uuid(), status: z.enum(['working', 'not_working', 'needs_attention']), notes: z.string().max(2000).optional(), log_date: z.string().date().optional() }) })),
  withAccess(P.DEVICE_WRITE),
  handle(async (req, res) => {
    const b = req.input.body;
    const device = await deviceInScope(req.access, b.device_id, {});
    const logDate = new Date(b.log_date ?? new Date().toISOString().slice(0, 10));
    const loggedBy = await legacyUserFor(req.actor.userId);
    const log = await withTx(async (tx) => {
      const row = await tx.dailyStatusLog.upsert({
        where: { deviceId_logDate: { deviceId: device.id, logDate } },
        create: { deviceId: device.id, logDate, status: b.status, notes: b.notes ?? null, loggedByUserId: loggedBy },
        update: { status: b.status, notes: b.notes ?? null, loggedByUserId: loggedBy },
      });
      await tx.device.update({ where: { id: device.id }, data: { healthStatus: b.status } });
      await reconcileDeviceStatus(tx, device.id);
      return row;
    });
    res.status(201).json({ id: log.id, device_id: log.deviceId, status: log.status, log_date: day(log.logDate), notes: log.notes ?? null });
  }),
);
