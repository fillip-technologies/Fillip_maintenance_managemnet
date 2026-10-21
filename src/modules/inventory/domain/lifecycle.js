/**
 * The v2 device lifecycle (design doc §5, docs/03-device-lifecycle.md): the
 * states, the moves allowed between them, where a device sits in each state,
 * and how the legacy `devices.status` maps to and from it while both exist.
 * Pure functions only, so the rules are unit-testable without a database.
 */

export const STOCK_STATES = ['in_platform_stock', 'reserved', 'in_company_stock', 'in_client_stock'];
export const ZONE_STATES = ['installed', 'under_maintenance', 'faulty', 'pending_replacement'];
// Of those, the ones a device may also be in after it was pulled into a store (design doc §5).
export const ZONE_OR_STORE_STATES = ['faulty', 'pending_replacement'];
// Held at a stock location that is not a store tier (service centre, vendor, any store for retired).
export const AWAY_STATES = ['under_repair', 'at_vendor_rma', 'retired'];
export const PLACELESS_STATES = ['in_transit', 'lost', 'disposed'];

/** Allowed moves (docs/03 §1). `lost` is reachable from any state. */
export const TRANSITIONS = {
  in_platform_stock: ['reserved', 'in_transit', 'retired'],
  // A spare reserved for a swap at its own site goes straight into the zone.
  reserved: ['in_platform_stock', 'in_company_stock', 'in_client_stock', 'in_transit', 'installed'],
  in_transit: ['in_platform_stock', 'in_company_stock', 'in_client_stock', 'under_repair', 'at_vendor_rma', 'reserved'],
  in_company_stock: ['in_transit', 'in_client_stock', 'reserved', 'retired'],
  in_client_stock: ['installed', 'in_transit', 'reserved', 'retired'],
  installed: ['under_maintenance', 'faulty', 'in_client_stock', 'pending_replacement'],
  under_maintenance: ['installed', 'faulty'],
  faulty: ['pending_replacement', 'under_repair', 'retired', 'installed', 'in_client_stock', 'in_transit'],
  pending_replacement: ['faulty', 'under_repair', 'at_vendor_rma', 'retired', 'in_client_stock', 'in_transit'],
  under_repair: ['in_client_stock', 'in_company_stock', 'in_platform_stock', 'retired', 'in_transit'],
  at_vendor_rma: ['in_client_stock', 'in_company_stock', 'in_platform_stock', 'retired', 'in_transit'],
  retired: ['disposed'],
  lost: ['disposed'],
  disposed: [],
};

export function canTransition(from, to) {
  if (from === to) return true;
  if (to === 'lost') return from !== 'disposed';
  if (from == null) return true; // first state ever recorded
  return (TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Single place rule (design doc §8 rule 1): a device is either in a zone or at a
 * stock location, never both. In transit, lost and disposed have no fixed place.
 * Returns an error message, or null when the placement is valid.
 */
export function placementError(state, { zoneId, locationId }) {
  if (ZONE_OR_STORE_STATES.includes(state)) {
    if (zoneId && locationId) return `A ${state} device is in a zone or at a stock location, not both`;
    if (!zoneId && !locationId) return `A ${state} device must be in a zone or at a stock location`;
    return null;
  }
  if (ZONE_STATES.includes(state)) {
    if (!zoneId) return `A ${state} device must be in a zone`;
    if (locationId) return `A ${state} device cannot also sit at a stock location`;
    return null;
  }
  if (STOCK_STATES.includes(state) || AWAY_STATES.includes(state)) {
    if (zoneId) return `A ${state} device cannot be in a zone`;
    if (!locationId) return `A ${state} device must be at a stock location`;
    return null;
  }
  if (PLACELESS_STATES.includes(state)) {
    if (zoneId || locationId) return `A ${state} device has no fixed place`;
    return null;
  }
  return `Unknown lifecycle state ${state}`;
}

/**
 * Legacy `status` (+ whether a zone is set) → v2 state (design doc §5 mapping).
 * `current` is the device's v2 state: states the legacy apps cannot express
 * (in transit, at a vendor, pending replacement…) are kept when the legacy
 * columns are still consistent with them.
 */
export function lifecycleFromLegacy({ status, zoneId, current, hasClient }) {
  if (status === 'retired') {
    return current === 'disposed' || current === 'lost' ? current : 'retired';
  }
  if (zoneId) {
    // A fault confirmed through the v2 API stays while the legacy status only says
    // someone is working on it (reconcileDeviceStatus derives that from open issues).
    if (['faulty', 'pending_replacement'].includes(current) && ['under_maintenance', 'faulty'].includes(status)) return current;
    if (status === 'under_maintenance') return 'under_maintenance';
    if (status === 'faulty') return 'faulty';
    return 'installed'; // active, provisioned with a zone
  }
  // No zone: in some store, or away (transit, repair, RMA) under the v2 API.
  if (current && (STOCK_STATES.includes(current) || ['in_transit', 'under_repair', 'at_vendor_rma', 'lost'].includes(current))) {
    return current;
  }
  // Legacy "in stock" means held by the company, not deployed (Device model comment).
  return hasClient ? 'in_client_stock' : 'in_company_stock';
}

/** v2 state → the legacy `status` the v1 apps should see. */
export function legacyStatusFor(state) {
  switch (state) {
    case 'installed':
      return 'active';
    case 'under_maintenance':
      return 'under_maintenance';
    case 'faulty':
    case 'pending_replacement':
      return 'faulty';
    case 'retired':
    case 'disposed':
    case 'lost':
      return 'retired';
    default:
      return 'provisioned'; // stock, transit, repair: "not deployed" to the v1 apps
  }
}

/** The state a device is in while it sits at a location of this type. */
export function stateAtLocation(locationType) {
  switch (locationType) {
    case 'platform_warehouse':
      return 'in_platform_stock';
    case 'company_store':
      return 'in_company_stock';
    case 'client_store':
      return 'in_client_stock';
    case 'service_center':
      return 'under_repair';
    case 'vendor':
      return 'at_vendor_rma';
    case 'disposal':
      return 'retired';
    default:
      return null;
  }
}
