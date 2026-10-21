import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition,
  placementError,
  lifecycleFromLegacy,
  legacyStatusFor,
} from '../src/modules/inventory/domain/lifecycle.js';

// ---- v1 status → v2 state (design doc §5 mapping) ------------------------

test('v1 mapping: active / provisioned in a zone → installed', () => {
  assert.equal(lifecycleFromLegacy({ status: 'active', zoneId: 'z' }), 'installed');
  assert.equal(lifecycleFromLegacy({ status: 'provisioned', zoneId: 'z' }), 'installed');
});

test('v1 mapping: maintenance, faulty and retired carry over', () => {
  assert.equal(lifecycleFromLegacy({ status: 'under_maintenance', zoneId: 'z' }), 'under_maintenance');
  assert.equal(lifecycleFromLegacy({ status: 'faulty', zoneId: 'z' }), 'faulty');
  assert.equal(lifecycleFromLegacy({ status: 'retired', zoneId: null }), 'retired');
});

test('v1 mapping: no zone is company stock, or site stock when a site holds it', () => {
  assert.equal(lifecycleFromLegacy({ status: 'provisioned', zoneId: null, hasClient: false }), 'in_company_stock');
  assert.equal(lifecycleFromLegacy({ status: 'provisioned', zoneId: null, hasClient: true }), 'in_client_stock');
});

test('v1 writes keep v2-only states the legacy columns still agree with', () => {
  assert.equal(lifecycleFromLegacy({ status: 'provisioned', zoneId: null, current: 'at_vendor_rma' }), 'at_vendor_rma');
  assert.equal(lifecycleFromLegacy({ status: 'provisioned', zoneId: null, current: 'in_transit' }), 'in_transit');
  assert.equal(lifecycleFromLegacy({ status: 'faulty', zoneId: 'z', current: 'pending_replacement' }), 'pending_replacement');
  assert.equal(lifecycleFromLegacy({ status: 'retired', zoneId: null, current: 'disposed' }), 'disposed');
});

test('v2 state → legacy status the v1 apps understand', () => {
  assert.equal(legacyStatusFor('installed'), 'active');
  assert.equal(legacyStatusFor('pending_replacement'), 'faulty');
  assert.equal(legacyStatusFor('in_client_stock'), 'provisioned');
  assert.equal(legacyStatusFor('at_vendor_rma'), 'provisioned');
  assert.equal(legacyStatusFor('disposed'), 'retired');
});

// ---- state machine (docs/03 §1) ------------------------------------------

test('allowed moves', () => {
  assert.ok(canTransition('in_platform_stock', 'in_transit'));
  assert.ok(canTransition('in_transit', 'in_company_stock'));
  assert.ok(canTransition('in_client_stock', 'installed'));
  assert.ok(canTransition('faulty', 'under_repair'));
  assert.ok(canTransition('retired', 'disposed'));
  assert.ok(canTransition(null, 'in_platform_stock'));
});

test('refused moves', () => {
  assert.ok(!canTransition('in_platform_stock', 'installed'));
  assert.ok(!canTransition('disposed', 'installed'));
  assert.ok(!canTransition('installed', 'disposed'));
  assert.ok(!canTransition('disposed', 'lost'));
});

test('anything but disposed can be lost', () => {
  assert.ok(canTransition('installed', 'lost'));
  assert.ok(canTransition('in_transit', 'lost'));
});

// ---- single place rule (design doc §8 rule 1) ----------------------------

test('installed needs a zone and no stock location', () => {
  assert.equal(placementError('installed', { zoneId: 'z', locationId: null }), null);
  assert.match(placementError('installed', { zoneId: null, locationId: null }), /must be in a zone/);
  assert.match(placementError('installed', { zoneId: 'z', locationId: 'l' }), /cannot also sit/);
});

test('stock and repair states need a location and no zone', () => {
  assert.equal(placementError('in_client_stock', { zoneId: null, locationId: 'l' }), null);
  assert.equal(placementError('under_repair', { zoneId: null, locationId: 'l' }), null);
  assert.match(placementError('in_company_stock', { zoneId: 'z', locationId: 'l' }), /cannot be in a zone/);
});

test('in transit, lost and disposed have no place', () => {
  assert.equal(placementError('in_transit', { zoneId: null, locationId: null }), null);
  assert.match(placementError('disposed', { zoneId: null, locationId: 'l' }), /no fixed place/);
});
