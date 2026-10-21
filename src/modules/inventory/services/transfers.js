import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { changeDeviceState } from '../domain/deviceState.js';
import { STOCK_STATES, stateAtLocation } from '../domain/lifecycle.js';
import { nextNumber, NUMBER_PREFIX } from '../domain/numbers.js';
import { InventoryError, conflict, notFound, unprocessable } from '../http/errors.js';
import { assertVersion } from '../http/request.js';
import { enqueueNotification } from './outbox.js';

/**
 * Stock transfers: the recorded hand-off between platform, customer and site
 * stores, and to/from repair and vendors (design doc §6 steps 4-6, rule 4).
 *
 *   draft ──approve──▶ approved ──dispatch──▶ dispatched ──receive──▶ received | partially_received
 *     └──────cancel──────┘
 *
 * Creating a transfer reserves its stock devices; dispatch puts them in transit
 * (no place); receive puts them at the destination with the destination's
 * custody and allocation. One open transfer per device is a DB constraint.
 */
const STORES = ['platform_warehouse', 'company_store', 'client_store'];
const ROUTES = {
  platform_to_company: [['platform_warehouse'], ['company_store']],
  company_to_client: [['company_store'], ['client_store']],
  client_to_client: [['client_store'], ['client_store']],
  return_to_company: [['client_store'], ['company_store']],
  return_to_platform: [['company_store', 'client_store'], ['platform_warehouse']],
  replacement_dispatch: [STORES, ['client_store']],
  to_repair: [STORES, ['service_center']],
  from_repair: [['service_center'], STORES],
  to_vendor_rma: [[...STORES, 'service_center'], ['vendor']],
  from_vendor_rma: [['vendor'], STORES],
};
// Devices a transfer may take: anything in stock, plus faulty units going for repair.
const MOVABLE = [...STOCK_STATES, 'faulty', 'pending_replacement', 'under_repair', 'at_vendor_rma'];

const org = () => env.FBOS_ORGANIZATION_ID ?? null;

export const transferInclude = {
  fromLocation: { select: { id: true, name: true, locationType: true, companyId: true, clientId: true } },
  toLocation: { select: { id: true, name: true, locationType: true, companyId: true, clientId: true } },
  items: {
    include: { device: { select: { id: true, code: true, name: true, serialNumber: true, lifecycleState: true } } },
    orderBy: { id: 'asc' },
  },
};

/** Who may see / act on a transfer: either end is a holder in the caller's scope. */
export function transferWhere(access) {
  if (access.all) return org() ? { organizationId: org() } : {};
  const holder = (side) => ({
    OR: [
      { [`${side}ClientId`]: { in: access.siteIds } },
      { [`${side}CompanyId`]: { in: access.companyIds } },
    ],
  });
  return { ...(org() ? { organizationId: org() } : {}), OR: [holder('from'), holder('to')] };
}

export async function transferInScope(tx, access, id) {
  const t = await tx.stockTransfer.findFirst({ where: { AND: [transferWhere(access), { id }] }, include: transferInclude });
  if (!t) throw notFound('stock transfer');
  return t;
}

const holderOf = (location) => ({ companyId: location.companyId, clientId: location.clientId });

/** A store end of a transfer must be one the caller holds (or the caller sees everything). */
function assertEnd(access, location, what) {
  if (access.all) return;
  if (!location.companyId && !location.clientId) {
    throw new InventoryError(403, 'TRANSFER_END_NOT_ALLOWED', `Only operator staff can move stock ${what} ${location.name}`);
  }
  if (!access.coversHolder(holderOf(location))) throw notFound('stock location');
}

export async function createTransfer(access, actor, body, { tx: outer } = {}) {
  const run = async (tx) => {
    const [from, to] = await Promise.all([
      tx.stockLocation.findFirst({ where: { id: body.from_location_id, isActive: true } }),
      tx.stockLocation.findFirst({ where: { id: body.to_location_id, isActive: true } }),
    ]);
    if (!from || !to) throw unprocessable('STOCK_LOCATION_NOT_FOUND', 'The source or destination does not exist');
    if (from.id === to.id) throw unprocessable('SAME_LOCATION', 'A transfer goes from one place to another');
    const [fromTypes, toTypes] = ROUTES[body.transfer_type];
    if (!fromTypes.includes(from.locationType) || !toTypes.includes(to.locationType)) {
      throw unprocessable('INVALID_TRANSFER_ROUTE', `A ${body.transfer_type.replace(/_/g, ' ')} transfer cannot go from a ${from.locationType.replace(/_/g, ' ')} to a ${to.locationType.replace(/_/g, ' ')}`);
    }
    if (body.transfer_type === 'company_to_client') {
      const site = await tx.client.findUnique({ where: { id: to.clientId }, select: { companyId: true } });
      if (site?.companyId !== from.companyId) throw unprocessable('SITE_OF_ANOTHER_CUSTOMER', 'A customer store sends stock only to its own sites');
    }
    assertEnd(access, from, 'out of');

    const ids = [...new Set(body.device_ids)];
    const devices = await tx.device.findMany({ where: { id: { in: ids }, deletedAt: null } });
    if (devices.length !== ids.length) throw unprocessable('DEVICE_NOT_FOUND', 'One of the devices does not exist');
    for (const d of devices) {
      if (d.currentLocationId !== from.id) {
        throw unprocessable('DEVICE_NOT_AT_SOURCE', `${d.code} is not at ${from.name}`, { device_id: d.id });
      }
      if (!MOVABLE.includes(d.lifecycleState)) {
        throw unprocessable('DEVICE_NOT_MOVABLE', `${d.code} is ${d.lifecycleState.replace(/_/g, ' ')} and cannot be transferred`, { device_id: d.id });
      }
    }

    const transfer = await tx.stockTransfer.create({
      data: {
        organizationId: org(),
        transferNumber: await nextNumber(tx, NUMBER_PREFIX.stockTransfer),
        transferType: body.transfer_type,
        fromLocationId: from.id,
        toLocationId: to.id,
        fromCompanyId: from.companyId,
        toCompanyId: to.companyId,
        fromClientId: from.clientId,
        toClientId: to.clientId,
        requestedByUserId: actor.userId,
        notes: body.notes ?? null,
      },
    });
    for (const d of devices) {
      // Unique (device, open) index: a device already on an open transfer fails here.
      try {
        await tx.stockTransferItem.create({ data: { stockTransferId: transfer.id, deviceId: d.id, conditionOut: d.condition ?? 'unknown' } });
      } catch (err) {
        if (err?.code === 'P2002') throw conflict('DEVICE_ON_OPEN_TRANSFER', `${d.code} is already on another open transfer`, { device_id: d.id });
        throw err;
      }
      if (STOCK_STATES.includes(d.lifecycleState) && d.lifecycleState !== 'reserved') {
        await changeDeviceState(tx, d.id, {
          toState: 'reserved',
          eventType: 'allocated',
          referenceType: 'stock_transfer',
          referenceId: transfer.id,
          actorUserId: actor.userId,
          notes: `Reserved for ${transfer.transferNumber} to ${to.name}`,
        });
      }
    }
    return tx.stockTransfer.findUnique({ where: { id: transfer.id }, include: transferInclude });
  };
  return outer ? run(outer) : prisma.$transaction(run, { timeout: 60_000 });
}

export async function approveTransfer(access, actor, id, version) {
  return prisma.$transaction(async (tx) => {
    const t = await transferInScope(tx, access, id);
    assertVersion(t, version);
    if (t.status !== 'draft') throw conflict('INVALID_TRANSFER_STATUS', `A ${t.status} transfer cannot be approved`, { status: t.status });
    return tx.stockTransfer.update({
      where: { id },
      data: { status: 'approved', approvedByUserId: actor.userId, approvedAt: new Date(), version: { increment: 1 } },
      include: transferInclude,
    });
  });
}

export async function dispatchTransfer(access, actor, id, version, body = {}, { tx: outer } = {}) {
  const run = async (tx) => {
    const t = await transferInScope(tx, access, id);
    assertVersion(t, version);
    if (t.status !== 'approved') throw conflict('INVALID_TRANSFER_STATUS', `A ${t.status} transfer cannot be dispatched; approve it first`, { status: t.status });
    assertEnd(access, t.fromLocation, 'out of');
    for (const item of t.items) {
      await tx.stockTransferItem.update({ where: { id: item.id }, data: { itemStatus: 'in_transit', ...(body.condition_out ? { conditionOut: body.condition_out } : {}) } });
      await changeDeviceState(tx, item.deviceId, {
        toState: 'in_transit',
        locationId: null,
        eventType: 'dispatched',
        referenceType: 'stock_transfer',
        referenceId: t.id,
        actorUserId: actor.userId,
        notes: `${t.transferNumber}: ${t.fromLocation.name} → ${t.toLocation.name}`,
      });
    }
    const updated = await tx.stockTransfer.update({
      where: { id },
      data: {
        status: 'dispatched',
        dispatchedByUserId: actor.userId,
        dispatchedAt: new Date(),
        challanNo: body.challan_no ?? t.challanNo,
        carrier: body.carrier ?? t.carrier,
        trackingNumber: body.tracking_number ?? t.trackingNumber,
        version: { increment: 1 },
      },
      include: transferInclude,
    });
    await notifyEnd(tx, t, 'to', {
      eventType: 'transfer.dispatched',
      title: `${t.items.length} device(s) on the way to ${t.toLocation.name}`,
      body: `${t.transferNumber} from ${t.fromLocation.name}${body.tracking_number ? `, tracking ${body.tracking_number}` : ''}. Check them in when they arrive.`,
    });
    return updated;
  };
  return outer ? run(outer) : prisma.$transaction(run, { timeout: 60_000 });
}

/**
 * `items`: [{ device_id, status: received | damaged | missing, condition_in? }]; devices
 * not listed are received in the condition they left. Missing units become `lost`.
 */
export async function receiveTransfer(access, actor, id, version, body = {}, { tx: outer } = {}) {
  const run = async (tx) => {
    const t = await transferInScope(tx, access, id);
    assertVersion(t, version);
    if (t.status !== 'dispatched') throw conflict('INVALID_TRANSFER_STATUS', `A ${t.status} transfer cannot be received`, { status: t.status });
    assertEnd(access, t.toLocation, 'into');

    const given = new Map((body.items ?? []).map((i) => [i.device_id, i]));
    for (const deviceId of given.keys()) {
      if (!t.items.some((i) => i.deviceId === deviceId)) throw unprocessable('DEVICE_NOT_ON_TRANSFER', 'A device is not on this transfer', { device_id: deviceId });
    }
    const arrivedState = stateAtLocation(t.toLocation.locationType);
    let missing = 0;
    for (const item of t.items) {
      const said = given.get(item.deviceId) ?? {};
      const outcome = said.status ?? 'received';
      const conditionIn = outcome === 'damaged' ? 'damaged' : said.condition_in ?? item.conditionOut ?? 'unknown';
      await tx.stockTransferItem.update({ where: { id: item.id }, data: { itemStatus: outcome, conditionIn: outcome === 'missing' ? null : conditionIn, notes: said.notes ?? null } });
      if (outcome === 'missing') {
        missing++;
        await changeDeviceState(tx, item.deviceId, {
          toState: 'lost', locationId: null, eventType: 'lost', referenceType: 'stock_transfer', referenceId: t.id, actorUserId: actor.userId,
          notes: `Did not arrive on ${t.transferNumber}`,
        });
        continue;
      }
      await changeDeviceState(tx, item.deviceId, {
        toState: arrivedState,
        locationId: t.toLocationId,
        companyId: t.toLocation.companyId ?? null,
        clientId: t.toLocation.clientId ?? null,
        eventType: 'transferred',
        referenceType: 'stock_transfer',
        referenceId: t.id,
        actorUserId: actor.userId,
        notes: `${t.transferNumber} received at ${t.toLocation.name}`,
        data: { condition: conditionIn, ...ownershipOnArrival(t) },
      });
      await moveAllocation(tx, item.deviceId, t);
    }
    const updated = await tx.stockTransfer.update({
      where: { id },
      data: {
        status: missing > 0 ? 'partially_received' : 'received',
        receivedByUserId: actor.userId,
        receivedAt: new Date(),
        version: { increment: 1 },
      },
      include: transferInclude,
    });
    if (t.requestedByUserId) {
      await enqueueNotification(tx, {
        eventType: 'transfer.received',
        aggregateType: 'stock_transfer',
        aggregateId: t.id,
        notify: {
          title: `${t.transferNumber} received at ${t.toLocation.name}`,
          body: missing ? `${missing} device(s) did not arrive and are marked lost.` : `All ${t.items.length} device(s) arrived.`,
          action_url: `/inventory/transfers/${t.id}`,
          urgency: missing ? 'high' : 'normal',
          recipient_user_ids: [t.requestedByUserId],
        },
      });
    }
    return updated;
  };
  return outer ? run(outer) : prisma.$transaction(run, { timeout: 60_000 });
}

export async function cancelTransfer(access, actor, id, version, reason) {
  return prisma.$transaction(async (tx) => {
    const t = await transferInScope(tx, access, id);
    assertVersion(t, version);
    if (!['draft', 'approved'].includes(t.status)) throw conflict('INVALID_TRANSFER_STATUS', `A ${t.status} transfer cannot be cancelled`, { status: t.status });
    const backState = stateAtLocation(t.fromLocation.locationType);
    for (const item of t.items) {
      await tx.stockTransferItem.update({ where: { id: item.id }, data: { itemStatus: 'cancelled' } });
      if (item.device.lifecycleState === 'reserved') {
        await changeDeviceState(tx, item.deviceId, {
          toState: backState, locationId: t.fromLocationId, eventType: 'released', referenceType: 'stock_transfer', referenceId: t.id, actorUserId: actor.userId,
          notes: `${t.transferNumber} cancelled${reason ? `: ${reason}` : ''}`,
        });
      }
    }
    return tx.stockTransfer.update({
      where: { id },
      data: { status: 'cancelled', notes: reason ? `${t.notes ? `${t.notes}\n` : ''}Cancelled: ${reason}` : t.notes, version: { increment: 1 } },
      include: transferInclude,
    });
  });
}

/** Ownership follows D3 (INVENTORY_DEFAULT_OWNERSHIP) when stock first reaches a customer. */
function ownershipOnArrival(t) {
  if (t.transferType !== 'platform_to_company') return {};
  if (env.INVENTORY_DEFAULT_OWNERSHIP === 'company_owned') return { ownershipType: 'company_owned', ownerCompanyId: t.toLocation.companyId };
  return { ownershipType: env.INVENTORY_DEFAULT_OWNERSHIP };
}

/** Custody history: release the active allocation and open one for the new holder. */
async function moveAllocation(tx, deviceId, t) {
  const now = new Date();
  await tx.deviceAllocation.updateMany({ where: { deviceId, releasedAt: null }, data: { releasedAt: now } });
  if (!t.toLocation.companyId && !t.toLocation.clientId) return;
  await tx.deviceAllocation.create({
    data: {
      organizationId: org(),
      deviceId,
      companyId: t.toLocation.companyId,
      clientId: t.toLocation.clientId,
      allocationType: 'custody',
      stockTransferId: t.id,
      allocatedAt: now,
    },
  });
}

/** Notify the people of the receiving (or sending) site / customer, via their org unit. */
async function notifyEnd(tx, t, side, { eventType, title, body }) {
  const location = side === 'to' ? t.toLocation : t.fromLocation;
  const unitIds = [];
  if (location.clientId) {
    const site = await tx.client.findUnique({ where: { id: location.clientId }, select: { fbosOrgUnitId: true } });
    if (site?.fbosOrgUnitId) unitIds.push(site.fbosOrgUnitId);
  } else if (location.companyId) {
    const company = await tx.company.findUnique({ where: { id: location.companyId }, select: { fbosOrgUnitId: true } });
    if (company?.fbosOrgUnitId) unitIds.push(company.fbosOrgUnitId);
  }
  await enqueueNotification(tx, {
    eventType,
    aggregateType: 'stock_transfer',
    aggregateId: t.id,
    notify: {
      title,
      body,
      action_url: `/inventory/transfers/${t.id}`,
      recipient_user_ids: [t.requestedByUserId, t.approvedByUserId].filter(Boolean),
      recipient_unit_ids: unitIds,
    },
  });
}
