import { withTx } from '../db.js';
import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { reconcileDeviceStatus } from '../../devices/device.service.js';
import { changeDeviceState } from '../domain/deviceState.js';
import { conflict, notFound, unprocessable } from '../http/errors.js';
import { createTransfer } from './transfers.js';
import { issueInScope, legacyUserFor, moveIssue } from './issues.js';
import { enqueueNotification } from './outbox.js';

/**
 * Replacing a faulty unit (design doc §6 step 12, rule 8). Uses the legacy
 * `replacement_requests` table, now with real device links:
 *   request  → faulty unit pending_replacement
 *   approve  → a spare is picked (site store, then customer store, then
 *              warehouse) and reserved; from elsewhere it travels on a
 *              replacement_dispatch transfer
 *   complete → spare installed in the old unit's zone (replaces_installation_id),
 *              old unit follows its disposition, issue resolved as replaced
 */
const TX = { maxWait: 10_000, timeout: 30_000 };
const org = () => env.FBOS_ORGANIZATION_ID ?? null;

export const replacementInclude = {
  issue: { select: { id: true, issueNumber: true, status: true, clientId: true, companyId: true } },
  faultyDevice: { select: { id: true, code: true, name: true, lifecycleState: true, deviceModelId: true } },
  replacementDevice: { select: { id: true, code: true, name: true, lifecycleState: true, currentLocationId: true } },
  stockTransfer: { select: { id: true, transferNumber: true, status: true } },
};

export function replacementWhere(access) {
  if (access.all) return {};
  return { issue: { OR: [{ clientId: { in: access.siteIds } }, { companyId: { in: access.companyIds } }] } };
}

async function replacementInScope(tx, access, id) {
  const r = await tx.replacementRequest.findFirst({ where: { AND: [replacementWhere(access), { id }] }, include: replacementInclude });
  if (!r) throw notFound('replacement');
  return r;
}

export async function requestReplacement(access, actor, body) {
  return withTx(async (tx) => {
    const issue = await issueInScope(tx, access, body.issue_id);
    if (['resolved', 'closed'].includes(issue.status)) throw conflict('ISSUE_FINISHED', 'This issue is already finished');
    const open = await tx.replacementRequest.findFirst({ where: { issueId: issue.id, status: { in: ['pending', 'approved'] } } });
    if (open) throw conflict('REPLACEMENT_ALREADY_REQUESTED', 'A replacement is already under way for this issue', { replacement_id: open.id });
    const device = await tx.device.findUnique({ where: { id: issue.deviceId } });
    if (!device.zoneId) throw conflict('DEVICE_NOT_INSTALLED', 'Only an installed device is replaced; this one is not in a zone');
    const requester = await legacyUserFor(actor.userId);
    const r = await tx.replacementRequest.create({
      data: {
        organizationId: org(),
        issueId: issue.id,
        requestedByUserId: requester,
        requestedByFbosUserId: actor.userId,
        reason: body.reason,
        replacementChoice: 'in_stock',
        notes: body.notes ?? null,
        faultyDeviceId: device.id,
        warrantyId: issue.warrantyId,
        replacementBasis: body.replacement_basis ?? (issue.warrantyStatus === 'in_warranty' ? 'warranty' : 'paid'),
        oldDeviceDisposition: body.old_device_disposition,
        costBorneBy: body.cost_borne_by ?? null,
        costAmount: body.cost_amount ?? null,
      },
    });
    await changeDeviceState(tx, device.id, {
      toState: 'pending_replacement', eventType: 'status_changed', referenceType: 'replacement_request', referenceId: r.id, actorUserId: actor.userId,
      notes: `Replacement requested on ${issue.issueNumber}`,
    });
    await reconcileDeviceStatus(tx, device.id);
    return tx.replacementRequest.findUnique({ where: { id: r.id }, include: replacementInclude });
  }, TX);
}

/** Rule 8: the nearest spare of the same model: site store, then customer store, then warehouse. */
async function findSpare(tx, faulty, clientId, companyId) {
  const tiers = [
    { locationType: 'client_store', clientId, lifecycleState: 'in_client_stock' },
    { locationType: 'company_store', companyId, lifecycleState: 'in_company_stock' },
    { locationType: 'platform_warehouse', lifecycleState: 'in_platform_stock' },
  ];
  for (const tier of tiers) {
    const spare = await tx.device.findFirst({
      where: {
        deviceModelId: faulty.deviceModelId,
        lifecycleState: tier.lifecycleState,
        deletedAt: null,
        id: { not: faulty.id },
        currentLocation: { locationType: tier.locationType, ...(tier.clientId ? { clientId: tier.clientId } : {}), ...(tier.companyId ? { companyId: tier.companyId } : {}) },
      },
      orderBy: [{ condition: 'asc' }, { receivedAt: 'asc' }],
    });
    if (spare) return spare;
  }
  return null;
}

export async function approveReplacement(access, actor, id, body) {
  return withTx(async (tx) => {
    const r = await replacementInScope(tx, access, id);
    if (r.status !== 'pending') throw conflict('INVALID_REPLACEMENT_STATUS', `A ${r.status} replacement cannot be approved`);
    const siteStore = await tx.stockLocation.findFirst({ where: { locationType: 'client_store', clientId: r.issue.clientId } });
    if (!siteStore) throw unprocessable('SITE_HAS_NO_STORE', 'The site has no store to swap through');
    let spare;
    if (body.spare_device_id) {
      spare = await tx.device.findFirst({ where: { id: body.spare_device_id, deletedAt: null, lifecycleState: { in: ['in_client_stock', 'in_company_stock', 'in_platform_stock'] } } });
      if (!spare) throw unprocessable('SPARE_NOT_AVAILABLE', 'That device is not in stock');
    } else {
      spare = await findSpare(tx, r.faultyDevice, r.issue.clientId, r.issue.companyId);
      if (!spare) throw conflict('NO_SPARE_AVAILABLE', 'No unit of this model is in stock at the site, the customer store or the warehouse. Order one or pick a spare by hand.');
    }
    let transfer = null;
    if (spare.currentLocationId === siteStore.id) {
      await changeDeviceState(tx, spare.id, { toState: 'reserved', eventType: 'allocated', referenceType: 'replacement_request', referenceId: r.id, actorUserId: actor.userId, notes: `Spare for ${r.faultyDevice.code}` });
    } else {
      transfer = await createTransfer({ all: true, coversHolder: () => true }, actor, {
        transfer_type: 'replacement_dispatch', from_location_id: spare.currentLocationId, to_location_id: siteStore.id, device_ids: [spare.id],
        notes: `Spare for ${r.faultyDevice.code} (${r.issue.issueNumber})`,
      }, { tx });
      // The replacement approval is the transfer's approval.
      transfer = await tx.stockTransfer.update({ where: { id: transfer.id }, data: { status: 'approved', approvedByUserId: actor.userId, approvedAt: new Date(), version: { increment: 1 } } });
    }
    const reviewer = await legacyUserFor(actor.userId);
    await tx.replacementRequest.update({
      where: { id },
      data: {
        status: 'approved', reviewedAt: new Date(), reviewedByUserId: reviewer, reviewedByFbosUserId: actor.userId, reviewNote: body.note ?? null,
        replacementDeviceId: spare.id, sourceLocationId: spare.currentLocationId, stockTransferId: transfer?.id ?? null,
        spareDeviceId: spare.id, spareDeviceCode: spare.code, spareDeviceName: spare.name,
      },
    });
    if (r.requestedByFbosUserId) {
      await enqueueNotification(tx, {
        eventType: 'replacement.approved', aggregateType: 'replacement_request', aggregateId: id,
        notify: {
          title: `Replacement approved for ${r.faultyDevice.code}`,
          body: transfer ? `Spare ${spare.code} is coming on ${transfer.transferNumber}.` : `Spare ${spare.code} is in the site store.`,
          action_url: `/inventory/issues/${r.issue.id}`,
          recipient_user_ids: [r.requestedByFbosUserId],
        },
      });
    }
    return tx.replacementRequest.findUnique({ where: { id }, include: replacementInclude });
  }, TX);
}

export async function rejectReplacement(access, actor, id, note) {
  return withTx(async (tx) => {
    const r = await replacementInScope(tx, access, id);
    if (r.status !== 'pending') throw conflict('INVALID_REPLACEMENT_STATUS', `A ${r.status} replacement cannot be rejected`);
    const reviewer = await legacyUserFor(actor.userId);
    await tx.replacementRequest.update({ where: { id }, data: { status: 'rejected', reviewedAt: new Date(), reviewedByUserId: reviewer, reviewedByFbosUserId: actor.userId, reviewNote: note ?? null } });
    if (r.faultyDevice.lifecycleState === 'pending_replacement') {
      await changeDeviceState(tx, r.faultyDevice.id, { toState: 'faulty', eventType: 'status_changed', referenceType: 'replacement_request', referenceId: id, actorUserId: actor.userId, notes: `Replacement rejected${note ? `: ${note}` : ''}` });
    }
    return tx.replacementRequest.findUnique({ where: { id }, include: replacementInclude });
  }, TX);
}

const DISPOSITION_STATE = { return_to_stock: 'in_client_stock', to_repair: 'faulty', vendor_rma: 'faulty', scrap: 'retired' };

export async function completeReplacement(access, actor, id, body) {
  return withTx(async (tx) => {
    const r = await replacementInScope(tx, access, id);
    if (r.status !== 'approved') throw conflict('INVALID_REPLACEMENT_STATUS', 'Only an approved replacement can be completed');
    const siteStore = await tx.stockLocation.findFirst({ where: { locationType: 'client_store', clientId: r.issue.clientId } });
    const spare = await tx.device.findUnique({ where: { id: r.replacementDeviceId } });
    if (spare.currentLocationId !== siteStore.id || !['reserved', 'in_client_stock'].includes(spare.lifecycleState)) {
      throw conflict('SPARE_NOT_AT_SITE', `Spare ${spare.code} has not reached the site store yet${r.stockTransfer ? ` (${r.stockTransfer.transferNumber} is ${r.stockTransfer.status})` : ''}`);
    }
    const old = await tx.device.findUnique({ where: { id: r.faultyDeviceId }, include: { installations: { where: { status: 'active' } } } });
    const oldInstallation = old.installations[0];
    if (!oldInstallation) throw conflict('DEVICE_NOT_INSTALLED', 'The faulty unit is no longer in a zone');

    await changeDeviceState(tx, old.id, {
      toState: DISPOSITION_STATE[r.oldDeviceDisposition] ?? 'faulty',
      zoneId: null,
      locationId: siteStore.id,
      eventType: 'replaced',
      referenceType: 'replacement_request',
      referenceId: id,
      actorUserId: actor.userId,
      removalReason: `Replaced by ${spare.code}`,
      notes: `Replaced by ${spare.code}; ${r.oldDeviceDisposition?.replace(/_/g, ' ') ?? 'kept faulty'}`,
    });
    const { installation } = await changeDeviceState(tx, spare.id, {
      toState: 'installed',
      zoneId: oldInstallation.zoneId,
      eventType: 'installed',
      referenceType: 'installation',
      actorUserId: actor.userId,
      notes: `Replaces ${old.code}`,
      installation: {
        installationType: 'replacement',
        replacesInstallationId: oldInstallation.id,
        positionLabel: body.position_label ?? oldInstallation.positionLabel,
        installedByTechnicianId: access.technicianId ?? null,
      },
      data: spare.installDate ? {} : { installDate: new Date() },
    });
    await tx.replacementRequest.update({ where: { id }, data: { status: 'completed', completedAt: new Date(), newInstallationId: installation.id } });
    await reconcileDeviceStatus(tx, old.id);
    await reconcileDeviceStatus(tx, spare.id);
    if (!['resolved', 'closed'].includes(r.issue.status)) {
      await moveIssue(access, actor, r.issue.id, undefined, { to_status: 'resolved', resolution_type: 'replaced', notes: `Replaced ${old.code} with ${spare.code}` }, { tx });
    }
    return tx.replacementRequest.findUnique({ where: { id }, include: replacementInclude });
  }, TX);
}
