import { withTx } from '../db.js';
import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { changeDeviceState } from '../domain/deviceState.js';
import { warrantyFor } from '../domain/issues.js';
import { nextNumber, NUMBER_PREFIX } from '../domain/numbers.js';
import { conflict, notFound, unprocessable } from '../http/errors.js';
import { assertVersion } from '../http/request.js';
import { createTransfer, dispatchTransfer, receiveTransfer } from './transfers.js';
import { enqueueNotification } from './outbox.js';

/**
 * Repair orders: a device going out for repair or RMA and coming back (design
 * doc §6 step 13, rule 9). Out and back are real transfers, so the device is
 * in transit, then at the service centre / vendor, then back in stock as
 * refurbished with repair_count + 1, or retired when beyond repair.
 *
 *   requested ──approve──▶ approved ──dispatch──▶ sent ──close──▶ closed
 *        └──────────────cancel───────────────┘
 */
const TX = { maxWait: 10_000, timeout: 60_000 };
const org = () => env.FBOS_ORGANIZATION_ID ?? null;
const OPERATOR = { all: true, siteIds: [], companyIds: [], coversHolder: () => true, deviceWhere: () => ({}) };

export const repairInclude = {
  device: { select: { id: true, code: true, name: true, lifecycleState: true, currentLocationId: true } },
  issue: { select: { id: true, issueNumber: true } },
  vendor: { select: { id: true, name: true } },
  outboundTransfer: { select: { id: true, transferNumber: true, status: true } },
  returnTransfer: { select: { id: true, transferNumber: true, status: true } },
  parts: true,
};

async function repairFor(tx, id) {
  const ro = await tx.repairOrder.findFirst({ where: { id, ...(org() ? { organizationId: org() } : {}) }, include: repairInclude });
  if (!ro) throw notFound('repair order');
  return ro;
}

export async function createRepair(access, actor, body) {
  const device = await prisma.device.findFirst({ where: { AND: [access.deviceWhere(), { id: body.device_id, deletedAt: null }] } });
  if (!device) throw notFound('device');
  if (!['faulty', 'pending_replacement', 'in_client_stock', 'in_company_stock', 'in_platform_stock'].includes(device.lifecycleState)) {
    throw conflict('DEVICE_NOT_REPAIRABLE', `A ${device.lifecycleState.replace(/_/g, ' ')} device is not sent for repair`);
  }
  if (body.repair_type !== 'in_house' && !body.vendor_id) throw unprocessable('VENDOR_REQUIRED', 'Name the vendor or service centre the device goes to');
  return withTx(async (tx) => {
    const warranty = await warrantyFor(tx, device.id);
    if (body.is_warranty_claim && warranty.warrantyStatus !== 'in_warranty') {
      throw unprocessable('NOT_IN_WARRANTY', 'This device is not in warranty, so this cannot be a warranty claim');
    }
    const ro = await tx.repairOrder.create({
      data: {
        organizationId: org(),
        repairNumber: await nextNumber(tx, NUMBER_PREFIX.repairOrder),
        deviceId: device.id,
        issueId: body.issue_id ?? null,
        warrantyId: warranty.warrantyId,
        vendorId: body.vendor_id ?? null,
        repairType: body.repair_type,
        isWarrantyClaim: Boolean(body.is_warranty_claim),
        rmaNumber: body.rma_number ?? null,
        costEstimate: body.cost_estimate ?? null,
        costBorneBy: body.cost_borne_by ?? (body.is_warranty_claim ? 'vendor' : null),
        billable: Boolean(body.billable),
        requestedByUserId: actor.userId,
        notes: body.notes ?? null,
      },
    });
    return tx.repairOrder.findUnique({ where: { id: ro.id }, include: repairInclude });
  }, TX);
}

export async function approveRepair(actor, id, version) {
  return withTx(async (tx) => {
    const ro = await repairFor(tx, id);
    assertVersion(ro, version);
    if (ro.status !== 'requested') throw conflict('INVALID_REPAIR_STATUS', `A ${ro.status} repair order cannot be approved`);
    return tx.repairOrder.update({ where: { id }, data: { status: 'approved', approvedByUserId: actor.userId, approvedAt: new Date(), version: { increment: 1 } }, include: repairInclude });
  }, TX);
}

async function destinationFor(tx, ro) {
  if (ro.repairType === 'in_house') {
    const bench = await tx.stockLocation.findFirst({ where: { locationType: 'service_center', vendorId: null, isActive: true } });
    if (!bench) throw unprocessable('NO_SERVICE_CENTRE', 'Set up the in-house service centre location first');
    return bench;
  }
  const place = await tx.stockLocation.findFirst({ where: { vendorId: ro.vendorId, isActive: true } });
  if (!place) throw unprocessable('VENDOR_HAS_NO_LOCATION', 'The vendor has no location to send devices to');
  return place;
}

/** Out the door: a to_repair / to_vendor_rma transfer, approved and dispatched at once. */
export async function dispatchRepair(actor, id, version, body = {}) {
  return withTx(async (tx) => {
    const ro = await repairFor(tx, id);
    assertVersion(ro, version);
    if (ro.status !== 'approved') throw conflict('INVALID_REPAIR_STATUS', 'Approve the repair order before sending the device');
    if (!ro.device.currentLocationId) throw conflict('DEVICE_NOT_IN_A_STORE', 'Take the device out of its zone into a store before sending it');
    const destination = await destinationFor(tx, ro);
    const t = await createTransfer(OPERATOR, actor, {
      transfer_type: destination.locationType === 'vendor' ? 'to_vendor_rma' : 'to_repair',
      from_location_id: ro.device.currentLocationId,
      to_location_id: destination.id,
      device_ids: [ro.deviceId],
      notes: `${ro.repairNumber}${ro.rmaNumber ? ` · RMA ${ro.rmaNumber}` : ''}`,
    }, { tx });
    const approved = await tx.stockTransfer.update({ where: { id: t.id }, data: { status: 'approved', approvedByUserId: actor.userId, approvedAt: new Date(), version: { increment: 1 } } });
    await dispatchTransfer(OPERATOR, actor, t.id, approved.version, body, { tx });
    await tx.deviceLifecycleEvent.create({ data: { organizationId: org(), deviceId: ro.deviceId, eventType: ro.isWarrantyClaim ? 'warranty_claimed' : 'repair_sent', toState: 'in_transit', referenceType: 'repair_order', referenceId: ro.id, actorUserId: actor.userId, notes: `${ro.repairNumber} to ${destination.name}` } });
    return tx.repairOrder.update({ where: { id }, data: { status: 'sent', sentAt: new Date(), outboundTransferId: t.id, version: { increment: 1 } }, include: repairInclude });
  }, TX);
}

/** The service centre / vendor has the device (under_repair / at_vendor_rma). */
export async function markArrived(actor, id) {
  return withTx(async (tx) => {
    const ro = await repairFor(tx, id);
    if (ro.status !== 'sent' || ro.outboundTransfer?.status !== 'dispatched') throw conflict('INVALID_REPAIR_STATUS', 'The device is not on its way to repair');
    const t = await tx.stockTransfer.findUnique({ where: { id: ro.outboundTransferId } });
    await receiveTransfer(OPERATOR, actor, t.id, t.version, {}, { tx });
    return tx.repairOrder.findUnique({ where: { id }, include: repairInclude });
  }, TX);
}

/**
 * Close: `repaired` / `replaced_by_vendor` bring the device back to `return_location_id`
 * as refurbished (repair_count + 1); `beyond_repair` retires it where it is.
 */
export async function closeRepair(actor, id, version, body) {
  return withTx(async (tx) => {
    let ro = await repairFor(tx, id);
    assertVersion(ro, version);
    if (ro.status !== 'sent') throw conflict('INVALID_REPAIR_STATUS', 'Only a repair order that was sent can be closed');
    if (ro.outboundTransfer?.status === 'dispatched') {
      const out = await tx.stockTransfer.findUnique({ where: { id: ro.outboundTransferId } });
      await receiveTransfer(OPERATOR, actor, out.id, out.version, {}, { tx });
      ro = await repairFor(tx, id);
    }
    const device = await tx.device.findUnique({ where: { id: ro.deviceId } });
    let returnTransferId = null;
    if (body.outcome === 'beyond_repair') {
      await changeDeviceState(tx, device.id, { toState: 'retired', eventType: 'retired', referenceType: 'repair_order', referenceId: id, actorUserId: actor.userId, notes: `${ro.repairNumber}: beyond repair` });
    } else {
      const back = await tx.stockLocation.findFirst({ where: { id: body.return_location_id, isActive: true, locationType: { in: ['platform_warehouse', 'company_store', 'client_store'] } } });
      if (!back) throw unprocessable('INVALID_RETURN_LOCATION', 'Say which store the device comes back to');
      const fromVendor = device.lifecycleState === 'at_vendor_rma';
      const t = await createTransfer(OPERATOR, actor, {
        transfer_type: fromVendor ? 'from_vendor_rma' : 'from_repair',
        from_location_id: device.currentLocationId,
        to_location_id: back.id,
        device_ids: [device.id],
        notes: `${ro.repairNumber} back`,
      }, { tx });
      const approved = await tx.stockTransfer.update({ where: { id: t.id }, data: { status: 'approved', approvedByUserId: actor.userId, approvedAt: new Date(), version: { increment: 1 } } });
      const dispatched = await dispatchTransfer(OPERATOR, actor, t.id, approved.version, {}, { tx });
      await receiveTransfer(OPERATOR, actor, t.id, dispatched.version, { items: [{ device_id: device.id, status: 'received', condition_in: 'refurbished' }] }, { tx });
      await tx.device.update({ where: { id: device.id }, data: { repairCount: { increment: 1 } } });
      await tx.deviceLifecycleEvent.create({ data: { organizationId: org(), deviceId: device.id, eventType: 'repair_returned', referenceType: 'repair_order', referenceId: id, actorUserId: actor.userId, notes: `${ro.repairNumber}: ${body.outcome.replace(/_/g, ' ')} → ${back.name}` } });
      returnTransferId = t.id;
    }
    if (body.parts?.length) {
      await tx.repairPart.createMany({ data: body.parts.map((p) => ({ repairOrderId: id, partName: p.part_name, quantity: p.quantity ?? 1, unitCost: p.unit_cost ?? null, coveredByWarranty: Boolean(p.covered_by_warranty) })) });
    }
    const closed = await tx.repairOrder.update({
      where: { id },
      data: {
        status: 'closed', outcome: body.outcome, finalCost: body.final_cost ?? null, returnTransferId, returnLocationId: body.return_location_id ?? null,
        returnedAt: returnTransferId ? new Date() : null, closedAt: new Date(), version: { increment: 1 },
      },
      include: repairInclude,
    });
    if (ro.requestedByUserId) {
      await enqueueNotification(tx, {
        eventType: 'repair.returned', aggregateType: 'repair_order', aggregateId: id,
        notify: { title: `${ro.repairNumber} closed: ${body.outcome.replace(/_/g, ' ')}`, body: `${ro.device.code}`, action_url: `/inventory/repairs/${id}`, recipient_user_ids: [ro.requestedByUserId] },
      });
    }
    return closed;
  }, TX);
}

export async function cancelRepair(actor, id, version) {
  return withTx(async (tx) => {
    const ro = await repairFor(tx, id);
    assertVersion(ro, version);
    if (!['requested', 'approved'].includes(ro.status)) throw conflict('INVALID_REPAIR_STATUS', 'A repair order that was sent is closed, not cancelled');
    return tx.repairOrder.update({ where: { id }, data: { status: 'cancelled', closedAt: new Date(), version: { increment: 1 } }, include: repairInclude });
  }, TX);
}
