import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/ApiError.js';
import {
  ZONE_STATES,
  ZONE_OR_STORE_STATES,
  STOCK_STATES,
  canTransition,
  placementError,
  lifecycleFromLegacy,
  legacyStatusFor,
} from './lifecycle.js';

/**
 * The one place that changes where a device is, what state it is in and who
 * holds it. Both APIs go through here so the legacy columns (`status`, `zoneId`,
 * `companyId`) and the v2 columns (`lifecycleState`, `currentLocationId`,
 * `currentClientId`, installations) never drift, and every change writes one
 * `device_lifecycle_events` row in the same transaction (design doc §8 rule 5).
 *
 * Every function takes a Prisma transaction client (`tx`).
 */

const DEVICE_PLACE = {
  id: true,
  status: true,
  zoneId: true,
  companyId: true,
  organizationId: true,
  lifecycleState: true,
  currentClientId: true,
  currentLocationId: true,
  ownershipType: true,
  ownerCompanyId: true,
  version: true,
  zone: { select: { clientId: true } },
};

/** Append one row to the device's history. Never updated or deleted afterwards. */
export function recordLifecycleEvent(tx, event) {
  return tx.deviceLifecycleEvent.create({
    data: { organizationId: env.FBOS_ORGANIZATION_ID ?? null, ...event },
  });
}

/** The store a holder keeps its stock in: the site's store, else the company's. */
export async function storeLocationFor(tx, { companyId, clientId }) {
  if (clientId) {
    const site = await tx.stockLocation.findFirst({ where: { locationType: 'client_store', clientId }, select: { id: true } });
    if (site) return site.id;
  }
  if (companyId) {
    const company = await tx.stockLocation.findFirst({
      where: { locationType: 'company_store', companyId },
      select: { id: true },
    });
    if (company) return company.id;
  }
  return null;
}

/**
 * Close the active installation (if any) and, when given a zone, open a new one.
 * Returns { installation, moved, fromZoneId }: whether anything changed, and the zone it left.
 */
async function moveInstallation(tx, device, { zoneId, clientId, userId, legacyUserId, reason, installationType, extra }) {
  const active = await tx.deviceInstallation.findFirst({
    where: { deviceId: device.id, status: 'active' },
    select: { id: true, zoneId: true },
  });
  if (active && active.zoneId === zoneId) return { installation: active, moved: false, fromZoneId: active.zoneId };
  if (!active && !zoneId) return { installation: null, moved: false, fromZoneId: null };
  if (active) {
    await tx.deviceInstallation.update({
      where: { id: active.id },
      data: { status: 'removed', removedAt: new Date(), removedByUserId: userId ?? null, removalReason: reason ?? null },
    });
  }
  if (!zoneId) return { installation: null, moved: true, fromZoneId: active?.zoneId ?? null };
  const installation = await tx.deviceInstallation.create({
    data: {
      organizationId: device.organizationId ?? env.FBOS_ORGANIZATION_ID ?? null,
      deviceId: device.id,
      zoneId,
      clientId,
      installationType: installationType ?? (active ? 'relocation' : 'new_install'),
      installedByUserId: userId ?? null,
      notes: legacyUserId ? 'Recorded from the legacy Fixly app' : null,
      ...extra,
    },
  });
  return { installation, moved: true, fromZoneId: active?.zoneId ?? null };
}

/**
 * Called after a legacy (v1 API) write to a device: derive the v2 columns from
 * `status` / `zoneId`, keep installations in step and log what changed.
 * `context`: { legacyUserId, eventType, referenceType, referenceId, notes }.
 */
export async function syncFromLegacy(tx, deviceId, context = {}) {
  const device = await tx.device.findUnique({ where: { id: deviceId }, select: DEVICE_PLACE });
  if (!device) return null;

  const clientId = device.zoneId ? device.zone?.clientId ?? null : device.currentClientId;
  const state = lifecycleFromLegacy({
    status: device.status,
    zoneId: device.zoneId,
    current: device.lifecycleState,
    hasClient: Boolean(clientId),
  });

  let locationId = device.currentLocationId;
  if (ZONE_STATES.includes(state)) locationId = null;
  else if (STOCK_STATES.includes(state) && !locationId) {
    locationId = await storeLocationFor(tx, { companyId: device.companyId, clientId });
  }

  const { installation, moved, fromZoneId } = await moveInstallation(tx, device, {
    zoneId: ZONE_STATES.includes(state) ? device.zoneId : null,
    clientId,
    legacyUserId: context.legacyUserId,
    reason: device.zoneId ? 'Moved to another zone in the legacy Fixly app' : 'Removed from its zone in the legacy Fixly app',
  });

  const changed =
    moved ||
    state !== device.lifecycleState ||
    clientId !== device.currentClientId ||
    locationId !== device.currentLocationId;
  const defaults = {
    ...(device.organizationId ? {} : { organizationId: env.FBOS_ORGANIZATION_ID ?? null }),
    ...(device.ownershipType ? {} : { ownershipType: env.INVENTORY_DEFAULT_OWNERSHIP }),
    ...(device.ownerCompanyId || !device.companyId ? {} : { ownerCompanyId: device.companyId }),
  };
  if (!changed && Object.keys(defaults).length === 0) return { state, installation };

  await tx.device.update({
    where: { id: deviceId },
    data: {
      ...defaults,
      lifecycleState: state,
      currentClientId: clientId,
      currentLocationId: locationId,
      ...(changed ? { version: { increment: 1 } } : {}),
    },
  });
  if (changed) {
    await recordLifecycleEvent(tx, {
      deviceId,
      eventType: context.eventType ?? (device.lifecycleState ? 'status_changed' : 'registered'),
      fromState: device.lifecycleState,
      toState: state,
      fromLocationId: device.currentLocationId,
      toLocationId: locationId,
      fromZoneId,
      toZoneId: ZONE_STATES.includes(state) ? device.zoneId : null,
      companyId: device.companyId,
      clientId,
      referenceType: context.referenceType ?? null,
      referenceId: context.referenceId ?? null,
      legacyUserId: context.legacyUserId ?? null,
      notes: context.notes ?? null,
    });
  }
  return { state, installation };
}

/** syncFromLegacy for many devices (bulk import, bulk deploy). */
export async function syncManyFromLegacy(tx, deviceIds, context = {}) {
  for (const id of deviceIds) {
    await syncFromLegacy(tx, id, context);
  }
}

/**
 * The v2 API's state change. Validates the move (state machine + single place
 * rule), writes the new place to both the v2 and the legacy columns, moves the
 * installation when the zone changes, and logs the event.
 *
 * `change`: { toState, zoneId?, locationId?, companyId?, clientId?, eventType,
 *             actorUserId?, referenceType?, referenceId?, notes?, data?,
 *             installation?: { installationType, ...columns } }
 * `zoneId` / `locationId` / `companyId` / `clientId` default to the device's
 * current values; pass null explicitly to clear one.
 */
export async function changeDeviceState(tx, deviceId, change) {
  const device = await tx.device.findUnique({ where: { id: deviceId }, select: DEVICE_PLACE });
  if (!device) throw ApiError.notFound('Device not found', 'DEVICE_NOT_FOUND');

  const from = device.lifecycleState;
  const to = change.toState;
  if (!canTransition(from, to)) {
    throw new ApiError(422, `A device cannot go from ${from} to ${to}`, {
      code: 'INVALID_LIFECYCLE_TRANSITION',
      details: { device_id: deviceId, from, to },
    });
  }

  const pick = (key, current) => (Object.prototype.hasOwnProperty.call(change, key) ? change[key] : current);
  const zoneId = ZONE_STATES.includes(to) ? pick('zoneId', device.zoneId) : null;
  // A faulty unit still in its zone has no store; pulled into a store it has no zone.
  const locationId = ZONE_STATES.includes(to) && (zoneId || !ZONE_OR_STORE_STATES.includes(to))
    ? null
    : pick('locationId', device.currentLocationId);
  const companyId = pick('companyId', device.companyId);
  let clientId = pick('clientId', device.currentClientId);
  if (zoneId && !Object.prototype.hasOwnProperty.call(change, 'clientId')) {
    const zone = await tx.zone.findUnique({ where: { id: zoneId }, select: { clientId: true } });
    clientId = zone?.clientId ?? clientId;
  }

  const placeError = placementError(to, { zoneId, locationId });
  if (placeError) {
    throw new ApiError(422, placeError, { code: 'INVALID_DEVICE_PLACEMENT', details: { device_id: deviceId, state: to } });
  }

  let installation = null;
  if (zoneId !== device.zoneId || !zoneId) {
    ({ installation } = await moveInstallation(tx, device, {
      zoneId,
      clientId,
      userId: change.actorUserId,
      reason: change.removalReason ?? change.notes ?? null,
      installationType: change.installation?.installationType,
      extra: change.installation ? omit(change.installation, ['installationType']) : undefined,
    }));
  }

  const updated = await tx.device.update({
    where: { id: deviceId },
    data: {
      lifecycleState: to,
      status: legacyStatusFor(to),
      zoneId,
      currentLocationId: locationId,
      companyId,
      currentClientId: clientId,
      version: { increment: 1 },
      ...(change.data ?? {}),
    },
  });

  await recordLifecycleEvent(tx, {
    deviceId,
    eventType: change.eventType,
    fromState: from,
    toState: to,
    fromLocationId: device.currentLocationId,
    toLocationId: locationId,
    fromZoneId: device.zoneId,
    toZoneId: zoneId,
    companyId,
    clientId,
    referenceType: change.referenceType ?? null,
    // An install's event points at the installation it just opened.
    referenceId: change.referenceId ?? (change.referenceType === 'installation' ? installation?.id ?? null : null),
    actorUserId: change.actorUserId ?? null,
    notes: change.notes ?? null,
  });

  return { device: updated, installation };
}

function omit(obj, keys) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}
