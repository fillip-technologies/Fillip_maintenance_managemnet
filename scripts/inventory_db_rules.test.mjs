// Integrity rules that live in the database or in deviceState.js, checked
// against the local throwaway DB (DATABASE_URL must name a `test_*` database on
// localhost). Each test runs in a transaction that is rolled back.
import 'dotenv/config';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.DATABASE_URL ?? '';
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) && /\/test_[^/?]*/.test(url);
const { prisma } = local ? await import('../src/lib/prisma.js') : { prisma: null };
const { syncFromLegacy, changeDeviceState } = await import('../src/modules/inventory/domain/deviceState.js');

class Rollback extends Error {}
async function inRollback(fn) {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    }, { timeout: 30_000 });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}
const isUniqueViolation = (err) => err?.code === 'P2002';
const t = local ? test : test.skip;
after(() => prisma?.$disconnect());

async function installedDevice(tx) {
  return tx.device.findFirst({
    where: { zoneId: { not: null }, lifecycleState: 'installed' },
    include: { installations: { where: { status: 'active' } } },
  });
}

t('one active installation per device (generated unique column)', async () => {
  await inRollback(async (tx) => {
    const d = await installedDevice(tx);
    assert.equal(d.installations.length, 1);
    await assert.rejects(
      tx.deviceInstallation.create({ data: { deviceId: d.id, zoneId: d.zoneId } }),
      isUniqueViolation,
    );
    // A removed installation frees the slot.
    await tx.deviceInstallation.update({ where: { id: d.installations[0].id }, data: { status: 'removed' } });
    await tx.deviceInstallation.create({ data: { deviceId: d.id, zoneId: d.zoneId } });
  });
});

t('one open transfer per device', async () => {
  await inRollback(async (tx) => {
    const d = await installedDevice(tx);
    const [from, to] = await tx.stockLocation.findMany({ take: 2 });
    const transfer = (n) => tx.stockTransfer.create({
      data: { transferNumber: `TEST-${n}-${Date.now()}`, transferType: 'company_to_client', fromLocationId: from.id, toLocationId: to.id },
    });
    const t1 = await transfer(1);
    const t2 = await transfer(2);
    const item = await tx.stockTransferItem.create({ data: { stockTransferId: t1.id, deviceId: d.id } });
    await assert.rejects(tx.stockTransferItem.create({ data: { stockTransferId: t2.id, deviceId: d.id } }), isUniqueViolation);
    await tx.stockTransferItem.update({ where: { id: item.id }, data: { itemStatus: 'received' } });
    await tx.stockTransferItem.create({ data: { stockTransferId: t2.id, deviceId: d.id } });
  });
});

t('one active allocation per device', async () => {
  await inRollback(async (tx) => {
    const d = await installedDevice(tx);
    const a = await tx.deviceAllocation.create({ data: { deviceId: d.id, companyId: d.companyId } });
    await assert.rejects(tx.deviceAllocation.create({ data: { deviceId: d.id, companyId: d.companyId } }), isUniqueViolation);
    await tx.deviceAllocation.update({ where: { id: a.id }, data: { releasedAt: new Date() } });
    await tx.deviceAllocation.create({ data: { deviceId: d.id, companyId: d.companyId } });
  });
});

t('a device with issues cannot be hard-deleted', async () => {
  await inRollback(async (tx) => {
    const issue = await tx.issue.findFirst({ select: { deviceId: true } });
    await assert.rejects(tx.device.delete({ where: { id: issue.deviceId } }), (err) => err?.code === 'P2003');
  });
});

t('a legacy zone move closes the old installation, opens a new one and logs it', async () => {
  await inRollback(async (tx) => {
    const d = await installedDevice(tx);
    const other = await tx.zone.findFirst({ where: { id: { not: d.zoneId }, children: { none: {} } } });
    const eventsBefore = await tx.deviceLifecycleEvent.count({ where: { deviceId: d.id } });
    await tx.device.update({ where: { id: d.id }, data: { zoneId: other.id } });
    await syncFromLegacy(tx, d.id, { eventType: 'relocated' });

    const installs = await tx.deviceInstallation.findMany({ where: { deviceId: d.id }, orderBy: { installedAt: 'asc' } });
    assert.deepEqual(installs.map((i) => i.status).sort(), ['active', 'removed']);
    assert.equal(installs.find((i) => i.status === 'active').zoneId, other.id);
    const after = await tx.device.findUnique({ where: { id: d.id } });
    assert.equal(after.currentClientId, other.clientId);
    assert.equal(after.version, d.version + 1);
    assert.equal(await tx.deviceLifecycleEvent.count({ where: { deviceId: d.id } }), eventsBefore + 1);
  });
});

t('a legacy status change to retired moves the device out of its zone in v2 terms', async () => {
  await inRollback(async (tx) => {
    const d = await installedDevice(tx);
    await syncFromLegacy(tx, d.id, { status: 'retired', eventType: 'retired' });
    const after = await tx.device.findUnique({ where: { id: d.id } });
    assert.equal(after.lifecycleState, 'retired');
    assert.equal(await tx.deviceInstallation.count({ where: { deviceId: d.id, status: 'active' } }), 0);
  });
});

t('a v2 state change refuses a move the state machine does not allow', async () => {
  await inRollback(async (tx) => {
    const d = await installedDevice(tx);
    await assert.rejects(
      changeDeviceState(tx, d.id, { toState: 'disposed', eventType: 'disposed' }),
      (err) => err.code === 'INVALID_LIFECYCLE_TRANSITION' && err.statusCode === 422,
    );
  });
});

t('a v2 move to site stock writes the legacy columns too', async () => {
  await inRollback(async (tx) => {
    const d = await installedDevice(tx);
    const store = await tx.stockLocation.findFirst({ where: { locationType: 'client_store', clientId: d.currentClientId } });
    await changeDeviceState(tx, d.id, { toState: 'in_client_stock', locationId: store.id, eventType: 'removed_from_zone' });
    const after = await tx.device.findUnique({ where: { id: d.id } });
    assert.equal(after.zoneId, null);
    assert.equal(after.status, 'provisioned');
    assert.equal(after.currentLocationId, store.id);
    assert.equal(await tx.deviceInstallation.count({ where: { deviceId: d.id, status: 'active' } }), 0);
  });
});
