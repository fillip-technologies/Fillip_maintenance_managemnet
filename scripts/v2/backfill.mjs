#!/usr/bin/env node
/**
 * Fixly v2 backfill (design doc §9 steps 2-9, development plan Phase 1 step 3).
 * Fills the v2 tables and columns from the live v1 data. Every step is
 * idempotent: it only writes rows or columns that are still missing, so it can
 * be re-run after a partial failure or after new legacy data arrives.
 *
 *   node scripts/v2/backfill.mjs --dry-run         # run everything, print counts, roll back
 *   node scripts/v2/backfill.mjs                    # apply
 *   node scripts/v2/backfill.mjs --only=04,05       # selected steps
 *
 * Refuses a non-local DATABASE_URL unless --remote is passed, so the rehearsal
 * on a throwaway local copy always comes first.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { lifecycleFromLegacy, ZONE_STATES } from '../../src/modules/inventory/domain/lifecycle.js';
import { nextNumber, NUMBER_PREFIX } from '../../src/modules/inventory/domain/numbers.js';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const only = [...args].find((a) => a.startsWith('--only='))?.slice(7).split(',');

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && !args.has('--remote')) {
  console.error('DATABASE_URL is not local. Rehearse on a local copy first, or pass --remote.');
  process.exit(1);
}

const ORG = process.env.FBOS_ORGANIZATION_ID || null;
const OWNERSHIP = process.env.INVENTORY_DEFAULT_OWNERSHIP || 'company_owned';
const prisma = new PrismaClient();
class DryRun extends Error {}

const shortId = (id) => id.replace(/-/g, '').slice(0, 8).toUpperCase();

const steps = {
  // 2. One platform warehouse, one store per company and per site, and the
  //    special places a device can be away at.
  async '01_seed_locations'(tx) {
    let created = 0;
    const ensure = async (where, data) => {
      if (await tx.stockLocation.findFirst({ where })) return;
      await tx.stockLocation.create({ data: { organizationId: ORG, ...data } });
      created++;
    };
    await ensure({ locationType: 'platform_warehouse' }, { code: 'PLATFORM-WH', name: 'Platform warehouse', locationType: 'platform_warehouse' });
    await ensure({ locationType: 'in_transit' }, { code: 'IN-TRANSIT', name: 'In transit', locationType: 'in_transit' });
    await ensure({ locationType: 'service_center', vendorId: null }, { code: 'SERVICE-CENTRE', name: 'In-house service centre', locationType: 'service_center' });
    await ensure({ locationType: 'disposal' }, { code: 'DISPOSAL', name: 'Disposal', locationType: 'disposal' });
    for (const c of await tx.company.findMany({ select: { id: true, name: true } })) {
      await ensure({ locationType: 'company_store', companyId: c.id }, { code: `CS-${shortId(c.id)}`, name: `${c.name} store`, locationType: 'company_store', companyId: c.id });
    }
    for (const s of await tx.client.findMany({ select: { id: true, name: true, companyId: true } })) {
      await ensure({ locationType: 'client_store', clientId: s.id }, { code: `SS-${shortId(s.id)}`, name: `${s.name} site store`, locationType: 'client_store', companyId: s.companyId, clientId: s.id });
    }
    return { created };
  },

  // 3. A device model per distinct (category, product type). Manufacturer and
  //    model number are filled in by the team later.
  async '02_device_models'(tx) {
    const pairs = await tx.device.findMany({
      distinct: ['categoryId', 'productTypeId'],
      select: { categoryId: true, productTypeId: true, hardwareTypeId: true, category: { select: { name: true } }, productType: { select: { name: true } } },
    });
    let created = 0;
    for (const p of pairs) {
      const name = p.productType?.name ?? p.category?.name ?? 'Unclassified';
      const exists = await tx.deviceModel.findFirst({ where: { categoryId: p.categoryId, productTypeId: p.productTypeId } });
      if (exists) continue;
      await tx.deviceModel.create({
        data: {
          organizationId: ORG,
          categoryId: p.categoryId,
          productTypeId: p.productTypeId,
          hardwareTypeId: p.hardwareTypeId,
          name,
          manufacturer: 'Unknown',
          modelNumber: name,
          storesData: p.category?.name === 'Camera', // cameras may hold SD cards: wipe before disposal
        },
      });
      created++;
    }
    return { created };
  },

  // 7 (run early so later steps read clean data). The text 'null' in custom_spec → SQL NULL.
  async '03_clean_data'(tx) {
    const fixed = await tx.$executeRaw`UPDATE devices SET custom_spec = NULL WHERE custom_spec = 'null'`;
    return { customSpecNulled: fixed };
  },

  // 4. Model, site, lifecycle state, ownership on every device.
  async '04_devices'(tx) {
    const models = await tx.deviceModel.findMany({ select: { id: true, categoryId: true, productTypeId: true } });
    const modelFor = (d) => models.find((m) => m.categoryId === d.categoryId && m.productTypeId === d.productTypeId)?.id ?? null;
    const stores = await tx.stockLocation.findMany({ where: { locationType: { in: ['company_store', 'client_store'] } }, select: { id: true, locationType: true, companyId: true, clientId: true } });
    const devices = await tx.device.findMany({
      select: {
        id: true, status: true, zoneId: true, companyId: true, categoryId: true, productTypeId: true,
        deviceModelId: true, lifecycleState: true, currentClientId: true, currentLocationId: true,
        ownershipType: true, ownerCompanyId: true, organizationId: true, condition: true,
        zone: { select: { clientId: true } },
      },
    });
    const byState = {};
    let updated = 0;
    for (const d of devices) {
      const clientId = d.zone?.clientId ?? d.currentClientId ?? null;
      const state = d.lifecycleState ?? lifecycleFromLegacy({ status: d.status, zoneId: d.zoneId, current: null, hasClient: Boolean(clientId) });
      const store = ZONE_STATES.includes(state)
        ? null
        : stores.find((s) => (clientId ? s.clientId === clientId : s.locationType === 'company_store' && s.companyId === d.companyId))?.id ?? null;
      const data = {
        ...(d.deviceModelId ? {} : { deviceModelId: modelFor(d) }),
        ...(d.lifecycleState ? {} : { lifecycleState: state }),
        ...(d.currentClientId || !clientId ? {} : { currentClientId: clientId }),
        ...(d.currentLocationId || !store ? {} : { currentLocationId: store }),
        ...(d.ownershipType ? {} : { ownershipType: OWNERSHIP }),
        ...(d.ownerCompanyId || !d.companyId ? {} : { ownerCompanyId: d.companyId }),
        ...(d.organizationId || !ORG ? {} : { organizationId: ORG }),
        ...(d.condition ? {} : { condition: 'unknown' }),
      };
      byState[state] = (byState[state] ?? 0) + 1;
      if (Object.keys(data).length === 0) continue;
      await tx.device.update({ where: { id: d.id }, data });
      updated++;
    }
    return { updated, byState };
  },

  // 5. One active installation per device that sits in a zone.
  async '05_installations'(tx) {
    const devices = await tx.device.findMany({
      where: { zoneId: { not: null }, installations: { none: { status: 'active' } } },
      select: { id: true, zoneId: true, installDate: true, createdAt: true, addedById: true, organizationId: true, zone: { select: { clientId: true } } },
    });
    for (const d of devices) {
      await tx.deviceInstallation.create({
        data: {
          organizationId: d.organizationId ?? ORG,
          deviceId: d.id,
          zoneId: d.zoneId,
          clientId: d.zone?.clientId ?? null,
          installationType: 'imported_from_v1',
          installedAt: d.installDate ?? d.createdAt,
          notes: 'Imported from v1: installer unknown',
        },
      });
    }
    return { created: devices.length };
  },

  // 6. One imported_from_v1 event per device, so every device has a history.
  async '06_events'(tx) {
    const devices = await tx.device.findMany({
      where: { lifecycleEvents: { none: {} } },
      select: { id: true, createdAt: true, lifecycleState: true, zoneId: true, currentLocationId: true, companyId: true, currentClientId: true, organizationId: true, addedById: true },
    });
    for (const d of devices) {
      await tx.deviceLifecycleEvent.create({
        data: {
          organizationId: d.organizationId ?? ORG,
          deviceId: d.id,
          eventType: 'imported_from_v1',
          toState: d.lifecycleState,
          toZoneId: d.zoneId,
          toLocationId: d.currentLocationId,
          companyId: d.companyId,
          clientId: d.currentClientId,
          legacyUserId: d.addedById,
          notes: 'State at the v2 migration',
          occurredAt: d.createdAt,
        },
      });
    }
    return { created: devices.length };
  },

  // 8. Issues: where the device was, an issue number, warranty unknown.
  async '07_issues'(tx) {
    const issues = await tx.issue.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, createdAt: true, issueNumber: true, zoneId: true, warrantyStatus: true, installationId: true, organizationId: true, raisedVia: true,
        device: { select: { zoneId: true, companyId: true, zone: { select: { clientId: true } }, installations: { where: { status: 'active' }, select: { id: true } } } },
      },
    });
    let updated = 0;
    for (const i of issues) {
      const data = {
        ...(i.issueNumber ? {} : { issueNumber: await nextNumber(tx, NUMBER_PREFIX.issue, i.createdAt) }),
        ...(i.zoneId ? {} : { zoneId: i.device.zoneId, clientId: i.device.zone?.clientId ?? null, companyId: i.device.companyId }),
        ...(i.warrantyStatus ? {} : { warrantyStatus: 'unknown' }),
        ...(i.installationId || !i.device.installations[0] ? {} : { installationId: i.device.installations[0].id }),
        ...(i.organizationId || !ORG ? {} : { organizationId: ORG }),
        ...(i.raisedVia ? {} : { raisedVia: 'manual' }),
      };
      if (Object.keys(data).length === 0) continue;
      await tx.issue.update({ where: { id: i.id }, data });
      updated++;
    }
    return { updated };
  },

  // 9. Replacement requests point at the faulty device. Neither existing request
  //    has a spare, so replacement_device_id stays empty.
  async '08_replacements'(tx) {
    const rows = await tx.replacementRequest.findMany({
      where: { faultyDeviceId: null },
      select: { id: true, issue: { select: { deviceId: true } } },
    });
    for (const r of rows) {
      await tx.replacementRequest.update({ where: { id: r.id }, data: { faultyDeviceId: r.issue.deviceId, ...(ORG ? { organizationId: ORG } : {}) } });
    }
    return { updated: rows.length };
  },

  // The operating organization on customers and sites.
  async '09_organization'(tx) {
    if (!ORG) return { skipped: 'FBOS_ORGANIZATION_ID is not set' };
    const companies = await tx.company.updateMany({ where: { organizationId: null }, data: { organizationId: ORG } });
    const clients = await tx.client.updateMany({ where: { organizationId: null }, data: { organizationId: ORG } });
    const locations = await tx.stockLocation.updateMany({ where: { organizationId: null }, data: { organizationId: ORG } });
    const models = await tx.deviceModel.updateMany({ where: { organizationId: null }, data: { organizationId: ORG } });
    return { companies: companies.count, clients: clients.count, locations: locations.count, models: models.count };
  },

  // Reconcile: the counts the Phase 1 gate checks. Throws on a mismatch.
  async '10_reconcile'(tx) {
    const [devices, companies, sites, zones, noState, noModel, noEvent, zonedWithoutInstall, doublePlace] = await Promise.all([
      tx.device.count(),
      tx.company.count(),
      tx.client.count(),
      tx.zone.count(),
      tx.device.count({ where: { lifecycleState: null } }),
      tx.device.count({ where: { deviceModelId: null } }),
      tx.device.count({ where: { lifecycleEvents: { none: {} } } }),
      tx.device.count({ where: { zoneId: { not: null }, installations: { none: { status: 'active' } } } }),
      tx.device.count({ where: { zoneId: { not: null }, currentLocationId: { not: null } } }),
    ]);
    const problems = { noState, noModel, noEvent, zonedWithoutInstall, doublePlace };
    const counts = { devices, companies, sites, zones };
    if (Object.values(problems).some((n) => n > 0)) {
      throw new Error(`Reconcile failed: ${JSON.stringify({ counts, problems })}`);
    }
    return { counts, problems };
  },
};

async function main() {
  const selected = Object.keys(steps).filter((name) => !only || only.some((o) => name.startsWith(o)));
  console.log(`${dryRun ? 'DRY RUN' : 'APPLY'} on ${url.replace(/\/\/[^@]*@/, '//***@')}  org=${ORG ?? '(unset)'} ownership=${OWNERSHIP}`);
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const name of selected) {
          const result = await steps[name](tx);
          console.log(`  ${name}: ${JSON.stringify(result)}`);
        }
        if (dryRun) throw new DryRun();
      },
      { maxWait: 10_000, timeout: 300_000 },
    );
    console.log('Committed.');
  } catch (err) {
    if (err instanceof DryRun) {
      console.log('Rolled back (dry run).');
      return;
    }
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
