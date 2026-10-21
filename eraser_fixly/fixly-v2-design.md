# Fixly v2 — Device Inventory & Lifecycle: ER Design and Documentation

> Local copy of the Eraser file "Fixly" (https://app.eraser.io/workspace/XBHGdC4VuBWkbhfkXjM2), copied 2026-10-14.
> Diagram sources are in `diagrams/` (Eraser DSL, paste back into Eraser to re-create).

**Source:** `u516064072_fixly.sql` (MariaDB 11.8 dump, Prisma-managed, exported 13 Oct 2026)
**Goal of v2:** track every physical device from **purchase order → platform stock → company stock → client stock → installed in a zone → fault → warranty / replacement / repair → back in stock or retired**, with who held it, where it was, and what happened, at every step.

---

## 1. What is in this file (canvas guide)

| # | Canvas | What it shows | Local file |
|---|---|---|---|
| 1 | **v1 ERD (as-is)** | The current database exactly as in the SQL dump (20 app tables + `_prisma_migrations`). | `diagrams/01-v1-erd-as-is.eraser` |
| 2 | **v2 Domain 1 — Organization & Access** | Companies, clients, zones, users, technicians. | `diagrams/02-v2-domain1-organization-access.eraser` |
| 3 | **v2 Domain 2 — Catalog, Procurement, Warranty** | Device models, vendors, purchase orders, goods receipts (GRN), warranties. | `diagrams/03-v2-domain2-catalog-procurement-warranty.eraser` |
| 4 | **v2 Domain 3 — Inventory, Transfers, Allocation** | Stock locations (3 tiers), stock transfers, who a device is given to. | `diagrams/04-v2-domain3-inventory-transfers.eraser` |
| 5 | **v2 Domain 4 — Device, Placement, Lifecycle log** | Device unit, installations, audit trail, documents, daily logs, disposal. | `diagrams/05-v2-domain4-device-lifecycle.eraser` |
| 6 | **v2 Domain 5 — Issues, Visits, Repair, Replacement** | Issue → technician visit → warranty claim → repair order / replacement. | `diagrams/06-v2-domain5-issues-repair.eraser` |
| 7 | **v2 Full overview ERD** | All 38 tables on one canvas, key columns only. | `diagrams/07-v2-full-overview.eraser` |
| 8 | **Flow: Device journey** | Order → install, across the 3 inventory tiers. | `diagrams/08-flow-device-journey.eraser` |
| 9 | **Flow: Fault handling** | Warranty vs paid, repair vs replace, return to stock or retire. | `diagrams/09-flow-fault-handling.eraser` |

> **Note added locally:** the full overview (canvas 7) actually defines 36 tables; `refresh_tokens` and `device_tokens` appear only in canvas 2, which makes the 38 quoted above.

Column comments in the v2 diagrams use `NEW` (new column or table) and `CHG` (changed from v1).

---

## 2. Audit of the v1 schema

### 2.1 What v1 does well

- Clean multi-tenant hierarchy: **Company → Client (site) → Zone (nested via `parent_zone_id`) → Device**.
- Good issue workflow base: `issues`, `issue_status_history` (with GPS), `issue_categories`, technicians and assignments.
- Flexible product catalog: `product_categories` (with auto-code sequence), `product_types`, `hardware_types.spec_fields` (JSON spec templates).
- Solid constraints: UUID keys, cascading FKs, unique `devices.code`, one daily log per device per day.

### 2.2 Data profile (from the dump)

| Item | Count |
|---|---|
| Companies / clients / zones | 5 / 4 / 227 |
| Devices | 445 (441 `active`, 4 `under_maintenance`) |
| Devices per company | Rajgir Zoo Safari 354, Nature Safari 50, Venuvan 41 |
| Device types | Bullet Camera 187, Dome Camera 177, PTZ Camera 71, TV 10 |
| Users | 9 (4 client_admin, 3 technician, 1 zone_staff, 1 super_admin) |
| Issues | 8 (7 open, 1 resolved; 6 high, 1 critical, 1 medium) |
| Replacement requests | 2 (1 pending, 1 approved) — **both with no spare device attached** |
| Daily status logs | 0 |

### 2.3 Gaps v2 closes

| # | Gap in v1 | Why it matters | v2 fix |
|---|---|---|---|
| 1 | No vendor, purchase order or goods receipt | Cannot answer "when did we order it, from whom, at what price" | `vendors`, `purchase_orders`, `purchase_order_items`, `goods_receipts`, `goods_receipt_items` |
| 2 | `devices` mixes _model_ and _physical unit_; no serial number | Cannot track one specific unit, cannot do RMA | `device_models` (SKU) + `devices` (one row per serial) |
| 3 | A device belongs to a company and a zone only. **No stock/inventory concept** | A device in a warehouse or spare store cannot be represented | `stock_locations` (platform / company / client tiers) |
| 4 | No movement records | No chain of custody between platform, company and client | `stock_transfers` + `stock_transfer_items` |
| 5 | No history of who the device was given to | Ownership vs custody unclear | `device_allocations`, `devices.owner_company_id` vs `current_company_id` |
| 6 | Placement is only `devices.zone_id` (overwritten on move) | Past placements and who installed are lost | `device_installations` |
| 7 | No warranty tracking | Cannot decide warranty vs paid repair | `warranties`, `issues.warranty_id / warranty_status` |
| 8 | No repair or RMA tracking | Device "goes away" and nobody knows where | `repair_orders`, `repair_parts` |
| 9 | `replacement_requests` stores spare as free text (`spare_device_id` has **no FK**, name/code copied) | Spare cannot be reliably located or tracked | Real FKs: `faulty_device_id`, `replacement_device_id`, plus transfer and installation links |
| 10 | No technician visit record | Cannot prove a site visit, time on site, outcome | `service_visits` |
| 11 | `status` enum has only 5 values and mixes health with location | `provisioned/active/under_maintenance/faulty/retired` cannot say "in client store" or "at vendor" | `lifecycle_status` (14 values) + separate `health_status` |
| 12 | No audit trail | Cannot rebuild a device's life | `device_lifecycle_events` (append-only) |
| 13 | No end-of-life record | Cannot prove disposal or data wipe | `device_disposals` |
| 14 | Data quality: `custom_spec` holds the text `'null'` in 344 rows; price, purchase date, install date, hardware type and `location` are empty on all 445 devices | Reports and warranty maths impossible | Cleanup in migration (section 9), required fields at receiving |

---

## 3. Design principles (from industry practice)

Research on hardware asset management (ServiceNow CSDM lifecycle model, InvGate, AssetVue, Virima) converges on the same ideas, and v2 follows them:

1. **Create the asset record at receiving.** The receiving step is the cheapest place to establish identity (serial, model, cost, warranty start). So devices are created from the **goods receipt**, not later.
2. **Stock is an explicit location**, not a missing zone. Handoffs between stages are where asset data breaks, so each handoff (platform → company → client → site) is a recorded transfer.
3. **Separate lifecycle stage from health.** "Where is it in its life" (in stock, installed, under repair, retired) is different from "is it working today" (working / not working).
4. **Repair and RMA are first-class.** Statuses such as Pending Repair, In Transit, RMA, Pending Retirement exist in mature models; v2 has repair orders with their own status chain.
5. **Warranty drives the decision.** Check warranty when the issue is raised; in-warranty goes to the vendor claim path, out-of-warranty goes to a costed repair-or-replace decision.
6. **Retirement needs proof:** approver, disposal method, data-wipe flag and certificate.
7. **One authoritative record + append-only history.** Current state lives on `devices`; every change also writes one row to `device_lifecycle_events`.

---

## 4. The ownership model (platform → company → client)

```
Vendor ──PO/GRN──▶ PLATFORM WAREHOUSE ──transfer──▶ COMPANY STORE ──transfer──▶ CLIENT STORE ──install──▶ ZONE
(Fixly)            (stock_locations:                (stock_locations:           (stock_locations:        (device_installations)
                    platform_warehouse)              company_store)              client_store)
```

- **Platform** = Fixly itself (super admin and inventory managers, `users.company_id IS NULL`). Orders from vendors and holds the master stock.
- **Company** = the customer organization (e.g. Rajgir Zoo Safari). Receives devices from the platform into its **company store**.
- **Client** = a site or facility of the company. Receives from the company store into its **client store**, then technicians install into **zones**.
- A device always has exactly **one current custody holder** (`current_company_id`, `current_client_id`) and **one place**: either a stock location (`current_location_id`) or a zone (`current_zone_id`).
- **Ownership** (`owner_company_id`, `ownership_type`) is separate from custody, so Fixly-owned devices lent to a company, or customer-owned devices, are both representable.
- Special locations: `in_transit`, `vendor`, `service_center`, `disposal`.

Everything the client can do for its own inventory works the same way as the company tier, which covers "similar for client also".

---

## 5. Device lifecycle states (`devices.lifecycle_status`)

| Status | Meaning | Where is it? | Typical next states |
|---|---|---|---|
| `in_platform_stock` | Received, QC passed, available | Platform warehouse | reserved, in_transit |
| `reserved` | Earmarked for a company/client/replacement | Same stock location | in_transit, in_platform_stock |
| `in_transit` | Dispatched, not yet received | Open `stock_transfer` | in_company_stock, in_client_stock, under_repair |
| `in_company_stock` | In the company's store | Company store | in_transit, in_client_stock |
| `in_client_stock` | In the client's store, ready to install | Client store | installed, in_transit |
| `installed` | Placed and working in a zone | Zone (active installation) | under_maintenance, faulty |
| `under_maintenance` | Technician working on site | Zone | installed, faulty |
| `faulty` | Issue confirmed, device still in place or just removed | Zone or client store | pending_replacement, under_repair, retired |
| `pending_replacement` | Replacement approved, swap not done yet | Zone | under_repair, at_vendor_rma, retired |
| `under_repair` | In-house or service-centre repair | Service-centre location | in_client_stock, in_company_stock, retired |
| `at_vendor_rma` | Sent to vendor for warranty repair or exchange | Vendor location | in_*_stock, retired |
| `retired` | Out of service, waiting for disposal | Any store | disposed |
| `disposed` | Scrapped, sold, recycled, returned (see `device_disposals`) | Disposal | — (terminal) |
| `lost` | Missing or stolen | Unknown | disposed |

**Mapping from v1 `status`:** `active → installed`, `under_maintenance → under_maintenance`, `faulty → faulty`, `retired → retired`, `provisioned → installed` if a zone is set, otherwise `in_client_stock`.

`health_status` (`working | not_working | needs_attention`) comes from `daily_status_logs` and is independent of `lifecycle_status`.

---

## 6. End-to-end walkthrough: which tables change at each step

Example device: **CAM-000136**, a Dome Camera.

| Step | What happens | Tables written | Device after the step |
|---|---|---|---|
| 1. Order | Platform raises a PO for 50 Dome Cameras to a vendor and gets it approved | `purchase_orders`, `purchase_order_items` | (no device yet) |
| 2. Receive | Shipment arrives; GRN records received / accepted / rejected quantity | `goods_receipts`, `goods_receipt_items`; PO item `quantity_received` updated | — |
| 3. Register | One `devices` row per accepted unit with serial, model, price, vendor; warranty row created from model default | `devices`, `warranties`, `device_documents` (invoice, warranty card), `device_lifecycle_events` (`received`) | `in_platform_stock`, location = platform warehouse |
| 4. Allocate to company | Platform assigns units to a company; transfer created and approved | `stock_transfers` (`platform_to_company`), `stock_transfer_items`, `device_allocations` | `reserved` then `in_transit` |
| 5. Company receives | Company storekeeper confirms receipt (per-item condition) | `stock_transfers.received_at`, `stock_transfer_items.item_status`; events | `in_company_stock`, location = company store |
| 6. Allocate to client | Company moves units to a client site; same transfer flow | `stock_transfers` (`company_to_client`), items, allocation (previous one released) | `in_transit` → `in_client_stock` |
| 7. Assign and install | Technician assigned to a zone; installs and commissions the device | `device_installations` (zone, position, GPS, photos), `devices.current_zone_id`, `first_install_date` | `installed` |
| 8. Operate | Zone staff log daily status | `daily_status_logs`; `devices.health_status` | `installed` |
| 9. Fault | Issue raised (manual, from a "not working" daily log, or auto alert); warranty looked up | `issues` (`warranty_id`, `warranty_status`), `issue_status_history` | `faulty` |
| 10. Site visit | Technician is assigned, checks in on site, diagnoses | `service_visits`, `issue_status_history` | `under_maintenance` |
| 11a. Fixed on site | Outcome `fixed` | `issues.resolution_type = fixed_onsite`; visit closed | back to `installed` |
| 11b. Warranty claim | In warranty: vendor repairs or replaces | `repair_orders` (`is_warranty_claim = 1`, `rma_number`) and/or `replacement_requests` (`replacement_basis = warranty`) | `at_vendor_rma` |
| 11c. Paid path | Out of warranty: estimate, approval, then repair or replace | `repair_orders` (`cost_estimate`, `cost_borne_by`) or `replacement_requests` (`replacement_basis = paid`) | `under_repair` or `pending_replacement` |
| 12. Replace | Spare picked from client store, then company, then platform; dispatched; technician swaps | `replacement_requests`, `stock_transfers` (`replacement_dispatch`), new `device_installations` (`replaces_installation_id`), old installation `removed_at` | New unit `installed`; old unit follows its **disposition** (`to_repair`, `vendor_rma`, `return_to_stock`, `scrap`) |
| 13. Repair | Old unit travels to repair centre / vendor and returns | `repair_orders` status chain, `stock_transfers` (`to_repair`, `from_repair`), `repair_parts`; `devices.repair_count + 1` | `under_repair` → `in_client_stock` / `in_company_stock` (`condition = refurbished`) |
| 14. Reinstall | Repaired unit goes back to the same or another zone | new `device_installations` (`reinstall_after_repair` or `relocation`) | `installed` |
| 15. Retire | Beyond repair or not worth repairing | `device_disposals` (method, approver, `data_wiped`, certificate) | `retired` → `disposed` |

Every row above also writes one `device_lifecycle_events` row, so the full life of a device can be read in one query.

---

## 7. Table dictionary

### 7.1 New tables (18)

| Table | Purpose | Key columns |
|---|---|---|
| `device_models` | Catalog SKU: what you order | `manufacturer`, `model_number`, `default_warranty_months`, `default_unit_price`, `spec_json` |
| `vendors` | Manufacturers, distributors, service centres | `vendor_type`, contact fields, `status` |
| `purchase_orders` | Platform order to a vendor | `po_number`, `vendor_id`, `status`, `total_amount`, approver |
| `purchase_order_items` | Lines of a PO | `device_model_id`, `quantity_ordered`, `quantity_received`, `unit_price` |
| `goods_receipts` | GRN when goods arrive | `grn_number`, `vendor_invoice_no`, `delivery_challan_no`, `status` |
| `goods_receipt_items` | Received / accepted / rejected quantity per PO line | `quantity_accepted`, `quantity_rejected`, `rejection_reason` |
| `warranties` | Warranty and AMC cover per device | `warranty_type`, `coverage`, `start_date`, `end_date`, `status` |
| `stock_locations` | Any place a device can sit | `location_type`, `company_id`, `client_id`, `vendor_id` |
| `stock_transfers` | Dispatch and receive document | `transfer_type`, from/to location, from/to company/client, 4 actor columns, challan, tracking, status |
| `stock_transfer_items` | One row per device moved | `condition_out`, `condition_in`, `item_status` |
| `device_allocations` | Who the device is given to, with history | `company_id`, `client_id`, `allocation_type`, `allocated_at`, `released_at` |
| `device_installations` | Placement history in zones | `zone_id`, `installed_by_technician_id`, GPS, `removal_reason`, `replaces_installation_id` |
| `device_lifecycle_events` | Append-only audit trail | `event_type`, from/to status and location, `reference_type/id`, `occurred_at` |
| `device_documents` | Invoices, warranty cards, photos, RMA forms | `doc_type`, `file_url` |
| `service_visits` | Each technician visit to a site | `visit_type`, check-in/out, GPS, `findings`, `outcome`, signature |
| `repair_orders` | A device going out for repair and coming back | `repair_type`, `is_warranty_claim`, `rma_number`, `status`, costs, out/return transfers |
| `repair_parts` | Parts used in a repair | `part_name`, `quantity`, `covered_by_warranty` |
| `device_disposals` | End-of-life record | `disposal_method`, `data_wiped`, `certificate_url`, `recovered_value` |

### 7.2 Changed tables

| Table | Change |
|---|---|
| `devices` | Becomes **one row per physical unit**. Add: `serial_number`, `mac_address`, `barcode`, `device_model_id`, `vendor_id`, `goods_receipt_id`, `purchase_order_item_id`, `ownership_type`, `owner_company_id`, `current_client_id`, `current_location_id`, `condition`, `health_status`, `received_at`, `warranty_end_date`, `repair_count`. Rename `company_id → current_company_id`, `zone_id → current_zone_id`, `install_date → first_install_date`. Replace `status` with `lifecycle_status`. Drop unused `location` (superseded by `device_installations.position_label`). |
| `issues` | Add `issue_number`, `installation_id`, `zone_id`/`client_id`/`company_id` snapshots, `raised_via`, `warranty_id`, `warranty_status`, `diagnosis_summary`, `resolution_type`, `sla_due_at`. |
| `replacement_requests` | Add `faulty_device_id`, `replacement_device_id` (real FK), `warranty_id`, `replacement_basis`, `source_location_id`, `old_device_disposition`, `cost_borne_by`, `cost_amount`, `stock_transfer_id`, `new_installation_id`. Extend `status`. Deprecate `spare_device_name` and `spare_device_code`. |
| `users` | Extend `role` enum: `inventory_manager`, `company_admin`, `company_storekeeper`, `client_storekeeper`. Add `phone`, `last_login_at`. |
| `companies` | Add `company_code`, contact fields, `gst_number`, `address`; status adds `suspended`. |
| `clients` | Add `client_code`, `contact_person`, `contact_phone`. |
| `technicians` | Add `employee_code`, `is_available`. |
| Unchanged | `verticals`, `client_verticals`, `zones`, `zone_assignments`, `technician_assignments`, `product_categories`, `product_types`, `hardware_types`, `issue_categories`, `issue_status_history`, `daily_status_logs`, `refresh_tokens`, `device_tokens`. |

---

## 8. Business rules and integrity constraints

1. **Single place rule.** A device is either installed (`current_zone_id` set, `current_location_id` null) or in a stock location (`current_location_id` set, `current_zone_id` null). Exceptions: `in_transit` (open transfer), `lost`, `disposed`.
2. **One active installation per device.** MariaDB has no partial unique index, so use a generated column `active_flag = IF(status='active',1,NULL)` with `UNIQUE(device_id, active_flag)`.
3. **One active custody allocation per device**, same technique on `device_allocations`.
4. **One open transfer per device.** A device cannot be on two transfers that are not `received`, `rejected` or `cancelled`.
5. **Atomic history.** Any change to `lifecycle_status`, location, company, client or zone must write a `device_lifecycle_events` row in the same transaction (service layer, or DB trigger as a safety net).
6. **Warranty at registration.** On GRN acceptance, create a `warranties` row: `end_date = start_date + default_warranty_months`; `start_basis` is `grn_date` or `install_date` per vendor terms.
7. **Warranty lookup on issue creation.** Find the warranty covering today and set `issues.warranty_id` and `issues.warranty_status` (`in_warranty | out_of_warranty | unknown`). Technicians see this before they visit.
8. **Spare selection order (configurable):** client store, then company store, then platform warehouse. A chosen spare becomes `reserved` until dispatched.
9. **Repair round trip.** `repair_orders` requires an outbound transfer to a `service_center` / `vendor` location and a return transfer. Closing the order sets the device to the return location's tier stock, `condition = refurbished`, `repair_count + 1`.
10. **Disposal gate.** `device_disposals` needs an approver; devices that store data (cameras with SD cards, NVRs) require `data_wiped = 1` and a certificate before status becomes `disposed`.
11. **Receiving gate.** Accepted quantity on a GRN item must equal the number of `devices` rows created for that PO line; `quantity_received` on the PO line is the sum of accepted quantities.
12. **Tenant isolation.** Company roles see devices where `current_company_id` or `owner_company_id` equals their company; client roles are limited to `current_client_id`; platform roles see everything.
13. **Asset tag.** Keep the existing `product_categories.last_seq` generator for `devices.code` (e.g. `CAM-000136`).
14. **Soft integrity.** Do not cascade-delete `devices` once they have transfers, installations or issues; use `retired` / `disposed`. (v1 uses `ON DELETE CASCADE` from devices to issues and logs, which would silently erase history.)

### Role capability matrix

| Action | super_admin | inventory_manager | company_admin | company_storekeeper | client_admin | client_storekeeper | zone_incharge | technician |
|---|---|---|---|---|---|---|---|---|
| Manage vendors, models, POs, GRN | ✔ | ✔ | | | | | | |
| Allocate platform → company | ✔ | ✔ | | | | | | |
| Receive at company store | ✔ | | ✔ | ✔ | | | | |
| Allocate company → client | ✔ | | ✔ | ✔ | | | | |
| Receive at client store | | | | | ✔ | ✔ | | |
| Install / swap device | ✔ | | | | | | | ✔ |
| Raise issue | ✔ | | ✔ | | ✔ | | ✔ | ✔ |
| Assign technician | ✔ | | ✔ | | ✔ | | | |
| Log service visit | | | | | | | | ✔ |
| Approve replacement / repair cost | ✔ | ✔ | ✔ | | ✔ | | | |
| Create repair order / RMA | ✔ | ✔ | | | | | | |
| Approve disposal | ✔ | ✔ | | | | | | |

(Starting proposal; confirm against your real approval policy.)

> **Note added locally:** FBOS uses per-user permissions, not roles. When integrating, this matrix should become permission codes (`inventory.<entity>.<action>`) with roles as presets only. See `FIXLY_V2_INTEGRATION_PLAN.md`.

---

## 9. Migration plan v1 → v2

Order matters; each step is independently deployable.

1. **Add new tables and columns** (all nullable first). Nothing in the app breaks.
2. **Seed reference data:** one `platform_warehouse` location; one `company_store` per company (5); one `client_store` per client (4).
3. **Build `device_models`** from distinct `(category_id, product_type_id)` in `devices` → Bullet, Dome, PTZ, TV. Manufacturer and model number start as "Unknown" and are filled in by the team.
4. **Backfill `devices`:**
   - `device_model_id` from `product_type_id`
   - `current_company_id = company_id`; `current_zone_id = zone_id`; `current_client_id` = zone's client
   - `lifecycle_status` from the v1 mapping in section 5
   - `ownership_type` default `company_owned` (**confirm**, see open questions)
5. **Backfill placement:** one `device_installations` row per device that has a zone (`installed_at = created_at`, `status = active`, installer unknown).
6. **Backfill history:** one `device_lifecycle_events` row per device, `event_type = imported_from_v1`.
7. **Clean data:** convert the text `'null'` in `custom_spec` (344 rows) to real `NULL`; collect missing `unit_price`, `purchase_date`, serial numbers (all 445 devices lack price and dates).
8. **Issues:** backfill `zone_id / client_id / company_id` via device → zone → client; generate `issue_number`; set `warranty_status = unknown`.
9. **Replacement requests:** set `faulty_device_id` from the issue's device; both existing requests have no spare, so leave `replacement_device_id` null.
10. **Switch the app** to the new columns, then drop `devices.status`, `devices.location` and the old spare text columns in a later release.

Prisma note: the schema is Prisma-managed. Express the above as Prisma models and migrations; add the generated-column unique indexes with raw SQL in the migration.

---

## 10. Useful queries (MariaDB)

**Where is each device and who holds it**

```sql
SELECT d.code, dm.name AS model, d.lifecycle_status,
       co.name AS company, cl.name AS client,
       z.name AS zone, sl.name AS stock_location
FROM devices d
LEFT JOIN device_models dm   ON dm.id = d.device_model_id
LEFT JOIN companies co       ON co.id = d.current_company_id
LEFT JOIN clients cl         ON cl.id = d.current_client_id
LEFT JOIN zones z            ON z.id  = d.current_zone_id
LEFT JOIN stock_locations sl ON sl.id = d.current_location_id;
```

**Stock on hand per location and model**

```sql
SELECT sl.name, sl.location_type, dm.name AS model, COUNT(*) AS qty
FROM devices d
JOIN stock_locations sl ON sl.id = d.current_location_id
JOIN device_models dm   ON dm.id = d.device_model_id
WHERE d.lifecycle_status IN ('in_platform_stock','in_company_stock','in_client_stock','reserved')
GROUP BY sl.id, dm.id;
```

**Full life of one device**

```sql
SELECT occurred_at, event_type, from_status, to_status, notes
FROM device_lifecycle_events
WHERE device_id = :id
ORDER BY occurred_at;
```

**Warranties expiring in 60 days**

```sql
SELECT d.code, w.end_date, v.name AS vendor
FROM warranties w
JOIN devices d ON d.id = w.device_id
LEFT JOIN vendors v ON v.id = w.vendor_id
WHERE w.status = 'active' AND w.end_date BETWEEN CURDATE() AND CURDATE() + INTERVAL 60 DAY;
```

**Devices currently out for repair or RMA**

```sql
SELECT d.code, ro.repair_number, ro.repair_type, ro.status, ro.sent_at, ro.rma_number
FROM repair_orders ro
JOIN devices d ON d.id = ro.device_id
WHERE ro.status NOT IN ('closed','cancelled');
```

**Repeat failures (candidates for replacement)**

```sql
SELECT d.code, COUNT(*) AS issues_12m
FROM issues i JOIN devices d ON d.id = i.device_id
WHERE i.created_at >= NOW() - INTERVAL 12 MONTH
GROUP BY d.id HAVING COUNT(*) >= 2;
```

**Transfers still in transit**

```sql
SELECT transfer_number, transfer_type, dispatched_at, tracking_number
FROM stock_transfers WHERE status IN ('dispatched','in_transit');
```

---

## 11. Reports and dashboards this model enables

- Inventory by tier (platform / company / client) and by model.
- Device location register: which device is where, with which company and client.
- Open POs and goods received versus ordered; rejection rate per vendor.
- Warranty expiry calendar; warranty claim rate and turnaround per vendor.
- Mean time to repair; time spent in transit; time in repair per service centre.
- Failure rate per model, vendor and zone (feeds the next procurement decision).
- Repair cost versus replacement cost per device (`repair_orders.final_cost`, `repair_count`).
- Technician workload and on-site time (`service_visits`).

---

## 12. Assumptions and open questions

1. **Ownership:** are devices owned by Fixly and lent to companies, owned by the company, or a mix? v2 supports all three; the migration default is `company_owned` until you confirm.
2. **Who orders?** Only the platform orders from vendors in this design. If a company can also buy devices directly, add `purchase_orders.buyer_company_id`.
3. **Bulk / non-serial items** (cables, power supplies, spare parts) are not tracked individually here. If needed, add `inventory_items` with quantity per `stock_locations` (phase 2).
4. **Approval chain:** the matrix in section 8 is a proposal; real approval levels (and cost limits) should be confirmed.
5. **Repair centres:** treated as `stock_locations` of type `service_center`, owned by a vendor or by Fixly. Confirm whether Fixly runs an in-house repair bench.
6. **Notifications** (push on transfer dispatched, SLA breach, warranty expiry) reuse `device_tokens`; a `notifications` table is a later addition.
7. **Loaner devices** during repair are modelled as a normal replacement with `old_device_disposition = to_repair`. A dedicated "temporary swap" flag can be added if you need the original unit reinstalled automatically.

---

## 13. Suggested build order

1. Foundation: `stock_locations`, `device_models`, `devices` changes, `device_lifecycle_events`, migration backfill.
2. Procurement: `vendors`, `purchase_orders`, `goods_receipts` and automatic device and warranty creation.
3. Movement: `stock_transfers`, `device_allocations` (platform → company → client).
4. Field: `device_installations`, `service_visits`.
5. Service: issue changes, `replacement_requests` upgrade, `repair_orders`, `repair_parts`.
6. End of life and reporting: `device_disposals`, dashboards.
