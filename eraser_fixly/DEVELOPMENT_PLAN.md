# Fixly v2 + FBOS: development plan by phase and developer

Status: **draft for review** · Written 2026-10-21 · Planning only, no code changed
Built from everything in this folder: [design doc](fixly-v2-design.md), [integration plan](FIXLY_V2_INTEGRATION_PLAN.md), [docs 01–10](docs/README.md), [diagrams 01–09](diagrams/).
This plan does not make new design decisions. It puts the existing decisions in build order and says **who does each step**. Where a step comes from a document, the source is linked.

---

## 0. Who is who

| | **Fixly dev** | **FBOS dev** |
|---|---|---|
| Owns | `fixly/fixly_backend` (Node, Express, Prisma, MariaDB), `fixly/fixly_flutter`, `fixly/fixly_frontend` (frozen) | `fbos_services/src/v1/*` (FastAPI): Identity, Gateway, Documents, Communication, Revenue, Delivery, Control, Insight; `fbos_frontend/clientadmin` |
| Builds | The `inventory` service: schema, backfill, `/api/inventory/v1`, rules, outbox, subject-access, mobile app move | Everything FBOS needs to host it: permission codes, gateway route, Documents/Communication config, the `features/inventory` UI, later the Revenue/Delivery/Control links |
| Migrates | **Only** the Fixly DB | **Only** FBOS service DBs. Never runs Alembic against the shared remote MySQL from a dev machine |

### The contract between you
Both developers build against one file: **`fixly_backend/docs/openapi/inventory-v1.yaml`**. Fixly dev owns it and FBOS dev reviews it. Any change to a path, field or error code goes through a PR to that file **before** the code changes. FBOS dev builds UI pages against a mock generated from it (Prism or MSW), so neither waits on the other.

### Handoff markers used below
- **⇢ HANDOFF**: one developer delivers something the other needs before they can continue.
- **⛔ GATE**: the phase is not done until this passes. Both sign off.

---

## 1. Working rules for every phase

1. **Additive only until Phase 6.** New tables, nullable columns and new routes. Never alter or drop a live column before Phase 6. ([09 §4](docs/09-rollout-and-migration.md#4-live-system-safety-rules))
2. **Rehearse first.** Every Prisma migration and backfill runs on a **throwaway local MariaDB** restored from `u516064072_fixly.sql` before staging or prod.
3. **Backfills are idempotent scripts** in `fixly_backend/scripts/v2/` with `--dry-run`, and print a count summary.
4. **Deploy order:** Identity first, then the inventory routes that need its codes. The FBOS dev deploys the Identity change and tells the Fixly dev before the Fixly routes go live.
5. **Separate auth stacks.** Mount `/api/v1` (legacy) and `/api/inventory/v1` (new) as separate routers that share no middleware.
6. **One feature flag per FBOS page.** To roll back, turn the flag off; the legacy routes are still served.
7. **Run the legacy smoke test (`scripts/smoke.mjs`) after every Fixly deploy.**
8. **The cross-customer test is required** on every list and detail endpoint from Phase 2 onward.

---

## 2. Phase map

```
           Fixly dev                                 FBOS dev
P0  ─ OpenAPI draft, spike (Node side) ───────── permission list, spike (Identity side)
P1  ─ schema v2 + backfill + guards ──────────── Identity codes, gateway, Documents config,
                                                 UI scaffold on mocks          (parallel)
P2  ─ auth adapter, read API, subject-access ─── deploy Identity → read pages on real API
P3  ─ PO/GRN/transfers/installs writes, outbox ─ purchasing + transfer pages, notif templates
P4  ─ issues/visits/repair/disposal, mobile app ─ service pages, mobile sign-in support
P5  ─ Revenue/Delivery/Control clients, AMC ──── inbound endpoints in those services
P6  ─ drop legacy columns/routes/roles ───────── redirect Fixly web, clean up flags
```

| Phase | Fixly dev blocks FBOS dev on | FBOS dev blocks Fixly dev on |
|---|---|---|
| 0 | OpenAPI v0 | final permission code list in Identity terms |
| 1 | nothing (FBOS works on mocks) | nothing |
| 2 | read API on staging | Identity codes + `SENSITIVE_READ_CODES` deployed, gateway entry |
| 3 | write API + outbox | Communication templates (for notifications to show) |
| 4 | service API | Identity mobile refresh confirmed, technician users created |
| 5 | Fixly clients | new internal endpoints in Revenue / Delivery / Control |

---

## Phase 0 · Decisions, contract, spike

**Goal:** settle every question that changes code, and prove that customer scoping works across the two stacks before anyone builds on it.

### Joint (both, with the product owner)
1. Get answers to the decisions in [10 · Decisions](docs/10-decisions-and-open-questions.md):
   - **D3 ownership** (needs an answer): sets the `ownership_type` default for the 445 devices and the billing logic.
   - Confirm D1 (`client_user` + sites as org units), D2 (`inventory`), D4 (keep Fixly web until parity), D5 (approvals Fixly-internal first).
   - Open questions 2 (who orders), 8 (sites as org units), 9 (Revenue client per company), 10 (preset names), 11 (day-one dashboards), 12 (SLA per priority).
2. Adopt the glossary: Fixly **Company → customer**, **Client → site**, Zone stays. The v2 API never says "client" for a site ([integration plan §1](FIXLY_V2_INTEGRATION_PLAN.md#1-where-each-side-is-today)).
3. Agree on the branch names and the staging environment where both stacks run side by side.

### Fixly dev
1. Write **`docs/openapi/inventory-v1.yaml` v0** from [07 · API](docs/07-api-and-events.md): conventions, error shape, `PageResponse`, every path in §3, and the permission code on each operation. Reads in full detail; writes may stay as stubs.
2. Spike, Node side: create `src/modules/inventory/auth/fbosActor.js` with one route, `GET /api/inventory/v1/_spike/devices`, that:
   - forwards `Authorization` and `X-Organization-Id` to Identity `GET /api/identity/v1/internal/authz/actor` with `X-FBOS-Internal-Token`;
   - caches the result for 30 s, returns 503 when Identity is down, and relays Identity's 401/404;
   - filters devices by the `unit_scopes` it receives.
3. Write down which current site (`clients` row) maps to which org unit, for the spike user.

### FBOS dev
1. Turn the permission table in [06 §2](docs/06-access-and-permissions.md#2-permission-codes-proposed) into the final list in Identity's format. Mark the sensitive `.read` codes: `purchase_order`, `vendor`, `repair_order`, `disposal`, `warranty`, `report`.
2. Spike, Identity side, on a **local** Identity DB:
   - create a customer → site org-unit tree for one customer;
   - create a `client_user` with `inventory.device.read` scoped (`scope_unit_id`) to one site;
   - confirm `/internal/authz/actor` returns `permissions`, `own_records_only` and `unit_scopes` as expected.
3. Review OpenAPI v0 against FBOS conventions (plural nouns, error shape, pagination), and check that the preset names match open question 10.

### ⇢ HANDOFF
- Fixly → FBOS: OpenAPI v0.
- FBOS → Fixly: the spike user's token, organization id and unit id, plus the final code list.

### ⛔ GATE 0
- [ ] The spike `client_user` sees only the devices of their own site through the Node endpoint, and a second customer's devices return nothing (list) or 404 (detail).
- [ ] With Identity stopped, the endpoint answers 503.
- [ ] D1–D5 are recorded in [10](docs/10-decisions-and-open-questions.md) with an answer. If the spike fails, switch to the **b-lite fallback** (`self_only` grants plus site assignments held in inventory) and record that.
- [ ] OpenAPI v0 is merged.

---

## Phase 1 · Foundation: v2 schema and backfill in Fixly

**Goal:** the Fixly DB holds the v2 model next to v1, all live data is backfilled, and the legacy app is unaffected.
**Sources:** [design doc §7](fixly-v2-design.md#7-table-dictionary), [§9](fixly-v2-design.md#9-migration-plan-v1--v2), [integration plan §6 changes 2, 3, 5, 6, 12–15](FIXLY_V2_INTEGRATION_PLAN.md#6-changes-to-the-eraser-er-design-v2--v21), diagrams [02](diagrams/02-v2-domain1-organization-access.eraser)–[06](diagrams/06-v2-domain5-issues-repair.eraser).

### Fixly dev
**Step 1. Safety fixes first (one migration, before any v2 write)**
1. `Issue → Device`: change `onDelete: Cascade` to `Restrict` (`schema.prisma`, issue relation; [change 13](FIXLY_V2_INTEGRATION_PLAN.md#6-changes-to-the-eraser-er-design-v2--v21)). Check `daily_status_logs` and other device children the same way.
2. Add `deleted_at` to `devices` and make the legacy delete endpoint a soft delete.
3. Zone delete guard: the legacy `DELETE /zones/:id` returns 409 while any device has `zone_id` in that zone or its children ([change 14](FIXLY_V2_INTEGRATION_PLAN.md#6-changes-to-the-eraser-er-design-v2--v21)).
4. Deploy, then run the smoke test.

**Step 2. Additive schema (migrations grouped by domain, all columns nullable)**
1. Platform: `organization_id` on every inventory table, plus the `outbox` and `idempotency_keys` tables ([change 2, 5](FIXLY_V2_INTEGRATION_PLAN.md#6-changes-to-the-eraser-er-design-v2--v21)).
2. Domain 1 ([diagram 02](diagrams/02-v2-domain1-organization-access.eraser)): `companies` (`company_code`, contact fields, `gst_number`, `address`, `fbos_customer_id`), `clients` (`client_code`, contacts), `technicians` (`employee_code`, `is_available`), `users.fbos_user_id`, and a small `fbos_links` mapping-audit table.
3. Domain 2 ([diagram 03](diagrams/03-v2-domain2-catalog-procurement-warranty.eraser)): `device_models` (with `tax_percent`, `hsn_sac`), `vendors`, `purchase_orders` (`currency`, `tax_total`, `approval_request_id`), `purchase_order_items` (`tax_percent`), `goods_receipts`, `goods_receipt_items`, `warranties` (`contract_id`).
4. Domain 3 ([diagram 04](diagrams/04-v2-domain3-inventory-transfers.eraser)): `stock_locations`, `stock_transfers` (`version`), `stock_transfer_items`, `device_allocations`.
5. Domain 4 ([diagram 05](diagrams/05-v2-domain4-device-lifecycle.eraser)): the new `devices` columns from [design §7.2](fixly-v2-design.md#72-changed-tables), with **`lifecycle_state` added as a new column; `status` is not altered** ([change 12](FIXLY_V2_INTEGRATION_PLAN.md#6-changes-to-the-eraser-er-design-v2--v21)). Also `version`, then `device_installations` (`work_unit_id`, `task_id`), `device_lifecycle_events`, `device_documents` (`document_id`, not `file_url`), `device_disposals` (`certificate_document_id`, `approval_request_id`).
6. Domain 5 ([diagram 06](diagrams/06-v2-domain5-issues-repair.eraser)): new `issues` columns (plus `version`, `sla_policy_id`, `approval_request_id`), `replacement_requests` columns, `service_visits`, `repair_orders` (`version`, `billable`, `invoice_id`), `repair_parts`.
7. Raw SQL inside the Prisma migrations for the generated-column unique indexes:
   - one active installation per device (`active_flag = IF(status='active',1,NULL)`, `UNIQUE(device_id, active_flag)`);
   - one active allocation per device (same pattern) ([design §8 rules 2–3](fixly-v2-design.md#8-business-rules-and-integrity-constraints)).
8. User FKs in the new tables are plain `*_user_id` UUID columns, not FKs to `users` ([change 3](FIXLY_V2_INTEGRATION_PLAN.md#6-changes-to-the-eraser-er-design-v2--v21)).
9. Rehearse on the local copy, deploy, then run the smoke test.

**Step 3. Backfill scripts (`scripts/v2/NN_*.mjs`, in order, each idempotent with `--dry-run`)**
1. `01_seed_locations`: 1 `platform_warehouse`, 5 `company_store`, 4 `client_store`, plus one each of `in_transit`, `vendor`, `service_center`, `disposal`.
2. `02_device_models`: build from distinct category and type (Bullet, Dome, PTZ, TV), with manufacturer `Unknown`.
3. `03_clean_data`: change the text `'null'` in `custom_spec` (344 rows) to SQL `NULL`.
4. `04_devices`: model, `current_company_id`, `current_zone_id`, `current_client_id` (from the zone), and `lifecycle_state` from the [§5 mapping](fixly-v2-design.md#5-device-lifecycle-states-deviceslifecycle_status). Set `ownership_type` to the **D3 answer** and `organization_id`.
5. `05_installations`: one active row per device that has a zone.
6. `06_events`: one `imported_from_v1` event per device.
7. `07_issues`: zone, client and company snapshots; `issue_number`; `warranty_status = unknown`.
8. `08_replacements`: `faulty_device_id` from the issue's device.
9. `09_reconcile`: print counts and exit non-zero on a mismatch.
10. Run on the local copy and record the output, then staging, then prod.

**Step 4. Keep both columns in step.** Until Phase 6, any legacy write that changes `devices.status`, `zone_id` or `company_id` also updates `lifecycle_state` and the `current_*` columns and writes a lifecycle event in the same transaction. Put this in one helper, `src/modules/inventory/domain/deviceState.js`, and call it from the legacy device and issue services.

**Step 5. Domain helpers that later phases use:** `recordLifecycleEvent(tx, …)`, the single-place-rule check, and the state-machine transition table from [03 §1](docs/03-device-lifecycle.md#1-state-machine). Unit-test them with `node --test`.

### FBOS dev (in parallel; depends only on OpenAPI v0)
1. **Identity:** add the `inventory.*` codes to `PERMISSION_CATALOG` (`01_identity/services/permission_catalog.py`), and add the sensitive reads to `SENSITIVE_READ_CODES` **in the same commit**. Add the presets from [06 §3](docs/06-access-and-permissions.md#3-roles-become-presets). Write a test that every sensitive code is excluded from the `member` preset. **Do not deploy yet** (see Phase 2).
2. **Identity:** add an internal "look up users by ids" endpoint if one is missing (needed for technician and staff names).
3. **Gateway:** add an `inventory` entry to `SERVICE_URL_MAP` (`00_gateway/routes/proxy.py`) and a setting in `00_gateway/config.py`.
4. **Documents:** add `inventory` to `subject_services` (`05_documents/config.py`) with the Fixly base URL setting.
5. **Frontend scaffold** `clientadmin/src/features/inventory/`, following the layout in [08 §5](docs/08-fbos-ui.md#5-frontend-structure):
   - `api.js`, with one function per OpenAPI operation;
   - a mock layer (MSW) from the OpenAPI file, switched on by an env flag;
   - Inventory menu entries gated by `features/auth/access.js` and one feature flag per page;
   - a Vite proxy `/api/inventory` → `INVENTORY_URL`;
   - `/api/inventory` and the module added to `fbos_frontend/CLAUDE.md`.
6. Build the **read pages on mocks**: Devices list (filters: model, status, site, zone, location, warranty), Device detail with header, where-and-who and the Timeline tab ([08 §3](docs/08-fbos-ui.md#3-device-detail-layout)), and Stock locations. Shared components: `StatusBadge` (14 states, grouped as in [03 §2](docs/03-device-lifecycle.md#2-each-state-in-plain-words)), `HealthBadge`, `WarrantyBadge`, and `useInventoryNames`.
7. **Revenue data prep:** for each of the 5 Fixly companies, find or create its Revenue client (open question 9) and send the Fixly dev a `company → fbos_customer_id` list.
8. **Identity data prep:** match Fixly's 9 users by email, create the missing ones (technicians as `contractor` or `employee`, customer staff as `client_user`), create the site org units, and send a `fixly_user_id → fbos_user_id` list.

### ⇢ HANDOFF
- FBOS → Fixly: the `fbos_customer_id` and `fbos_user_id` lists. Fixly dev loads them with `scripts/v2/10_fbos_links.mjs`, which also writes `fbos_links`.

### ⛔ GATE 1
- [ ] Reconcile passes on prod: **445 devices, 5 companies, 4 sites, 227 zones**; every device has a `lifecycle_state`, a model and exactly one event; every zoned device has one active installation.
- [ ] Deleting a device with issues, or a zone with devices installed, is refused.
- [ ] The legacy web app, the mobile app and `smoke.mjs` all work.
- [ ] FBOS read pages run on mocks behind their flags; the Identity change is merged but not deployed.

---

## Phase 2 · Bridge and read UI

**Goal:** an FBOS user signs in to clientadmin and sees real Fixly devices, and a customer user sees only their own site.

### FBOS dev, first
1. **Deploy the Identity change** (codes, sensitive set, presets) to staging, then prod, and tell the Fixly dev. This must happen before any inventory route is reachable.
2. Deploy the gateway entry and the Documents config pointing at the Fixly staging URL.

### Fixly dev
1. Mount `src/modules/inventory/router.js` at `/api/inventory/v1`, separate from the legacy router.
2. Middleware stack: `fbosActor` (from the spike, hardened) → `requirePermission(code)` → handler. **Never** read the user or org from any other header; the gateway forwards all headers.
3. A `scope` helper turns `unit_scopes` and `own_records_only` into Prisma `where` clauses, following [06 §5](docs/06-access-and-permissions.md#5-record-level-rules). Anything outside scope returns **404**.
4. Shared pieces: an FBOS error formatter `{detail:{code,message,meta}}`, a `PageResponse` paginator, `GET /health` and `GET /ready`.
5. Read routes: `/customers`, `/sites`, `/zones`, `/device-models`, `/stock-locations`, `/stock-locations/{id}/stock`, `/devices`, `/devices/{id}`, `/devices/{id}/events`, `/devices/{id}/warranties`, `/devices/{id}/documents`.
6. Subject-access for Documents: `GET /internal/subject-access/{type}/{id}?action=read|attach`, checked against `X-FBOS-Internal-Token`, returning `{organization_id, label}`. An org mismatch returns 404. Start with `inventory.device`; the other subject types arrive with their phases.
7. **Unguarded-route test:** walk the Express router and fail if any `/api/inventory/v1` route lacks `requirePermission` ([06 §6](docs/06-access-and-permissions.md#6-preventing-an-unguarded-route)). Run it in CI.
8. **Cross-customer test helper**, used by every list and detail test: two customers, two `client_user`s, and each must see none of the other's rows.
9. Update OpenAPI to v1 for the read routes. Deploy to staging.

### FBOS dev, after the read API is on staging
1. Point the read pages at the real API (mock off), and fix the gaps the OpenAPI did not show.
2. Device detail Documents tab: reuse `DocumentPanel` with subject `inventory.device`.
3. Customer view ([08 §6](docs/08-fbos-ui.md#6-what-a-customer-user-sees)): cost and vendor fields hidden when the user lacks the code; menu items hidden through `access.js`.
4. A first dashboard tile set with only what open question 11 asks for on day one.

### ⇢ HANDOFF
- FBOS → Fixly: "Identity deployed". Fixly → FBOS: "read API on staging + OpenAPI v1".

### ⛔ GATE 2
- [ ] An employee with `inventory.device.read` sees all 445 devices in clientadmin, with their timeline.
- [ ] The spike `client_user` sees only their own site; a guessed device id from another customer returns 404.
- [ ] A plain `member` does **not** get any sensitive code.
- [ ] The unguarded-route test is green; attaching a file to a device works through Documents.
- [ ] Legacy smoke passes; turning the page flags off hides the pages.

---

## Phase 3 · Procurement and movement (writes)

**Goal:** a new device walks PO → GRN → platform stock → company → site → installed in a zone, entirely in the FBOS UI.
**Sources:** [design §6 steps 1–7](fixly-v2-design.md#6-end-to-end-walkthrough-which-tables-change-at-each-step), [04 · flows A–C](docs/04-process-flows.md), flow [08](diagrams/08-flow-device-journey.eraser), [design §8 rules 1–6, 11, 13](fixly-v2-design.md#8-business-rules-and-integrity-constraints).

### Fixly dev
1. **Write plumbing:** `If-Match`/`version` checks (409 on mismatch), and `Idempotency-Key` middleware backed by `idempotency_keys` (a replay returns the stored response).
2. **Outbox:**
   - `outbox` rows are written in the same transaction as the change;
   - a polling worker POSTs to Communication `/internal/notifications` with `source_event_id`, retries with backoff and marks rows delivered;
   - it runs as a separate process or interval, and a test proves that events survive Communication downtime.
3. **Catalog:** `/vendors`, `/device-models` CRUD.
4. **Purchase orders:** create, edit draft, `submit`, `approve`, `cancel`, with currency from the organization and GST per line. Approval stays Fixly-internal (D5).
5. **Goods receipt** `POST /goods-receipts` (Idempotency-Key). In one transaction it writes:
   - the GRN and its lines;
   - one device per accepted unit (serial, model, price, vendor, PO line), with `code` from the **existing `reserveCodes` generator** ([change 15](FIXLY_V2_INTEGRATION_PLAN.md#6-changes-to-the-eraser-er-design-v2--v21));
   - one warranty per device (rule 6) and one `received` event per device;
   - the PO line's `quantity_received`.

   Enforce the receiving gate (rule 11). Serial, model, price and receiving location are required.
6. **Transfers:** `create`, `approve`, `dispatch` (Idempotency-Key), `receive` (condition per item), `cancel`, for the types `platform_to_company`, `company_to_client`, `client_to_client` and the returns. Enforce one open transfer per device (rule 4). Each step writes allocations, `current_*` columns, `lifecycle_state` and events through `deviceState.js`.
7. **Installations:** `POST /installations` (single-place rule; one active installation) and `POST /installations/{id}/remove`. `first_install_date` is set on the first install.
8. Zones: `POST`, `PATCH` and `DELETE /zones` on the new API, with the 409 guard.
9. Subject-access types `inventory.purchase_order` and `inventory.goods_receipt`.
10. Outbox events `device.received`, `transfer.dispatched`, `transfer.received`, `device.installed`.
11. Tests: rule tests under concurrency (two parallel installs or transfers of the same device: one wins and one gets 409), idempotency replay, cross-customer tests on every new list.

### FBOS dev
1. **Communication:** notification templates for transfer dispatched (to the receiver) and received (to the sender), and device received.
2. **Pages:**
   - Purchasing: Vendors, Models, Purchase orders (lines, submit and approve), Goods receipt with **serial capture** (scan or paste many serials, accept or reject per line).
   - Transfers: list, detail, create with a device picker from a location's stock, approve, dispatch, and receive with per-item condition. Follow the storekeeper flow in [08 §4](docs/08-fbos-ui.md#4-how-users-move-through-it).
   - Device detail actions: Install (zone picker plus position), Move or transfer.
3. Send `If-Match` on edits and an `Idempotency-Key` (a UUID per form submit) on GRN and dispatch. Show 409 as "someone else changed this, reload".
4. Show new stock on the Stock locations page after a receive.

### ⛔ GATE 3
- [ ] In the FBOS UI on staging: PO for 5 units → GRN (4 accepted, 1 rejected) → 4 devices in platform stock with warranties → transfer to a company → receive → transfer to a site → receive → install one in a zone. The timeline shows every step.
- [ ] Receivers get notifications; stopping Communication delays them but loses none.
- [ ] Submitting the GRN twice creates no duplicates.

---

## Phase 4 · Service: issues, repair, disposal, and the mobile app

**Goal:** the full fault-to-resolution flow, including warranty claim and RMA, and technicians on FBOS Identity.
**Sources:** [design §6 steps 8–15](fixly-v2-design.md#6-end-to-end-walkthrough-which-tables-change-at-each-step), [04 · flows D–I](docs/04-process-flows.md), flow [09](diagrams/09-flow-fault-handling.eraser), [design §8 rules 7–10](fixly-v2-design.md#8-business-rules-and-integrity-constraints).

### Fixly dev, backend
1. **Daily status logs** `POST /daily-status-logs`: updates `health_status`, and a `not_working` log can raise an issue.
2. **Issues:**
   - create (warranty lookup sets `warranty_id` and `warranty_status`, rule 7; `sla_due_at` from the agreed SLA per priority, open question 12; snapshots), `assign`, and update status (writes `issue_status_history`);
   - technicians are limited to assigned issues (`own_records_only` plus `technician_assignments`).
3. **Service visits** `/issues/{id}/visits`: check-in and check-out with GPS, findings, outcome, signature. The outcome `fixed` closes the issue as `fixed_onsite` and the device goes back to `installed`.
4. **Replacements:**
   - request (spare picker searches the site store, then the company store, then the platform, rule 8; the chosen spare becomes `reserved`) and approve;
   - dispatch through a `replacement_dispatch` transfer;
   - the swap creates a new installation with `replaces_installation_id` and removes the old one;
   - the old unit follows its `old_device_disposition`.
5. **Repair orders:**
   - create (warranty claim flag, RMA number, `cost_estimate`, `cost_borne_by`) and `approve` the cost;
   - `dispatch` creates the outbound transfer to a `service_center` or `vendor` (Idempotency-Key);
   - `close` records the return transfer, `condition = refurbished`, `repair_count + 1` and the tier stock (rule 9), with `repair_parts`.
6. **Disposals:** create and approve. Before `disposed`, devices that store data need `data_wiped` and a certificate document (rule 10); otherwise return 422.
7. Subject-access types `inventory.issue`, `inventory.repair_order`, `inventory.disposal`.
8. Outbox events `issue.raised`, `issue.resolved`, `repair.sent`, `repair.returned`, `device.retired`. Add a daily job for `warranty.expiring` at 60, 30 and 7 days.
9. Report endpoints from the [§10 queries](fixly-v2-design.md#10-useful-queries-mariadb): stock-on-hand, warranty-expiry, open-repairs, repeat-failures, transfers-in-transit.

### Fixly dev, mobile (`fixly_flutter`)
1. Sign in with FBOS Identity and send `X-Client-Type: mobile` so that `/token/refresh` accepts the refresh token in the body.
2. Store the refresh token securely and **serialize refreshes** (one in-flight refresh, others wait), because reusing a refresh token revokes the whole session family.
3. Move the technician screens to `/api/inventory/v1`: assigned issues, visit check-in and check-out, install and swap. Keep FCM through `device_tokens`.
4. Release behind a build flag, then move technicians over one at a time. The legacy API stays up.

### FBOS dev
1. **Pages:**
   - Service: Issues and visits (raise with category, description and photo; the warranty badge appears automatically; assign; visit log), Replacements (request, approve, spare picker, disposition), and the Repair orders board (out for repair or RMA, costs, dispatch, close).
   - Warranties: expiry calendar and claim status.
   - Disposals: approve and record the wipe with a certificate upload through `DocumentPanel`.
   - Reports: the five reports with filters and export.
2. **Communication:** templates for issue raised (to the assignee), issue resolved (to the reporter), repair sent and returned, and warranty expiring.
3. **Identity:** confirm that mobile refresh works for the technician users. Send the Fixly dev test accounts for each technician.

### ⛔ GATE 4
- [ ] On staging: zone staff raise an issue → it shows the warranty status → a technician (on the **mobile app with FBOS sign-in**) visits → not fixable → replacement from the site store → the old unit goes to vendor RMA → it comes back refurbished into stock → it is reinstalled elsewhere. A second device runs repair → beyond repair → retired → disposal with certificate → `disposed`.
- [ ] A customer user can raise and follow only their own issues and never sees repair costs without the code.
- [ ] Every technician is on the new app build.

---

## Phase 5 · Cross-service links and preventive maintenance

**Goal:** contract → install → warranty → billable repair, end to end. AMC visits are generated.
**Sources:** [integration plan §6 changes 8–9](FIXLY_V2_INTEGRATION_PLAN.md#6-changes-to-the-eraser-er-design-v2--v21), [§8](FIXLY_V2_INTEGRATION_PLAN.md#8-work-in-fbos), [04 · flow J](docs/04-process-flows.md).
Scope depends on open question 14 (is repair billing in v2?).

### FBOS dev (each item is a new internal endpoint in that service)
1. **Revenue:** internal read of customer and site contacts; contract warranty and AMC terms by `contract_id`; an endpoint that takes a billable repair and creates an invoice line, returning `invoice_id`.
2. **Delivery:** a link from a project or task to an installation or replacement; an endpoint for Delivery to list devices installed for a project.
3. **Control:** approval request create and status for PO, repair cost and disposal; SLA policies for issues (when D5 moves approvals to Control).
4. **Insight:** consumers for the inventory events (audit and reports), if wanted.
5. **UI:** device and installation panels on the Delivery project page and the Revenue customer page, and the Maintenance plans page.

### Fixly dev
1. Clients for the FBOS endpoints above, each behind a config flag, with timeouts. A core flow never fails because Revenue, Delivery or Control is down ([07 §8](docs/07-api-and-events.md#8-dependency-and-downtime-behavior)).
2. Fill the link columns: `work_unit_id` and `task_id` on installations, `warranties.contract_id`, `repair_orders.billable` and `invoice_id`, and `approval_request_id` on PO, disposal and issue.
3. Move PO, repair-cost and disposal approvals to Control when it is ready. Keep the internal approval as a fallback until Control is proven.
4. **Maintenance plans:** a `maintenance_plans` table, a `/maintenance-plans` CRUD, and a scheduled job that generates preventive `service_visits` from AMC warranties ([change 9](FIXLY_V2_INTEGRATION_PLAN.md#6-changes-to-the-eraser-er-design-v2--v21)).
5. Add `processed_events` only if some FBOS service starts calling back with events.

### ⛔ GATE 5
- [ ] A Revenue contract with AMC terms → a Delivery project installs devices → warranties carry `contract_id` → AMC visits appear on schedule → an out-of-warranty billable repair produces an invoice line in Revenue.

---

## Phase 6 · Retire legacy

**Goal:** one system. Start only when FBOS has reached parity (D4) and a retirement date is set (open question 13).

### FBOS dev
1. Redirect the Fixly web app URL to clientadmin, and send customers the date in advance.
2. Remove the page feature flags that are now always on.
3. Remove any mock-only code paths that are left.

### Fixly dev
1. Turn on request logging on `/api/v1` and watch it: **no traffic for 2 weeks** before removal.
2. Move device codes from `reserveCodes` to `code_sequences` ([change 15](FIXLY_V2_INTEGRATION_PLAN.md#6-changes-to-the-eraser-er-design-v2--v21)).
3. Contract migrations (rehearsed on a local copy first):
   - drop `devices.status`, `devices.location` and the old spare text columns on `replacement_requests`;
   - remove the `deviceState.js` dual-write;
   - rename columns where the design asks (`company_id → current_company_id` and so on) if not done earlier.
4. Remove the legacy routers, `requireRole`, `authz/scope.js` and Fixly JWT issuing. Keep `users` only as the `fbos_user_id` mapping while `Technician.user` needs it, or move technicians to `*_user_id` UUIDs and drop it.
5. Archive `fixly_frontend`.

### ⛔ GATE 6 = v2 definition of done ([09 §7](docs/09-rollout-and-migration.md#7-definition-of-done-for-v2))
- [ ] A device can be traced from PO to disposal in the FBOS UI with no gaps.
- [ ] Customer staff see only their own site.
- [ ] Technicians sign in with FBOS Identity.
- [ ] The legacy routes have had no traffic for two weeks and are removed.

---

## 3. Test checklist (carried through every phase)

| Test | Owner | From phase |
|---|---|---|
| Legacy smoke (`scripts/smoke.mjs`) after every Fixly deploy | Fixly | 1 |
| Backfill reconcile (445 / 5 / 4 / 227) | Fixly | 1 |
| Domain rule unit tests (single place, one active installation, one open transfer, atomic history) | Fixly | 1 |
| Unguarded-route test in CI | Fixly | 2 |
| Cross-customer test on every list and detail route | Fixly | 2 |
| Sensitive codes not in the `member` preset | FBOS | 1 |
| Idempotency replay (GRN, dispatch, repair dispatch) | Fixly | 3 |
| Outbox survives Communication downtime | Fixly | 3 |
| UI permission gating (hidden actions, hidden cost fields) | FBOS | 2 |
| Mobile refresh serialization (no session-family revocation) | Fixly | 4 |
| End-to-end gate scenario per phase on staging | Both | 2 |

## 4. Risks to watch, and who acts

| Risk | Acts | Mitigation in this plan |
|---|---|---|
| One customer sees another's data (`client_user` is only a label) | Fixly | Phase 0 spike, `scope` helper, cross-customer test helper on every route |
| New `.read` codes reach every member | FBOS | Codes and `SENSITIVE_READ_CODES` in one commit, with a test; deployed before the routes |
| Cascade delete or zone delete corrupts history | Fixly | Phase 1 step 1, before any v2 write |
| `status` and `lifecycle_state` drift during the transition | Fixly | `deviceState.js` used by legacy and new writes alike |
| UI and API drift | Both | OpenAPI is the contract; FBOS builds on mocks generated from it |
| Documents blocks when Fixly is down | Both | Health checks and timeouts; accepted as known |
| A migration runs against a shared remote DB | Both | Each dev migrates only their own DB; rehearse locally first |
| Live data gaps (no prices, dates or serials) | Fixly + product owner | Cleanup script; required fields at GRN; the team fills in model and manufacturer data |
