import { withTx } from '../db.js';
import { prisma } from '../../../lib/prisma.js';
import { changeDeviceState } from '../domain/deviceState.js';
import { technicianFor } from '../auth/access.js';
import { conflict, notFound, unprocessable } from '../http/errors.js';
import { assertVersion } from '../http/request.js';
import { deviceInScope } from '../routes/devices.js';

/**
 * Installing a device from its site's store into a zone, and taking it out
 * again (design doc §6 step 7). The installation row is the placement history;
 * the device's zone, state and the legacy columns follow it.
 */
export async function installDevice(access, actor, body, version) {
  const device = await deviceInScope(access, body.device_id, {});
  assertVersion(device, version);
  const zone = await prisma.zone.findUnique({
    where: { id: body.zone_id },
    select: { id: true, clientId: true, status: true, client: { select: { companyId: true } }, _count: { select: { children: true } } },
  });
  if (!zone || !access.coversHolder({ companyId: zone.client.companyId, clientId: zone.clientId })) throw notFound('zone');
  if (zone._count.children > 0) throw unprocessable('ZONE_HAS_CHILDREN', 'Install into a zone without sub-zones');
  if (device.lifecycleState !== 'in_client_stock') {
    throw conflict('DEVICE_NOT_IN_SITE_STOCK', 'Only a device in a site store can be installed; move it to the site first', { lifecycle_state: device.lifecycleState });
  }
  if (device.currentClientId !== zone.clientId) {
    throw unprocessable('ZONE_OF_ANOTHER_SITE', 'The zone is at another site than the store the device is in');
  }
  const technicianId = body.installed_by_technician_id ?? access.technicianId ?? (await technicianFor(actor.userId));
  return withTx(async (tx) => {
    const { installation } = await changeDeviceState(tx, device.id, {
      toState: 'installed',
      zoneId: zone.id,
      clientId: zone.clientId,
      eventType: 'installed',
      actorUserId: actor.userId,
      referenceType: 'installation',
      notes: body.position_label ?? null,
      installation: {
        installationType: body.installation_type ?? 'new_install',
        positionLabel: body.position_label ?? null,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        installedByTechnicianId: technicianId,
        replacesInstallationId: body.replaces_installation_id ?? null,
        workUnitId: body.work_unit_id ?? null,
        taskId: body.task_id ?? null,
        photos: body.photos ?? undefined,
      },
      data: device.installDate ? {} : { installDate: new Date() },
    });
    return tx.deviceInstallation.findUnique({ where: { id: installation.id }, include: { zone: { select: { id: true, name: true } } } });
  });
}

/** Take an installed device out of its zone, into its site's store (or keep it faulty there). */
export async function removeInstallation(access, actor, installationId, body) {
  const inst = await prisma.deviceInstallation.findUnique({ where: { id: installationId } });
  if (!inst || inst.status !== 'active') throw notFound('installation');
  const device = await deviceInScope(access, inst.deviceId, {});
  const store = await prisma.stockLocation.findFirst({ where: { locationType: 'client_store', clientId: inst.clientId, isActive: true } });
  if (!store) throw unprocessable('SITE_HAS_NO_STORE', 'The site has no store to take the device back into');
  const keepsFault = ['faulty', 'pending_replacement'].includes(device.lifecycleState);
  return withTx(async (tx) => {
    await changeDeviceState(tx, device.id, {
      toState: keepsFault ? device.lifecycleState : 'in_client_stock',
      zoneId: null,
      locationId: store.id,
      eventType: 'removed_from_zone',
      actorUserId: actor.userId,
      referenceType: 'installation',
      referenceId: inst.id,
      removalReason: body.reason,
      notes: body.reason,
    });
    return tx.deviceInstallation.findUnique({ where: { id: inst.id }, include: { zone: { select: { id: true, name: true } } } });
  });
}
