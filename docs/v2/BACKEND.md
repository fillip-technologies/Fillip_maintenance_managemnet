# Fixly backend — what v2 added

> Branch `ayush-dev4`. Read `SYSTEM.md` first for how this fits with Fixly web and FBOS.
> Design background: `fixly/eraser_fixly/` (design doc, diagrams, `DEVELOPMENT_PLAN.md`).

## 1. In one paragraph
The backend still serves the legacy `/api/v1` unchanged for the Fixly web screens and the mobile app. Beside it, it serves `/api/inventory/v1`: hardware inventory and lifecycle (purchase → stock → install → fault → repair or replace → disposal) for **Fixly users** (Fixly JWT, role-based) and **FBOS users** (FBOS token, permission-based). Both APIs write the same tables, and the v1 and v2 device columns are kept in step in one place.

## 2. Code layout

```
src/
  app.js                         mounts /api/v1 (legacy) and, if INVENTORY_API_ENABLED, /api/inventory/v1
  server.js                      starts the outbox worker when OUTBOX_WORKER_ENABLED
  modules/devices/…              legacy; writes call syncFromLegacy (v2 columns + history)
  modules/issues/issue.service.js  legacy; new issues get number, snapshots, warranty, SLA (enrichNewIssue)
  modules/zones|clients|companies  legacy; refuse to delete a zone/site/org that holds devices
  modules/inventory/
    router.js                    the v2 router: /health, /ready, /me, internal, then guarded routes
    permissions.js               every inventory.* code (P.*)
    subjects.js                  Documents subject types (inventory.device, .issue, …)
    db.js                        withTx(): write transactions at READ COMMITTED (+1 retry on deadlock)
    auth/
      middleware.js              authenticateActor (Fixly JWT → FixlyActor, else FBOS Identity), requirePermission
      fixlyActor.js              Fixly role → permission set; Fixly zone scope
      identityClient.js          FBOS /internal/authz/actor (30 s cache, 503 when down), /internal/people
      access.js                  Access: which customers/sites/zones/stock the caller sees (Prisma where)
      context.js                 AsyncLocalStorage: the Fixly user behind a request, for history rows
    http/                        errors (FBOS shape), cursor pages, zod validation, If-Match, Idempotency-Key, serializers
    domain/
      lifecycle.js               14 states, allowed moves, single-place rule, v1↔v2 status mapping
      deviceState.js             changeDeviceState (v2 writes), syncFromLegacy (v1 writes), recordLifecycleEvent
      issues.js                  warranty lookup, SLA due time, enrichNewIssue
      numbers.js                 PO-2026-0001, GRN-, TRF-, RO-, ISS-, DSP- (document_sequences)
      stores.js                  delete empty stores with a company/site
    services/                    procurement, transfers, installations, issues, replacements, repairs,
                                 disposals, maintenance, warrantyNotices, outbox
    routes/                      HTTP routes per area (see §4)
scripts/
  inventory_*.test.mjs           node --test suites (see §8)
  v2/                            backfill, local DB reset, FBOS dev bootstrap, legacy smoke, passwords
```

## 3. Database (Prisma migrations added)

| Migration | What | Safe on live? |
|---|---|---|
| `20261021090000_v2_safety_restrict_device_history` | issues and daily logs no longer cascade-delete with a device; `devices.deleted_at` | yes (additive) |
| `20261021091000_v2_inventory_schema` | all v2 tables and nullable columns (below) | yes (additive) |
| `20261021120000_v2_service_fbos_actors` | FBOS-user columns on issues / history / replacements; `warranties.last_notice_days` | yes (additive) |
| `20261021150000_v2_maintenance_plans` | `maintenance_plans`, `service_visits.maintenance_plan_id/client_id` | yes (additive) |
| `20261021180000_v2_phase6_status_from_lifecycle` | `devices.status` becomes a generated column from `lifecycle_state` | **HOLD**: see `MIGRATION.md` |

**New tables:**
- **Catalog and buying:** `device_models`, `vendors`, `purchase_orders`, `purchase_order_items`, `goods_receipts`, `goods_receipt_items`, `warranties`.
- **Stock:** `stock_locations`, `stock_transfers`, `stock_transfer_items`, `device_allocations`.
- **Devices:** `device_installations`, `device_lifecycle_events`, `device_documents`, `device_disposals`.
- **Service:** `service_visits`, `repair_orders`, `repair_parts`, `maintenance_plans`.
- **Platform:** `outbox`, `idempotency_keys`, `document_sequences`, `fbos_links`.

**New columns on existing tables:**
- **devices:**
  - identity: `serial_number`, `mac_address`, `barcode`, `device_model_id`, `vendor_id`, GRN / PO links
  - ownership and place: `ownership_type`, `owner_company_id`, `current_client_id`, `current_location_id`
  - state: `lifecycle_state`, `health_status`, `condition`
  - service: `received_at`, `warranty_end_date`, `repair_count`
  - housekeeping: `version`, `deleted_at`, `organization_id`
- **issues:**
  - `issue_number`, `installation_id`, and snapshots of where the device was (`zone_id`, `client_id`, `company_id`)
  - `raised_via`, `warranty_id`, `warranty_status`, `diagnosis_summary`, `resolution_type`
  - `sla_due_at`, `sla_policy_id`, `approval_request_id`, `version`, `raised_by_fbos_user_id`
- **replacement_requests:** real device links (faulty device, replacement device), plus basis, disposition, cost, transfer and installation links.
- **companies and clients:** codes, contacts, FBOS links.
- **users:** `fbos_user_id`.
- **technicians:** `employee_code`, `is_available`.

**Rules held by the database:**
- **Generated unique columns:** one active installation, one active allocation and one open transfer per device (MariaDB has no partial unique index).
- **Restrict foreign keys:** history can't be deleted with a device.

**Prisma caveats:**
- `prisma migrate diff` proposes spurious `JSON` and `attachments DEFAULT []` changes, and after Phase 6 proposes turning `status` back into a plain column. Write or trim migrations by hand.
- MariaDB DDL is not transactional: a migration that fails halfway stays half-applied. Rehearse on a copy first.

## 4. API `/api/inventory/v1`

Every route needs a permission (a test fails on an unguarded route). Exceptions: `/health`, `/ready` and `/me`. Other conventions:
- `If-Match: "<version>"` on state changes: 409 `VERSION_MISMATCH`, 428 when PATCH /devices has none.
- `Idempotency-Key` on goods receipt, transfer dispatch and repair dispatch: a replay returns the first answer.

| Area | Endpoints |
|---|---|
| Me | `GET /me` (permissions of the caller, used by Fixly web) |
| Places | `GET/POST/PATCH /customers`, `/sites`, `/zones` (DELETE zones: 409 if devices or history), `GET/POST/PATCH /stock-locations`, `GET /stock-locations/:id/stock` |
| Catalog | `GET /device-categories`, `GET/POST/PATCH /device-models`, `/vendors` (a vendor gets its own location) |
| Devices | `GET /devices` (q, lifecycle_state, health, model, customer, site, zone, location, warranty), `GET/PATCH /devices/:id`, `/events`, `/installations`, `/warranties`, `GET/POST /devices/:id/documents` |
| Install | `POST /installations`, `POST /installations/:id/remove` |
| Buying | `GET/POST/PATCH /purchase-orders`, `POST …/submit|approve|cancel`, `GET/POST /goods-receipts` |
| Transfers | `GET/POST /stock-transfers`, `POST …/approve|dispatch|receive|cancel` |
| Issues | `GET /issue-categories`, `GET /technicians`, `GET/POST /issues`, `GET /issues/:id`, `POST /issues/:id/assign|status|visits`, `POST /visits/:id/check-out` |
| Replacements | `GET/POST /replacements`, `POST …/approve|reject|complete` |
| Repairs | `GET/POST /repair-orders`, `GET /repair-orders/:id`, `POST …/approve|dispatch|arrived|close|cancel`, `PATCH …/billing` |
| End of life | `POST /devices/:id/retire`, `GET/POST /disposals`, `POST …/approve|reject|complete` |
| Maintenance | `GET/POST/PATCH /maintenance-plans`, `POST /maintenance-plans/generate`, `GET /visits`, `POST /visits/:id/start|complete`, `POST /warranties` (AMC) |
| Daily status | `POST /daily-status-logs` |
| Reports | `GET /reports/by-state|stock-on-hand|warranty-expiry|open-repairs|repeat-failures|transfers-in-transit` |
| Internal | `GET /internal/subject-access/:type/:id?action=read|attach` (FBOS Documents) |

Errors: `{ "detail": { "code", "message", "status", "meta"?, "details"? } }`. Lists: `{ "data": [...], "page": { "next_cursor", "has_more", "limit", "total"? } }`.

## 5. Business rules in code
- **State machine** (`domain/lifecycle.js`): e.g. stock → reserved → in transit → stock; site store → installed; installed → faulty → pending replacement / under repair / retired; retired → disposed. Anything not listed answers 422 `INVALID_LIFECYCLE_TRANSITION`.
- **Single place:** a device is in a zone or at a stock location, never both. Faulty or pending-replacement units may be in either.
- **Receiving gate:** accepted units must match the serial numbers given, and can't exceed what is still due on the order line. Each unit gets a warranty from the model's default months.
- **Spare selection** (replacement approve): same model, nearest first: site store, then organization store, then warehouse. A spare from elsewhere travels on a `replacement_dispatch` transfer.
- **Repair round trip:** out and back are real transfers. Repaired units come back `refurbished` with `repair_count + 1`; beyond repair means retired.
- **Disposal gate:** a model with `stores_data` needs `data_wiped` and a certificate document before `disposed`.
- **Ownership (open decision D3):** units reaching an organization store get `INVENTORY_DEFAULT_OWNERSHIP` (default `company_owned`).
- **Writes run at READ COMMITTED** (`withTx`): MariaDB 11's snapshot isolation made concurrent receipts fail on the shared code counter (error 1020). Legacy unit create and import use it too.

## 6. Settings (`.env`)

| Variable | Meaning | Default |
|---|---|---|
| `INVENTORY_API_ENABLED` | mount `/api/inventory/v1` | `false` |
| `FBOS_ORGANIZATION_ID` | FBOS organization that runs the business; stamped on rows; other orgs get 404 | unset (no org filter) |
| `INVENTORY_DEFAULT_OWNERSHIP` | owner of delivered devices (D3) | `company_owned` |
| `INVENTORY_SLA_HOURS` | hours to fix per priority | `critical:4,high:24,medium:72,low:168` |
| `FBOS_IDENTITY_URL`, `FBOS_IDENTITY_TIMEOUT_MS`, `FBOS_ACTOR_CACHE_SECONDS` | FBOS Identity for FBOS callers | `http://localhost:8001`, 5000, 30 |
| `FBOS_COMMUNICATION_URL` | where notifications go | unset (rows wait) |
| `FBOS_INTERNAL_TOKEN` | shared service token (same as FBOS `INTERNAL_SERVICE_TOKEN`) | empty |
| `OUTBOX_WORKER_ENABLED` | run the worker (notifications, warranty notices, maintenance visits) | `false` |

Fixly-only use (no FBOS): set `INVENTORY_API_ENABLED=true` and leave the FBOS variables unset. Fixly tokens never need Identity. `/ready` will report Identity as unavailable; `/health` is what matters.

## 7. Scripts (`npm run …`)

| Script | Does | Guard |
|---|---|---|
| `v2:reset-local-db` | rebuild `test_*` DB from the dump and apply migrations | refuses non-`test_` / non-local |
| `v2:fbos-bootstrap` | create the dev org, site units and users in a **local** FBOS Identity; link the Fixly DB | local only |
| `v2:backfill [--dry-run] [--only=04,05]` | fill v2 tables and columns from v1 data; idempotent; ends with a reconcile that fails on a mismatch | `--remote` needed for a non-local DB |
| `v2:local-passwords [pw]` | one password for every user | local `test_` only |
| `v2:smoke` | legacy API smoke test against a running server | local `test_` only |

## 8. Tests
`node --test scripts/inventory_*.test.mjs`: 60 tests. They need the local test DB, plus the docker FBOS Identity for the API tests.

| Suite | Covers |
|---|---|
| `inventory_lifecycle` | state machine, single place, v1↔v2 mapping (pure) |
| `inventory_db_rules` | unique installation, transfer, allocation; restrict delete; legacy sync |
| `inventory_routes` | every route guarded |
| `inventory_api` | FBOS auth, scoping, 404s, costs hidden, 503 when Identity is down, Documents access |
| `inventory_flow` | PO → GRN → transfers → install, idempotency, outbox retry |
| `inventory_service` | issue → visit → replacement → RMA → reinstall; retire and dispose |
| `inventory_maintenance` | plans generate once, AMC cover, billing link |
| `inventory_fixly` | each Fixly role sees the same devices as legacy; role limits |

`scripts/push.test.mjs` has 2 failures that predate v2.
