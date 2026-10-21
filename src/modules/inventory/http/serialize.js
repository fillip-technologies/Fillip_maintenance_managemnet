/**
 * Wire shapes for /api/inventory/v1: snake_case like every FBOS service, money as
 * a decimal string with the currency, ids for records other services own.
 * Prices and costs are left out unless the caller holds `inventory.cost.read`
 * (customer staff never see what the operator paid).
 */

const iso = (d) => (d ? new Date(d).toISOString() : null);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const money = (amount, currency = 'INR') => (amount == null ? null : { amount: Number(amount).toFixed(2), currency });

export const COST_CODE = 'inventory.cost.read';
export const canSeeCost = (actor) => actor.has(COST_CODE);

export function customer(c) {
  return {
    id: c.id,
    name: c.name,
    code: c.companyCode ?? null,
    status: c.status,
    contact_name: c.contactName ?? null,
    contact_email: c.contactEmail ?? null,
    contact_phone: c.contactPhone ?? null,
    gst_number: c.gstNumber ?? null,
    address: c.address ?? null,
    fbos_customer_id: c.fbosCustomerId ?? null,
    org_unit_id: c.fbosOrgUnitId ?? null,
    ...(c._count ? { site_count: c._count.clients, device_count: c._count.devices } : {}),
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
  };
}

export function site(s) {
  return {
    id: s.id,
    customer_id: s.companyId,
    customer_name: s.company?.name ?? null,
    name: s.name,
    code: s.clientCode ?? null,
    type: s.type ?? null,
    facility_name: s.facilityName ?? null,
    location: s.location ?? null,
    contact_person: s.contactPerson ?? null,
    contact_phone: s.contactPhone ?? null,
    org_unit_id: s.fbosOrgUnitId ?? null,
    ...(s._count ? { zone_count: s._count.zones } : {}),
    created_at: iso(s.createdAt),
  };
}

export function zone(z) {
  return {
    id: z.id,
    site_id: z.clientId,
    parent_id: z.parentZoneId ?? null,
    name: z.name,
    status: z.status,
    ...(z._count ? { child_count: z._count.children, device_count: z._count.devices } : {}),
  };
}

export function deviceModel(m, actor) {
  return {
    id: m.id,
    name: m.name,
    manufacturer: m.manufacturer,
    model_number: m.modelNumber,
    category_id: m.categoryId ?? null,
    category_name: m.category?.name ?? null,
    product_type_id: m.productTypeId ?? null,
    default_warranty_months: m.defaultWarrantyMonths,
    default_unit_price: canSeeCost(actor) ? money(m.defaultUnitPrice) : undefined,
    tax_percent: m.taxPercent == null ? null : Number(m.taxPercent).toFixed(2),
    hsn_sac: m.hsnSac ?? null,
    stores_data: m.storesData,
    spec: m.specJson ?? null,
    is_active: m.isActive,
    ...(m._count ? { device_count: m._count.devices } : {}),
  };
}

export function vendor(v) {
  return {
    id: v.id,
    name: v.name,
    vendor_type: v.vendorType,
    contact_name: v.contactName ?? null,
    email: v.email ?? null,
    phone: v.phone ?? null,
    gst_number: v.gstNumber ?? null,
    address: v.address ?? null,
    is_active: v.isActive,
    created_at: iso(v.createdAt),
  };
}

export function stockLocation(l) {
  return {
    id: l.id,
    code: l.code,
    name: l.name,
    location_type: l.locationType,
    customer_id: l.companyId ?? null,
    site_id: l.clientId ?? null,
    vendor_id: l.vendorId ?? null,
    address: l.address ?? null,
    is_active: l.isActive,
    ...(l._count ? { device_count: l._count.devices } : {}),
  };
}

export function device(d, actor) {
  const active = d.installations?.[0];
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    serial_number: d.serialNumber ?? null,
    mac_address: d.macAddress ?? null,
    barcode: d.barcode ?? null,
    model: d.deviceModel ? { id: d.deviceModel.id, name: d.deviceModel.name, manufacturer: d.deviceModel.manufacturer } : null,
    category_name: d.category?.name ?? null,
    lifecycle_state: d.lifecycleState,
    health_status: d.healthStatus ?? null,
    condition: d.condition ?? null,
    ownership_type: d.ownershipType ?? null,
    owner_customer_id: d.ownerCompanyId ?? null,
    customer: d.company ? { id: d.company.id, name: d.company.name } : null,
    site: d.currentClient ? { id: d.currentClient.id, name: d.currentClient.name } : null,
    zone: d.zone ? { id: d.zone.id, name: d.zone.name } : null,
    location: d.currentLocation ? { id: d.currentLocation.id, name: d.currentLocation.name, location_type: d.currentLocation.locationType } : null,
    installation: active
      ? { id: active.id, installed_at: iso(active.installedAt), position_label: active.positionLabel ?? null, installation_type: active.installationType }
      : null,
    vendor_id: d.vendorId ?? null,
    warranty_end_date: day(d.warrantyEndDate),
    first_install_date: day(d.installDate),
    received_at: iso(d.receivedAt),
    repair_count: d.repairCount,
    unit_price: canSeeCost(actor) ? money(d.unitPrice) : undefined,
    purchase_date: day(d.purchaseDate),
    image_url: d.imageUrl || d.productType?.imageUrl || d.category?.imageUrl || null,
    spec: d.customSpec ?? null,
    version: d.version,
    created_at: iso(d.createdAt),
    updated_at: iso(d.updatedAt),
  };
}

export function lifecycleEvent(e) {
  return {
    id: e.id,
    event_type: e.eventType,
    from_state: e.fromState ?? null,
    to_state: e.toState ?? null,
    from_location_id: e.fromLocationId ?? null,
    to_location_id: e.toLocationId ?? null,
    from_zone_id: e.fromZoneId ?? null,
    to_zone_id: e.toZoneId ?? null,
    customer_id: e.companyId ?? null,
    site_id: e.clientId ?? null,
    reference_type: e.referenceType ?? null,
    reference_id: e.referenceId ?? null,
    actor_user_id: e.actorUserId ?? null,
    from_legacy_app: Boolean(e.legacyUserId),
    notes: e.notes ?? null,
    occurred_at: iso(e.occurredAt),
  };
}

export function installation(i) {
  return {
    id: i.id,
    device_id: i.deviceId,
    zone: i.zone ? { id: i.zone.id, name: i.zone.name } : { id: i.zoneId, name: null },
    site_id: i.clientId ?? null,
    status: i.status,
    installation_type: i.installationType,
    position_label: i.positionLabel ?? null,
    latitude: i.latitude == null ? null : Number(i.latitude),
    longitude: i.longitude == null ? null : Number(i.longitude),
    installed_at: iso(i.installedAt),
    installed_by_technician_id: i.installedByTechnicianId ?? null,
    installed_by_user_id: i.installedByUserId ?? null,
    replaces_installation_id: i.replacesInstallationId ?? null,
    removed_at: iso(i.removedAt),
    removal_reason: i.removalReason ?? null,
    work_unit_id: i.workUnitId ?? null,
    task_id: i.taskId ?? null,
    notes: i.notes ?? null,
  };
}

export function warranty(w) {
  return {
    id: w.id,
    device_id: w.deviceId,
    vendor_id: w.vendorId ?? null,
    warranty_type: w.warrantyType,
    coverage: w.coverage ?? null,
    start_basis: w.startBasis,
    start_date: day(w.startDate),
    end_date: day(w.endDate),
    status: w.status,
    contract_id: w.contractId ?? null,
    notes: w.notes ?? null,
  };
}

export function deviceDocument(d) {
  return {
    id: d.id,
    device_id: d.deviceId,
    doc_type: d.docType,
    document_id: d.documentId ?? null,
    file_url: d.fileUrl ?? null,
    title: d.title ?? null,
    uploaded_by_user_id: d.uploadedByUserId ?? null,
    created_at: iso(d.createdAt),
  };
}

export { iso, day, money };

export function purchaseOrder(po, actor) {
  const cost = canSeeCost(actor);
  return {
    id: po.id,
    po_number: po.poNumber,
    vendor: po.vendor ? { id: po.vendor.id, name: po.vendor.name } : { id: po.vendorId, name: null },
    status: po.status,
    order_date: day(po.orderDate),
    expected_date: day(po.expectedDate),
    currency: po.currency,
    subtotal: cost ? money(po.subtotal, po.currency) : undefined,
    tax_total: cost ? money(po.taxTotal, po.currency) : undefined,
    total_amount: cost ? money(po.totalAmount, po.currency) : undefined,
    notes: po.notes ?? null,
    items: (po.items ?? []).map((i) => ({
      id: i.id,
      device_model: i.deviceModel ? { id: i.deviceModel.id, name: i.deviceModel.name, manufacturer: i.deviceModel.manufacturer } : { id: i.deviceModelId },
      quantity_ordered: i.quantityOrdered,
      quantity_received: i.quantityReceived,
      unit_price: cost ? money(i.unitPrice, po.currency) : undefined,
      tax_percent: Number(i.taxPercent).toFixed(2),
      line_total: cost ? money(i.lineTotal, po.currency) : undefined,
    })),
    receipts: (po.receipts ?? []).map((r) => ({ id: r.id, grn_number: r.grnNumber, status: r.status, received_at: iso(r.receivedAt) })),
    created_by_user_id: po.createdByUserId ?? null,
    approved_by_user_id: po.approvedByUserId ?? null,
    approved_at: iso(po.approvedAt),
    version: po.version,
    created_at: iso(po.createdAt),
  };
}

export function goodsReceipt(g) {
  return {
    id: g.id,
    grn_number: g.grnNumber,
    purchase_order: g.purchaseOrder ? { id: g.purchaseOrder.id, po_number: g.purchaseOrder.poNumber, vendor: g.purchaseOrder.vendor } : { id: g.purchaseOrderId },
    receiving_location: g.receivingLocation
      ? { id: g.receivingLocation.id, name: g.receivingLocation.name, location_type: g.receivingLocation.locationType }
      : { id: g.receivingLocationId },
    status: g.status,
    vendor_invoice_no: g.vendorInvoiceNo ?? null,
    delivery_challan_no: g.deliveryChallanNo ?? null,
    received_at: iso(g.receivedAt),
    received_by_user_id: g.receivedByUserId ?? null,
    notes: g.notes ?? null,
    items: (g.items ?? []).map((i) => ({
      id: i.id,
      purchase_order_item_id: i.purchaseOrderItemId,
      quantity_received: i.quantityReceived,
      quantity_accepted: i.quantityAccepted,
      quantity_rejected: i.quantityRejected,
      rejection_reason: i.rejectionReason ?? null,
    })),
    devices: (g.devices ?? []).map((d) => ({ id: d.id, code: d.code, serial_number: d.serialNumber })),
  };
}

const end = (l) => (l ? { id: l.id, name: l.name, location_type: l.locationType, customer_id: l.companyId ?? null, site_id: l.clientId ?? null } : null);

export function stockTransfer(t) {
  return {
    id: t.id,
    transfer_number: t.transferNumber,
    transfer_type: t.transferType,
    status: t.status,
    from_location: end(t.fromLocation) ?? { id: t.fromLocationId },
    to_location: end(t.toLocation) ?? { id: t.toLocationId },
    challan_no: t.challanNo ?? null,
    carrier: t.carrier ?? null,
    tracking_number: t.trackingNumber ?? null,
    notes: t.notes ?? null,
    items: (t.items ?? []).map((i) => ({
      id: i.id,
      device: i.device ? { id: i.device.id, code: i.device.code, name: i.device.name, serial_number: i.device.serialNumber ?? null, lifecycle_state: i.device.lifecycleState } : { id: i.deviceId },
      item_status: i.itemStatus,
      condition_out: i.conditionOut ?? null,
      condition_in: i.conditionIn ?? null,
      notes: i.notes ?? null,
    })),
    ...(t._count ? { item_count: t._count.items } : {}),
    requested_by_user_id: t.requestedByUserId ?? null,
    approved_by_user_id: t.approvedByUserId ?? null,
    dispatched_by_user_id: t.dispatchedByUserId ?? null,
    received_by_user_id: t.receivedByUserId ?? null,
    approved_at: iso(t.approvedAt),
    dispatched_at: iso(t.dispatchedAt),
    received_at: iso(t.receivedAt),
    version: t.version,
    created_at: iso(t.createdAt),
  };
}
