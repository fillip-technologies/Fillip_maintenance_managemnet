# Fixly Maintenance Management — API Reference

Hardware defect & maintenance platform. Multi-tenant: a **CEO (super_admin)**
oversees many **organizations (companies)**; each org's **head (client_admin)**
manages its people, zones, hardware **units**, and **defects**; **zone officers**
work the field; **technicians** (free agents) fix assigned defects via mobile.

Generated 2026-09-02. Reflects the unified Product/Unit model.

---

## 1. Conventions

**Base URL:** `/api/v1`  ·  **Content-Type:** `application/json` (except file upload).

**Authentication:** Bearer JWT access token in the `Authorization` header:
```
Authorization: Bearer <accessToken>
```
Everything except `/auth/login`, `/auth/refresh`, `/auth/logout` and `/health/*`
requires it. The token is **re-validated against the DB on every request** — a
deleted/removed account is rejected immediately (`401 ACCOUNT_INACTIVE`), a
suspended one with `403 ACCOUNT_SUSPENDED`.

**Response envelope:**
```
success:  { "success": true, "data": <payload> }
list:     { "success": true, "data": { "items": [...], "page", "limit", "totalItems", "totalPages" } }
error:    { "success": false, "code": "STRING_CODE", "message": "...", "details"?: [...] }
```

**Error status codes:** `400 BAD_REQUEST` · `401 UNAUTHORIZED` · `403 FORBIDDEN`
· `404 NOT_FOUND` · `409 CONFLICT` · `500 INTERNAL_ERROR`. Notable machine codes:
`INVALID_CREDENTIALS`, `TOKEN_INVALID`, `ACCOUNT_INACTIVE`, `ACCOUNT_SUSPENDED`,
`CANNOT_DELETE_SELF`, `SUPER_ADMIN_EXISTS`, `EMAIL_TAKEN`, `COMPANY_REQUIRED`,
`CATEGORY_REQUIRED`, `CATEGORY_EXISTS`, `CATEGORY_IN_USE`, `INVALID_TRANSITION`,
`DUPLICATE_ZONE_NAME`, `DUPLICATE_ASSIGNMENT`, `ALREADY_LOGGED_TODAY`.

**Pagination query params (list endpoints):** `page` (default 1), `limit`
(default varies), plus endpoint-specific filters.

---

## 2. Roles & Access Scope

| Role | Belongs to | Scope |
|---|---|---|
| `super_admin` (CEO) | the platform | Everything, all organizations |
| `client_admin` (Org Head) | one Company | Its own org (client + company); manages its users, zones, units, defects |
| `zone_incharge` | a Company, assigned zone(s) | Assigned zone AND all sub-zones (cascading) |
| `zone_staff` | a Company, assigned sub-zone(s) | Same cascading zone scope |
| `technician` | nobody (free) | Defects assigned to them, or unassigned within coverage |

Reads and writes are automatically filtered by this scope. Cross-organization
access is denied (returns 404 to avoid leaking existence).

---

## 3. Auth  `/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | public | Log in; returns tokens + user + primary zone tree |
| POST | `/auth/refresh` | public | Rotate a refresh token for a new access+refresh pair |
| POST | `/auth/logout` | public | Revoke a refresh token |
| GET | `/auth/me` | any | Current identity `{ id, role, clientId, companyId, technicianId }` |
| POST | `/auth/device-token` | any | Register an FCM/APNs push token |

**POST /auth/login** — body `{ email, password }`. Response `data`:
```
{ accessToken, refreshToken,
  user: { id, name, role, clientId, companyId, zoneId },
  zoneDescendants: [...], zoneAncestors: [...] }
```
The access-token claims carry `{ sub, role, clientId, companyId, technicianId }`.

**POST /auth/refresh** — body `{ refreshToken }` → `{ accessToken, refreshToken }`.
**POST /auth/logout** — body `{ refreshToken }`.
**POST /auth/device-token** — body `{ token, platform }`.

---

## 4. Users  `/users`

Write actions require `super_admin` or `client_admin`. A client_admin may only
manage users in **its own organization**, never a `super_admin` or `technician`,
and cannot assign the `client_admin`/`super_admin`/`technician` roles. Created
users inherit the org (companyId/clientId) and are emailed their credentials.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users` | any | List users (scoped). Filters: `search`, `clientId`, `role`, `page`, `limit` |
| POST | `/users` | admin | Create a user |
| GET | `/users/:id` | any | Get a user |
| PATCH | `/users/:id` | admin | Update name/role/accountStatus/clientId |
| DELETE | `/users/:id` | admin | Hard-delete (blocked for self → `CANNOT_DELETE_SELF`) |

**POST /users** body: `{ email, name, role, password?, clientId?, accountStatus? }`.
`role` ∈ `super_admin|client_admin|zone_incharge|zone_staff|technician`.
`accountStatus` ∈ `invited|active|suspended|removed`.

---

## 5. Companies (Organizations)  `/companies`  — super_admin only

| Method | Path | Description |
|---|---|---|
| GET | `/companies` | List companies (`search`, `page`, `limit`) |
| POST | `/companies` | Create `{ name, status? }` |
| GET | `/companies/:id` | Get a company |
| PATCH | `/companies/:id` | Update |
| DELETE | `/companies/:id` | Delete (must have no clients) |

## 6. Clients  `/clients`  — super_admin only

| Method | Path | Description |
|---|---|---|
| GET | `/clients` | List (`companyId`, `search`, `page`, `limit`) |
| POST | `/clients` | Create `{ companyId, name, type?, facilityName?, location? }` |
| GET | `/clients/:id` | Get |
| PATCH | `/clients/:id` | Update |
| DELETE | `/clients/:id` | Delete |

---

## 7. Zones  `/zones`

Zones form a tree per client (`parentZoneId`). Creating requires `super_admin`
or `client_admin`. Assigning a `zone_incharge` auto-activates a draft zone.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/zones` | any | List (`clientId`, `parentZoneId`, `topLevel`, `status`, `search`) |
| POST | `/zones` | admin | Create `{ clientId, parentZoneId?, name }` |
| GET | `/zones/:id` | any | Get a zone (children, active assignments) |
| GET | `/zones/:id/descendants` | any | Full subtree (depth-annotated) |
| PATCH | `/zones/:id` | any (scoped) | Update `{ name?, parentZoneId? }` |
| PATCH | `/zones/:id/status` | any (scoped) | `{ status: draft\|active\|inactive }` |
| GET | `/zones/:id/assignments` | any | Active zone officer assignments |
| POST | `/zones/:id/assign` | any (scoped) | Assign `{ userId, role: incharge\|staff }` |
| DELETE | `/zones/:id/assignments/:assignmentId` | any (scoped) | End an assignment |

---

## 8. Product Categories  `/product-categories`

Global, shared across all organizations; the **CEO** curates them. Each category
owns a `code` prefix used to mint unit codes (e.g. `CAM` → `CAM-000123`).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/product-categories` | any | List global categories `{ id, name, code, _count.devices }` |
| POST | `/product-categories` | super_admin | Create `{ name, code }` (code normalized to A–Z0–9) |
| DELETE | `/product-categories/:id` | super_admin | Delete (blocked if in use → `CATEGORY_IN_USE`) |

---

## 9. Units / Products  `/devices`

A **unit** is one tracked hardware item. It has a **unique code**, a **mandatory
category**, an owning **company**, and an **optional zone** (`zoneId = null` →
*in stock*). Writes require `super_admin` or `client_admin` (org-scoped).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/devices` | any | List units (`zoneId`, `includeSubzones`, `status`, `search`, `page`, `limit`) |
| POST | `/devices` | admin | Create a unit (code auto-generated) |
| GET | `/devices/:id` | any | Get a unit |
| PATCH | `/devices/:id` | admin | Update `{ name?, location?, installDate?, hardwareTypeId?, customSpec? }` |
| PATCH | `/devices/:id/status` | admin | `{ status: active\|retired }` (maintenance/faulty are automatic) |
| POST | `/devices/:id/deploy` | admin | Deploy an in-stock unit: `{ zoneId }` (→ active) |
| GET | `/devices/import/template` | admin | Download the `.xlsx` import template |
| POST | `/devices/import` | admin | Bulk import (see §9.1) |

**POST /devices** body:
```
{ categoryId,            // required — global product category
  companyId?,            // super_admin: required (or derived from zone); client_admin: own org
  zoneId?,               // omit -> in stock; set -> deployed to that zone
  name,
  unitPrice?, purchaseDate?, installDate?, location?, imageUrl?,
  hardwareTypeId?, isManualEntry?, customSpec? }
```
List rows include `{ id, code, name, categoryName, companyName, zoneName, inStock, status, unitPrice, ... }`.
Unit status ∈ `provisioned|active|under_maintenance|faulty|retired`.

### 9.1 Bulk Excel/CSV import
`GET /devices/import/template` returns an `.xlsx` with columns: `name` (req),
`category` (req — name or code), `quantity` (default 1), `zone` (blank = in
stock), `unitPrice`, `purchaseDate`, `location`.

`POST /devices/import` — `multipart/form-data`, field **`file`** (≤ 5 MB), optional
`companyId` (super_admin). Query `?dryRun=true` validates without writing.
- Dry-run → `{ summary: { rows, validRows, errorRows, unitsToCreate }, preview: [...], errors: [{ row, field, message }] }`
- Commit → `{ created, skipped, errors: [...] }`
Codes are minted per category; `quantity` expands into that many units.

---

## 10. Defects (Issues)  `/issues`

A **defect** is raised against a unit and runs a state machine. Raisers:
`zone_staff`, `zone_incharge`, `client_admin` (scoped to units they can see).
Raising flips the unit to `under_maintenance`; closing returns it to `active`.

**Status flow:** `open → assigned → in_progress → (on_hold) → resolved → closed`,
with `reopened` looping back. Every change is recorded with who/when.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/issues` | any | List (scoped). Filters below |
| POST | `/issues` | any (scoped) | Raise a defect |
| GET | `/issues/:id` | any | Get a defect (+ status history) |
| PATCH | `/issues/:id` | any (scoped) | Update `{ priority?, description? }` |
| GET | `/issues/:id/history` | any | Status-change timeline |
| PATCH | `/issues/:id/status` | any (scoped) | Transition (see below) |
| PATCH | `/issues/:id/assign` | super_admin | Assign a technician |

**GET /issues** filters: `deviceId`, `zoneId`, `includeSubzones`, `status`
(comma-separated), `priority`, `assignedTechnicianId`, `raisedByMe=true`,
`scope=technician`, `page`, `limit`.

**POST /issues** body: `{ deviceId, categoryId, priority?, description }`.
`categoryId` is an **issue/defect category** (§11). `priority` ∈
`low|medium|high|critical` (default `medium`).

**PATCH /issues/:id/status** body: `{ status, notes? }` where `status` ∈
`assigned|in_progress|on_hold|resolved|closed|reopened` (illegal jumps →
`INVALID_TRANSITION`). `assigned` requires a technician already set.

**PATCH /issues/:id/assign** body: `{ technicianId, notes? }`.

---

## 11. Defect Categories  `/issue-categories`

Tied to the global product category: `categoryId = null` → **global** (applies to
any unit); a set `categoryId` scopes it to one product category.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/issue-categories` | any | List. `categoryId` or `deviceId` → global + that category's |
| POST | `/issue-categories` | super_admin | Create `{ name, categoryId? }` (omit for global) |

---

## 12. Daily Status Logs  `/daily-logs`

Zone officers log a unit's daily health (web or mobile). Consecutive
`not_working` logs (threshold configurable) auto-flag the unit `faulty`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/daily-logs` | any | List (`deviceId`, `zoneId`, `includeSubzones`, `date`, `from`, `to`) |
| POST | `/daily-logs` | any (scoped) | Log `{ deviceId, status, logDate?, notes?, overwrite? }` |

`status` ∈ `working|not_working|needs_attention`. One log per unit per calendar
day (`ALREADY_LOGGED_TODAY` unless `overwrite:true`).

---

## 13. Technicians  `/technicians`  — writes super_admin only

Technicians are free agents (no company/client). `provision` creates the login
user + profile atomically and emails credentials. Delete removes the whole
account.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/technicians` | any | List (`search`, `page`, `limit`) |
| GET | `/technicians/:id` | any | Get (+ coverage assignments) |
| POST | `/technicians/provision` | super_admin | Create end-to-end `{ name, email, password, specialization? }` |
| POST | `/technicians` | super_admin | Promote an existing user `{ userId, specialization? }` |
| PATCH | `/technicians/:id` | super_admin | Update `{ specialization }` |
| DELETE | `/technicians/:id` | super_admin | Delete the technician (and user) |
| POST | `/technicians/:id/assignments` | super_admin | Add coverage `{ clientId?, zoneId? }` |
| DELETE | `/technicians/:id/assignments/:assignmentId` | super_admin | Remove coverage |

---

## 14. Dashboards  `/dashboard`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/dashboard/overview` | super_admin | Platform-wide rollup (tenancy, fleet, defects, alerts, technicians, facilities, activity) |
| GET | `/dashboard/summary` | any (scoped) | Counts for a scope. Query `scope=platform\|client\|zone`, `id`, `includeSubzones` |
| GET | `/dashboard/zone-breakdown` | any (scoped) | Per-zone unit health for a scope (same query as summary) |

`summary` → `{ totalDevices, faultyDevices, devicesMissingTodayLog, openIssues }`.
`zone-breakdown` → `{ zones: [{ zoneId, zoneName, total, working, faulty, underMaintenance }] }`.

---

## 15. Hardware Types  `/hardware-types`

Equipment type catalog with spec fields and nested categories (legacy; optional
on units).

| Method | Path | Description |
|---|---|---|
| GET | `/hardware-types` | List |
| POST | `/hardware-types` | Create `{ name, specFields }` |
| GET | `/hardware-types/:id` | Get |
| PATCH | `/hardware-types/:id` | Update |
| DELETE | `/hardware-types/:id` | Delete |
| POST | `/hardware-types/:id/categories` | Add a category |
| DELETE | `/hardware-types/:id/categories/:categoryId` | Remove a category |

## 16. Verticals  `/verticals`, `/client-verticals`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/verticals` | any | List verticals |
| POST | `/verticals` | super_admin | Create |
| GET | `/client-verticals` | any | List client-vertical links |
| PATCH | `/client-verticals` | super_admin | Update a link |

---

## 17. Health  `/health`  (unversioned, public)

| Method | Path | Description |
|---|---|---|
| GET | `/health/live` | Liveness — `{ status: ok, uptime }` |
| GET | `/health/ready` | Readiness — checks DB, `{ status: ok, db: connected }` |

---

## 18. Realtime & Push (out-of-band)

- **Socket.IO** broadcasts domain events: `issue:created`, `issue:updated`,
  `log:submitted` (rooms scoped by zone/client). Clients authenticate with the
  access token.
- **Push (FCM)** on defect events → org head + zone incharge (+ CEO planned);
  assignment → technician; progress/resolve → raiser + incharge. No-ops if
  Firebase isn't configured.
- **Email (SMTP)** sends new users their login credentials. No-ops if SMTP
  isn't configured.
