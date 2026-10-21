import { withTx } from '../db.js';
import { prisma } from '../../../lib/prisma.js';
import { env } from '../../../config/env.js';
import { changeDeviceState } from '../domain/deviceState.js';
import { conflict, notFound, unprocessable } from '../http/errors.js';

/**
 * End of life (design doc §6 step 15, rule 10): a device is retired (out of
 * service, still somewhere), then a disposal is requested, approved and
 * completed. A model that stores data needs a wipe and its certificate first.
 */
const TX = { maxWait: 10_000, timeout: 30_000 };
const org = () => env.FBOS_ORGANIZATION_ID ?? null;
const RETIRABLE = ['in_platform_stock', 'in_company_stock', 'in_client_stock', 'faulty', 'pending_replacement', 'under_repair', 'at_vendor_rma'];

export const disposalInclude = { device: { select: { id: true, code: true, name: true, lifecycleState: true, deviceModel: { select: { name: true, storesData: true } } } } };

export async function retireDevice(access, actor, deviceId, reason) {
  const device = await prisma.device.findFirst({ where: { AND: [access.deviceWhere(), { id: deviceId, deletedAt: null }] } });
  if (!device) throw notFound('device');
  if (device.zoneId) throw conflict('DEVICE_STILL_INSTALLED', 'Take the device out of its zone first');
  if (!RETIRABLE.includes(device.lifecycleState)) throw conflict('DEVICE_NOT_RETIRABLE', `A ${device.lifecycleState.replace(/_/g, ' ')} device cannot be retired`);
  return withTx((tx) => changeDeviceState(tx, deviceId, { toState: 'retired', eventType: 'retired', actorUserId: actor.userId, notes: reason }), TX);
}

async function disposalFor(tx, id) {
  const d = await tx.deviceDisposal.findFirst({ where: { id, ...(org() ? { organizationId: org() } : {}) }, include: disposalInclude });
  if (!d) throw notFound('disposal');
  return d;
}

export async function requestDisposal(access, actor, body) {
  const device = await prisma.device.findFirst({ where: { AND: [access.deviceWhere(), { id: body.device_id, deletedAt: null }] } });
  if (!device) throw notFound('device');
  if (!['retired', 'lost'].includes(device.lifecycleState)) throw conflict('DEVICE_NOT_RETIRED', 'Retire the device before disposing of it');
  const open = await prisma.deviceDisposal.findFirst({ where: { deviceId: device.id, status: { in: ['pending', 'approved'] } } });
  if (open) throw conflict('DISPOSAL_ALREADY_REQUESTED', 'A disposal is already under way for this device', { disposal_id: open.id });
  return prisma.deviceDisposal.create({
    data: { organizationId: org(), deviceId: device.id, disposalMethod: body.disposal_method, reason: body.reason ?? null, requestedByUserId: actor.userId, notes: body.notes ?? null },
    include: disposalInclude,
  });
}

export async function decideDisposal(actor, id, approve, note) {
  return withTx(async (tx) => {
    const d = await disposalFor(tx, id);
    if (d.status !== 'pending') throw conflict('INVALID_DISPOSAL_STATUS', `A ${d.status} disposal cannot be decided`);
    return tx.deviceDisposal.update({
      where: { id },
      data: { status: approve ? 'approved' : 'rejected', approvedByUserId: actor.userId, approvedAt: new Date(), ...(note ? { notes: note } : {}) },
      include: disposalInclude,
    });
  }, TX);
}

export async function completeDisposal(actor, id, body) {
  return withTx(async (tx) => {
    const d = await disposalFor(tx, id);
    if (d.status !== 'approved') throw conflict('INVALID_DISPOSAL_STATUS', 'Only an approved disposal can be completed');
    if (d.device.deviceModel?.storesData && !(body.data_wiped && body.certificate_document_id)) {
      throw unprocessable('DATA_WIPE_REQUIRED', 'This device stores data: confirm the wipe and attach the certificate first');
    }
    await changeDeviceState(tx, d.deviceId, { toState: 'disposed', locationId: null, eventType: 'disposed', referenceType: 'disposal', referenceId: id, actorUserId: actor.userId, notes: d.disposalMethod });
    return tx.deviceDisposal.update({
      where: { id },
      data: {
        status: 'completed', dataWiped: Boolean(body.data_wiped), certificateDocumentId: body.certificate_document_id ?? null,
        recoveredValue: body.recovered_value ?? null, disposedAt: new Date(),
      },
      include: disposalInclude,
    });
  }, TX);
}
