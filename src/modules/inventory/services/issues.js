import { withTx } from '../db.js';
import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { reconcileDeviceStatus } from '../../devices/device.service.js';
import { legacyIssueDetail } from '../../issues/issue.service.js';
import { emitIssueEvent, DOMAIN_EVENT } from '../../../realtime/events.js';
import { assertIssueTransition } from '../../../utils/issueStateMachine.js';
import { changeDeviceState } from '../domain/deviceState.js';
import { enrichNewIssue } from '../domain/issues.js';
import { conflict, notFound, unprocessable, InventoryError } from '../http/errors.js';
import { assertVersion } from '../http/request.js';
import { enqueueNotification } from './outbox.js';

/**
 * Device issues through the v2 API (design doc §6 steps 9-11). Same `issues`
 * table and status machine as the legacy app, so the Fixly mobile app and web
 * keep seeing every issue; realtime/push events fire the same way. Who acted
 * is the FBOS user (and the matching Fixly user when linked).
 */
const org = () => env.FBOS_ORGANIZATION_ID ?? null;
const TX = { maxWait: 10_000, timeout: 30_000 };

export const issueInclude = {
  device: { select: { id: true, code: true, name: true, lifecycleState: true, zoneId: true, zone: { select: { id: true, name: true } } } },
  category: { select: { id: true, name: true } },
  assignedTechnician: { select: { id: true, user: { select: { id: true, name: true, fbosUserId: true } } } },
  warranty: { select: { id: true, endDate: true, warrantyType: true } },
};

/** Issues the caller may see: their sites; technicians with own-records-only see theirs and open ones in coverage. */
export function issueWhere(access) {
  const base = org() ? { organizationId: org() } : {};
  if (access.all) return base;
  if (access.ownOnly) {
    return {
      ...base,
      OR: [
        ...(access.technicianId ? [{ assignedTechnicianId: access.technicianId }] : []),
        { assignedTechnicianId: null, clientId: { in: access.siteIds } },
        { raisedByFbosUserId: access.userId },
      ],
    };
  }
  return { ...base, OR: [{ clientId: { in: access.siteIds } }, { companyId: { in: access.companyIds } }] };
}

export async function issueInScope(tx, access, id, include = issueInclude) {
  const issue = await tx.issue.findFirst({ where: { AND: [issueWhere(access), { id }] }, include });
  if (!issue) throw notFound('issue');
  return issue;
}

/** The Fixly user linked to an FBOS user, for the legacy FK columns (null when not linked). */
export async function legacyUserFor(fbosUserId) {
  const user = await prisma.user.findUnique({ where: { fbosUserId }, select: { id: true } });
  return user?.id ?? null;
}

async function technicianRecipients(tx, clientId) {
  const covering = await tx.technicianAssignment.findMany({
    where: { OR: [{ clientId }, { zone: { clientId } }] },
    select: { technician: { select: { user: { select: { fbosUserId: true } } } } },
  });
  return [...new Set(covering.map((c) => c.technician.user.fbosUserId).filter(Boolean))];
}

export async function raiseIssue(access, actor, body) {
  const device = await prisma.device.findFirst({ where: { AND: [access.deviceWhere(), { id: body.device_id, deletedAt: null }] } });
  if (!device) throw notFound('device');
  if (['retired', 'disposed', 'lost'].includes(device.lifecycleState)) {
    throw conflict('DEVICE_OUT_OF_SERVICE', 'This device is out of service; issues are raised on devices in use or in stock');
  }
  const category = await prisma.issueCategory.findUnique({ where: { id: body.category_id } });
  if (!category || (category.categoryId && category.categoryId !== device.categoryId)) {
    throw unprocessable('ISSUE_CATEGORY_NOT_APPLICABLE', 'That kind of problem does not apply to this device');
  }
  const raisedBy = await legacyUserFor(actor.userId);
  const issue = await withTx(async (tx) => {
    const created = await tx.issue.create({
      data: {
        deviceId: device.id,
        categoryId: category.id,
        raisedByUserId: raisedBy,
        priority: body.priority,
        description: body.description,
        status: 'open',
        attachments: body.attachments ?? [],
      },
    });
    await tx.issueStatusHistory.create({
      data: { issueId: created.id, toStatus: 'open', changedByUserId: raisedBy, changedByFbosUserId: actor.userId, latitude: body.latitude ?? null, longitude: body.longitude ?? null },
    });
    const enriched = await enrichNewIssue(tx, created.id, { raisedVia: body.raised_via ?? 'manual', raisedByFbosUserId: actor.userId });
    await reconcileDeviceStatus(tx, device.id);
    await tx.deviceLifecycleEvent.create({
      data: {
        organizationId: org(), deviceId: device.id, eventType: 'issue_raised', toState: device.lifecycleState,
        referenceType: 'issue', referenceId: created.id, actorUserId: actor.userId, notes: `${enriched.issueNumber}: ${category.name}`,
      },
    });
    const technicians = enriched.clientId ? await technicianRecipients(tx, enriched.clientId) : [];
    await enqueueNotification(tx, {
      eventType: 'issue.raised',
      aggregateType: 'issue',
      aggregateId: created.id,
      notify: {
        title: `${enriched.issueNumber}: ${category.name} on ${device.code}`,
        body: `${body.priority} priority. ${enriched.warrantyStatus === 'in_warranty' ? 'In warranty.' : enriched.warrantyStatus === 'out_of_warranty' ? 'Out of warranty.' : ''}`.trim(),
        action_url: `/inventory/issues/${created.id}`,
        urgency: body.priority === 'critical' ? 'urgent' : body.priority === 'high' ? 'high' : 'normal',
        subject: { type: 'inventory.issue', id: created.id },
        recipient_user_ids: technicians,
      },
    });
    return created;
  }, TX);
  const full = await prisma.issue.findUnique({ where: { id: issue.id }, include: legacyIssueDetail });
  emitIssueEvent(DOMAIN_EVENT.ISSUE_CREATED, full);
  return prisma.issue.findUnique({ where: { id: issue.id }, include: issueInclude });
}

export async function assignIssue(access, actor, id, version, technicianId) {
  const technician = await prisma.technician.findUnique({ where: { id: technicianId }, include: { user: { select: { name: true, fbosUserId: true } } } });
  if (!technician) throw unprocessable('TECHNICIAN_NOT_FOUND', 'That technician does not exist');
  const updated = await withTx(async (tx) => {
    const issue = await issueInScope(tx, access, id);
    assertVersion(issue, version);
    if (['resolved', 'closed'].includes(issue.status)) throw conflict('ISSUE_FINISHED', 'A resolved or closed issue is not assigned');
    const changer = await legacyUserFor(actor.userId);
    const next = await tx.issue.update({
      where: { id },
      data: { assignedTechnicianId: technician.id, status: issue.status === 'open' || issue.status === 'reopened' ? 'assigned' : issue.status, version: { increment: 1 } },
    });
    if (next.status !== issue.status) {
      await tx.issueStatusHistory.create({ data: { issueId: id, fromStatus: issue.status, toStatus: next.status, changedByUserId: changer, changedByFbosUserId: actor.userId, notes: `Assigned to ${technician.user.name}` } });
    }
    await reconcileDeviceStatus(tx, issue.deviceId);
    if (technician.user.fbosUserId) {
      await enqueueNotification(tx, {
        eventType: 'issue.assigned', aggregateType: 'issue', aggregateId: id,
        notify: { title: `${issue.issueNumber} assigned to you`, body: `${issue.category.name} on ${issue.device.code}`, action_url: `/inventory/issues/${id}`, recipient_user_ids: [technician.user.fbosUserId] },
      });
    }
    return next;
  }, TX);
  emitIssueEvent(DOMAIN_EVENT.ISSUE_UPDATED, await prisma.issue.findUnique({ where: { id: updated.id }, include: legacyIssueDetail }));
  return prisma.issue.findUnique({ where: { id: updated.id }, include: issueInclude });
}

/** Move an issue's status (same machine as the legacy app). */
export async function moveIssue(access, actor, id, version, { to_status: toStatus, notes, resolution_type: resolutionType, latitude, longitude }, { tx: outer } = {}) {
  const run = async (tx) => {
    const issue = await issueInScope(tx, access, id);
    assertVersion(issue, version);
    if (issue.status === toStatus) throw conflict('INVALID_TRANSITION', `The issue is already ${toStatus}`);
    try {
      assertIssueTransition(issue.status, toStatus);
    } catch {
      throw conflict('INVALID_TRANSITION', `An issue cannot go from ${issue.status} to ${toStatus}`, { from: issue.status, to: toStatus });
    }
    if (['resolved', 'closed'].includes(toStatus)) {
      const pending = await tx.replacementRequest.findFirst({ where: { issueId: id, status: 'pending' }, select: { id: true } });
      if (pending) throw conflict('REPLACEMENT_PENDING', 'A replacement waits for approval; decide it before finishing the issue', { replacement_id: pending.id });
    }
    // A technician limited to their own issues may only work ones assigned to them (or pick up an open one).
    if (access.ownOnly && issue.assignedTechnicianId && issue.assignedTechnicianId !== access.technicianId) throw notFound('issue');
    const changer = await legacyUserFor(actor.userId);
    const data = {
      status: toStatus,
      version: { increment: 1 },
      ...(toStatus === 'in_progress' && access.technicianId && !issue.assignedTechnicianId ? { assignedTechnicianId: access.technicianId } : {}),
      ...(toStatus === 'resolved' ? { resolvedAt: new Date(), resolutionType: resolutionType ?? issue.resolutionType ?? 'fixed_onsite' } : {}),
      ...(toStatus === 'closed' ? { closedAt: new Date() } : {}),
      ...(['open', 'assigned', 'in_progress', 'on_hold', 'reopened'].includes(toStatus) ? { resolvedAt: null, closedAt: null } : {}),
    };
    const next = await tx.issue.update({ where: { id }, data });
    await tx.issueStatusHistory.create({
      data: { issueId: id, fromStatus: issue.status, toStatus, changedByUserId: changer, changedByFbosUserId: actor.userId, notes: notes ?? null, latitude: latitude ?? null, longitude: longitude ?? null },
    });
    // A fault confirmed in v2 ends with the issue: the unit is working again if it is still in its zone.
    if (toStatus === 'resolved' && ['faulty', 'under_maintenance'].includes(issue.device.lifecycleState) && issue.device.zoneId && data.resolutionType === 'fixed_onsite') {
      await changeDeviceState(tx, issue.deviceId, { toState: 'installed', eventType: 'status_changed', referenceType: 'issue', referenceId: id, actorUserId: actor.userId, notes: `${issue.issueNumber} fixed on site` });
    }
    await reconcileDeviceStatus(tx, issue.deviceId);
    if (toStatus === 'resolved' && issue.raisedByFbosUserId) {
      await enqueueNotification(tx, {
        eventType: 'issue.resolved', aggregateType: 'issue', aggregateId: id,
        notify: { title: `${issue.issueNumber} resolved`, body: `${issue.category.name} on ${issue.device.code}`, action_url: `/inventory/issues/${id}`, recipient_user_ids: [issue.raisedByFbosUserId] },
      });
    }
    return next;
  };
  if (outer) return run(outer);
  const next = await withTx(run, TX);
  emitIssueEvent(DOMAIN_EVENT.ISSUE_UPDATED, await prisma.issue.findUnique({ where: { id: next.id }, include: legacyIssueDetail }));
  return prisma.issue.findUnique({ where: { id: next.id }, include: issueInclude });
}

// ---- Site visits (design doc §6 step 10-11) --------------------------------

/** A technician arrives: the visit starts and the issue is in progress. */
export async function checkIn(access, actor, issueId, body) {
  const technicianId = access.technicianId ?? body.technician_id;
  if (!technicianId) throw new InventoryError(422, 'TECHNICIAN_REQUIRED', 'Only a technician (or someone naming one) can check in');
  return withTx(async (tx) => {
    const issue = await issueInScope(tx, access, issueId);
    if (['resolved', 'closed'].includes(issue.status)) throw conflict('ISSUE_FINISHED', 'This issue is already finished');
    const open = await tx.serviceVisit.findFirst({ where: { issueId, technicianId, status: 'in_progress' } });
    if (open) throw conflict('VISIT_IN_PROGRESS', 'You are already checked in on this issue', { visit_id: open.id });
    const visit = await tx.serviceVisit.create({
      data: {
        organizationId: org(), issueId, technicianId, visitType: body.visit_type ?? 'corrective', status: 'in_progress',
        checkInAt: new Date(), checkInLat: body.latitude ?? null, checkInLng: body.longitude ?? null, createdByUserId: actor.userId,
      },
    });
    if (!['in_progress'].includes(issue.status)) {
      await moveIssue(access, actor, issueId, undefined, { to_status: 'in_progress', notes: 'Technician checked in on site', latitude: body.latitude, longitude: body.longitude }, { tx });
    }
    return visit;
  }, TX);
}

/**
 * Check out with what was found. `fixed` resolves the issue on site; anything
 * that needs a repair or replacement confirms the fault (device → faulty).
 */
export async function checkOut(access, actor, visitId, body) {
  return withTx(async (tx) => {
    const visit = await tx.serviceVisit.findUnique({ where: { id: visitId } });
    if (!visit || visit.status !== 'in_progress') throw notFound('visit');
    const issue = await issueInScope(tx, access, visit.issueId);
    if (access.ownOnly && visit.technicianId !== access.technicianId) throw notFound('visit');
    const done = await tx.serviceVisit.update({
      where: { id: visitId },
      data: {
        status: 'completed', checkOutAt: new Date(), checkOutLat: body.latitude ?? null, checkOutLng: body.longitude ?? null,
        findings: body.findings ?? null, outcome: body.outcome, signatoryName: body.signatory_name ?? null,
        signatureDocumentId: body.signature_document_id ?? null,
      },
    });
    await tx.deviceLifecycleEvent.create({
      data: { organizationId: org(), deviceId: issue.deviceId, eventType: 'visit_done', toState: issue.device.lifecycleState, referenceType: 'service_visit', referenceId: visitId, actorUserId: actor.userId, notes: `${body.outcome.replace(/_/g, ' ')}${body.findings ? `: ${body.findings}` : ''}` },
    });
    if (body.findings) await tx.issue.update({ where: { id: issue.id }, data: { diagnosisSummary: body.findings } });
    if (body.outcome === 'fixed') {
      await moveIssue(access, actor, issue.id, undefined, { to_status: 'resolved', resolution_type: 'fixed_onsite', notes: body.findings }, { tx });
    } else if (['needs_replacement', 'needs_repair', 'needs_parts'].includes(body.outcome) && ['installed', 'under_maintenance'].includes(issue.device.lifecycleState)) {
      await changeDeviceState(tx, issue.deviceId, { toState: 'faulty', eventType: 'status_changed', referenceType: 'issue', referenceId: issue.id, actorUserId: actor.userId, notes: 'Fault confirmed on site' });
    }
    return done;
  }, TX);
}
