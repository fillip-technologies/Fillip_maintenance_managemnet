# 05 · Data model

Column-level truth lives in the Eraser sources: [`../diagrams/02`](../diagrams/02-v2-domain1-organization-access.eraser) … [`06`](../diagrams/06-v2-domain5-issues-repair.eraser), with the whole system in [`07`](../diagrams/07-v2-full-overview.eraser) (36 tables). This page gives the same model as readable diagrams plus the v2.1 changes needed for FBOS.

Conventions: **NEW** = new in v2, **CHG** = changed from v1, **v2.1** = added by the FBOS integration.

## 1. Domain map

```mermaid
flowchart LR
    ORG["1 · Organization and access<br/>companies, clients, zones,<br/>users, technicians"]
    CAT["2 · Catalog, procurement, warranty<br/>models, vendors, PO, GRN, warranties"]
    INV["3 · Inventory and transfers<br/>locations, transfers, allocations"]
    DEV["4 · Device and lifecycle<br/>devices, installations, events,<br/>documents, logs, disposals"]
    ISS["5 · Issues and repair<br/>issues, visits, replacement,<br/>repair orders, parts"]
    ORG --- INV
    ORG --- DEV
    CAT --- DEV
    CAT --- INV
    INV --- DEV
    DEV --- ISS
    CAT --- ISS
```

## 2. Domain 1 — Organization and access

```mermaid
erDiagram
    companies ||--o{ clients : "has sites"
    companies ||--o{ users : employs
    clients ||--o{ users : "site staff"
    clients ||--o{ zones : contains
    zones ||--o{ zones : "parent_zone_id"
    zones ||--o{ zone_assignments : staffed
    users ||--o{ zone_assignments : assigned
    users ||--o| technicians : "is a"
    technicians ||--o{ technician_assignments : covers
    clients ||--o{ technician_assignments : at
    zones ||--o{ technician_assignments : in
    verticals ||--o{ client_verticals : tags
    clients ||--o{ client_verticals : tagged

    companies {
        string id PK
        string name
        string company_code "NEW"
        string gst_number "NEW"
        string status "CHG adds suspended"
        string fbos_customer_id "v2.1"
        string organization_id "v2.1"
    }
    clients {
        string id PK
        string company_id FK
        string name
        string client_code "NEW"
        string contact_person "NEW"
    }
    zones {
        string id PK
        string client_id FK
        string parent_zone_id FK
        string name
    }
    users {
        string id PK
        string company_id FK
        string client_id FK
        string role "CHG then permission presets"
        string fbos_user_id "v2.1"
    }
    technicians {
        string id PK
        string user_id FK
        string employee_code "NEW"
        boolean is_available "NEW"
    }
```

## 3. Domain 2 — Catalog, procurement, warranty

```mermaid
erDiagram
    product_categories ||--o{ product_types : has
    product_categories ||--o{ device_models : classifies
    product_types ||--o{ device_models : classifies
    hardware_types ||--o{ device_models : "spec template"
    vendors ||--o{ purchase_orders : "supplies"
    purchase_orders ||--o{ purchase_order_items : lines
    device_models ||--o{ purchase_order_items : ordered
    purchase_orders ||--o{ goods_receipts : "received as"
    goods_receipts ||--o{ goods_receipt_items : lines
    purchase_order_items ||--o{ goods_receipt_items : matches
    devices ||--o{ warranties : "covered by"
    vendors ||--o{ warranties : "issued by"

    device_models {
        string id PK
        string manufacturer
        string model_number
        int default_warranty_months
        decimal default_unit_price
        json spec_json
        decimal tax_percent "v2.1"
        string hsn_sac "v2.1"
    }
    vendors {
        string id PK
        string vendor_type "manufacturer / distributor / service_center"
        string status
    }
    purchase_orders {
        string id PK
        string po_number
        string vendor_id FK
        string status
        decimal total_amount
        string currency "v2.1"
        string approval_request_id "v2.1"
    }
    purchase_order_items {
        string id PK
        string device_model_id FK
        int quantity_ordered
        int quantity_received
        decimal unit_price
    }
    goods_receipts {
        string id PK
        string grn_number
        string vendor_invoice_no
        string delivery_challan_no
        string status
    }
    goods_receipt_items {
        string id PK
        int quantity_accepted
        int quantity_rejected
        string rejection_reason
    }
    warranties {
        string id PK
        string device_id FK
        string warranty_type "manufacturer / extended / amc / seller"
        date start_date
        date end_date
        string status
        string contract_id "v2.1"
    }
```

## 4. Domain 3 — Inventory, transfers, allocation

```mermaid
erDiagram
    stock_locations ||--o{ stock_transfers : "from"
    stock_locations ||--o{ stock_transfers : "to"
    stock_transfers ||--o{ stock_transfer_items : moves
    devices ||--o{ stock_transfer_items : "is moved"
    devices ||--o{ device_allocations : "given to"
    stock_transfers ||--o{ device_allocations : causes
    stock_locations ||--o{ devices : "holds"

    stock_locations {
        string id PK
        string location_type "platform_warehouse / company_store / client_store / in_transit / vendor / service_center / disposal"
        string company_id
        string client_id
        string vendor_id
    }
    stock_transfers {
        string id PK
        string transfer_number
        string transfer_type
        string from_location_id FK
        string to_location_id FK
        string status
        string challan_no
        string tracking_number
        int version "v2.1"
    }
    stock_transfer_items {
        string id PK
        string device_id FK
        string condition_out
        string condition_in
        string item_status
    }
    device_allocations {
        string id PK
        string device_id FK
        string company_id
        string client_id
        string allocation_type "ownership / custody / loan"
        datetime allocated_at
        datetime released_at
    }
```

## 5. Domain 4 — Device, installation, lifecycle log

```mermaid
erDiagram
    device_models ||--o{ devices : "type of"
    devices ||--o{ device_installations : "placed as"
    zones ||--o{ device_installations : "in"
    technicians ||--o{ device_installations : installs
    device_installations ||--o| device_installations : "replaces_installation_id"
    devices ||--o{ device_lifecycle_events : "history"
    devices ||--o{ device_documents : "files"
    devices ||--o{ daily_status_logs : "daily"
    devices ||--o{ device_disposals : "end of life"

    devices {
        string id PK
        string code "asset tag e.g. CAM-000136"
        string serial_number "NEW"
        string device_model_id FK "NEW"
        string lifecycle_status "NEW 14 values"
        string health_status "NEW"
        string ownership_type "NEW platform / company / client owned, leased"
        string owner_company_id "NEW"
        string current_company_id "CHG"
        string current_client_id "NEW"
        string current_zone_id "CHG"
        string current_location_id "NEW"
        string condition "NEW"
        int repair_count "NEW"
        int version "v2.1"
        datetime deleted_at "v2.1"
    }
    device_installations {
        string id PK
        string device_id FK
        string zone_id FK
        string installed_by_technician_id FK
        string status "active / removed"
        string removal_reason
        string work_unit_id "v2.1"
        string task_id "v2.1"
    }
    device_lifecycle_events {
        string id PK
        string device_id FK
        string event_type
        string from_status
        string to_status
        string reference_type
        string reference_id
        datetime occurred_at
    }
    device_documents {
        string id PK
        string doc_type
        string document_id "v2.1 replaces file_url"
    }
    device_disposals {
        string id PK
        string disposal_method
        boolean data_wiped
        string certificate_document_id "v2.1"
        decimal recovered_value
        string approval_request_id "v2.1"
    }
```

## 6. Domain 5 — Issues, visits, repair, replacement

```mermaid
erDiagram
    devices ||--o{ issues : "has"
    issue_categories ||--o{ issues : classifies
    technicians ||--o{ issues : "assigned"
    warranties ||--o{ issues : "covers"
    issues ||--o{ issue_status_history : tracks
    issues ||--o{ service_visits : "visited in"
    technicians ||--o{ service_visits : performs
    issues ||--o{ replacement_requests : "may need"
    devices ||--o{ replacement_requests : "faulty / replacement"
    stock_transfers ||--o{ replacement_requests : "moves spare"
    devices ||--o{ repair_orders : "sent for"
    issues ||--o{ repair_orders : "causes"
    warranties ||--o{ repair_orders : "claimed under"
    vendors ||--o{ repair_orders : "repairs"
    repair_orders ||--o{ repair_parts : uses

    issues {
        string id PK
        string issue_number "NEW"
        string device_id FK
        string installation_id "NEW"
        string warranty_status "in_warranty / out_of_warranty / unknown"
        string resolution_type "NEW"
        datetime sla_due_at "NEW"
        string raised_via "NEW"
        int version "v2.1"
        string sla_policy_id "v2.1"
    }
    service_visits {
        string id PK
        string visit_type "diagnosis / onsite_repair / replacement_swap / removal / preventive"
        datetime checked_in_at
        datetime checked_out_at
        string findings
        string outcome
    }
    replacement_requests {
        string id PK
        string faulty_device_id FK
        string replacement_device_id FK
        string replacement_basis "warranty / paid / goodwill / insurance"
        string old_device_disposition "to_repair / vendor_rma / return_to_stock / scrap"
        string status
    }
    repair_orders {
        string id PK
        string repair_number
        string repair_type "onsite / in_house / service_center / vendor_rma"
        boolean is_warranty_claim
        string rma_number
        string status
        decimal cost_estimate
        decimal final_cost
        boolean billable "v2.1"
        string invoice_id "v2.1"
    }
    repair_parts {
        string id PK
        string part_name
        int quantity
        boolean covered_by_warranty
    }
```

## 7. Platform tables added by the FBOS integration (v2.1)

Not drawn in the Eraser diagrams yet. Add them to diagram 07 when the schema is generated.

| Table | Purpose |
|---|---|
| `outbox` | Events to deliver, written in the same transaction as the change; polled by the worker |
| `idempotency_keys` | Replay protection for transfers, GRN registration, repair dispatch |
| `fbos_links` | Mapping audit (Fixly user / company ↔ FBOS id) |
| `maintenance_plans` | Preventive maintenance schedule (scope, interval, next due) |
| `code_sequences` | Phase 6 only: replaces `product_categories.last_seq` |
| `processed_events` | Only if a consumer is added later |

## 8. Integrity rules

| # | Rule | How it is enforced |
|---|---|---|
| 1 | **Single place:** installed (zone) **or** in a stock location | Service layer + check on write; exceptions `in_transit`, `lost`, `disposed` |
| 2 | **One active installation per device** | MariaDB generated column `active_flag = IF(status='active',1,NULL)` + `UNIQUE(device_id, active_flag)` (raw SQL in migration) |
| 3 | **One active custody allocation per device** | Same technique on `device_allocations` |
| 4 | **One open transfer per device** | Checked when adding an item to a transfer |
| 5 | **Atomic history** | Status/location change and `device_lifecycle_events` insert share one transaction; optional DB trigger as a safety net |
| 6 | **Warranty at registration** | Created in the GRN transaction |
| 7 | **Warranty lookup on issue** | Done when the issue row is created |
| 8 | **Spare selection order** | Site → company → platform; configurable; chosen spare becomes `reserved` |
| 9 | **Repair round trip** | Outbound and return transfers required to close |
| 10 | **Disposal gate** | Approver + `data_wiped` + certificate for data-bearing devices |
| 11 | **Receiving gate** | Accepted qty = devices created |
| 12 | **Tenant isolation** | Company roles see their own devices; site users see only their site; operator sees all |
| 13 | **Asset tag** | Existing `last_seq` generator kept until Phase 6 |
| 14 | **Soft integrity** | Never cascade-delete devices with history. v2.1 changes `Issue → Device` from cascade to Restrict and adds `deleted_at` |
| 15 | **Zone delete guard (v2.1)** | Block deleting a zone while devices are installed (v1 would silently turn them into "stock") |

## 9. Useful queries

```sql
-- Where is each device and who holds it
SELECT d.code, dm.name AS model, d.lifecycle_status,
       co.name AS company, cl.name AS client,
       z.name AS zone, sl.name AS stock_location
FROM devices d
LEFT JOIN device_models dm   ON dm.id = d.device_model_id
LEFT JOIN companies co       ON co.id = d.current_company_id
LEFT JOIN clients cl         ON cl.id = d.current_client_id
LEFT JOIN zones z            ON z.id  = d.current_zone_id
LEFT JOIN stock_locations sl ON sl.id = d.current_location_id;

-- Full life of one device
SELECT occurred_at, event_type, from_status, to_status, notes
FROM device_lifecycle_events WHERE device_id = :id ORDER BY occurred_at;

-- Warranties expiring in 60 days
SELECT d.code, w.end_date, v.name AS vendor
FROM warranties w
JOIN devices d ON d.id = w.device_id
LEFT JOIN vendors v ON v.id = w.vendor_id
WHERE w.status = 'active'
  AND w.end_date BETWEEN CURDATE() AND CURDATE() + INTERVAL 60 DAY;
```

More queries (stock on hand, out for repair, repeat failures, transfers in transit) are in [design doc §10](../fixly-v2-design.md#10-useful-queries-mariadb).

## 10. Data quality in the live database

| Finding (from the dump) | Action |
|---|---|
| `custom_spec` holds the text `'null'` in 344 devices | Convert to real `NULL` |
| Price, purchase date, install date, hardware type, location empty on all 445 devices | Collect; make required at receiving |
| 2 replacement requests have no spare attached | Leave `replacement_device_id` null |
| 0 daily status logs | Nothing to migrate; health starts from first log |
