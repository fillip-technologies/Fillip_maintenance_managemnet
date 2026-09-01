# Maintenance API — Explained by Role, Top to Bottom

A narrative, role-first companion to `API_REFERENCE.md`. Where the reference is a
flat dictionary of endpoints, this document walks the API **the way the
hierarchy actually works** — starting at the super admin who owns the whole
platform, then down through the company admin, the client (organization) admin,
the zone incharge, the zone staff, and finally the technician who closes the
loop on the ground.

For each level you get: **who they are**, **what they can touch**, **the exact
endpoints they call**, a **full request→response cycle** for a representative
action, and **where in the product it's used** (which app / screen).

Base URL: `http://localhost:3000/api/v1` · JSON in, JSON out · Bearer token on
everything except login/refresh/logout and `/health`.

---

## 1. The request → response cycle (every call goes through this)

Before any role-specific logic runs, every request passes through the same
pipeline (`src/app.js` → `src/routes/index.js`). Understanding it once explains
the shape of every response below.

```
Client (Flutter / Web / socket)
   │  HTTP request  Authorization: Bearer <accessToken>
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 1. helmet, cors, compression        security headers, CORS, gzip       │
│ 2. express.json (1mb limit)          parse body                         │
│ 3. pino-http + x-request-id          structured log + correlation id    │
│ 4. rateLimit (/api)                  RATE_LIMIT_MAX per window          │
│ 5. router /api/v1                                                        │
│      5a. authenticate                verify JWT → req.user               │
│           { id, role, companyId, clientId, technicianId }               │
│      5b. attachScope                 resolveScope(user) → req.scope      │
│           what clients / zones this user may see                        │
│      5c. requireRole(...)            (only on admin-guarded routes)      │
│      5d. validate(zodSchema)         body/query/params → typed, safe     │
│      5e. controller                  thin — calls the service            │
│      5f. service                     business logic + Prisma, AND-combines│
│           req.scope into every query                                    │
│ 6. response.js envelope              { success:true, data }             │
│    …or errorHandler                  { success:false, code, message }   │
└──────────────────────────────────────────────────────────────────────┘
```

Key consequences:

- **`req.user`** is derived only from the signed token (`authenticate`) — the
  client can't spoof its role or tenant.
- **`req.scope`** (`attachScope` → `resolveScope`) is computed once per request
  and is the single source of "what can this person see." Every list query
  AND-combines it; every by-id read/write uses a scoped `findFirst` that returns
  **404 (not 403)** when out of scope, so ids never leak across tenants.
- **`requireRole`** is a *coarse* gate on mutation routes (e.g. only admins may
  `POST /devices`). Fine-grained visibility is the scope layer's job, not the
  role gate's.
- **Errors** are centralized: thrown `ApiError`s and mapped Prisma errors become
  `{ success:false, code, message }` with the right HTTP status.

### The response envelope (always one of three shapes)

```jsonc
// single object
{ "success": true, "data": { … } }

// list (paginated)
{ "success": true, "data": { "items": [ … ], "page": 1, "limit": 20, "totalItems": 42, "totalPages": 3 } }

// error
{ "success": false, "code": "DUPLICATE_ZONE_NAME", "message": "…", "details"?: [ … ] }
```

### How scope is derived per role (`src/authz/scope.js`)

| Role | `resolveScope` result | Meaning |
| ---- | --------------------- | ------- |
| `super_admin` | `{ platform: true }` | everything, no filter |
| `company_admin` | `{ clientIds: [all clients of the company] }` | its company's clients |
| `client_admin` | `{ clientIds: [own clientId] }` | one client, all its zones |
| `zone_incharge` | `{ zoneIds: [assigned zones (+subtree if CASCADING_VISIBILITY)] }` | its zone(s) |
| `zone_staff` | `{ zoneIds: [assigned zones] }` | its zone only, no cascade |
| `technician` | `{ clientIds/zoneIds from technician_assignments, technicianId }` | its coverage + issues assigned to it |

---

## 2. Authentication — the entry point for every role

Everyone, regardless of level, starts here. Shared across the Flutter app
(zone_head + technician) and the Web app (all admin roles).

### `POST /auth/login`  →  full cycle

**Request**
```json
{ "email": "priya@cityzoo.com", "password": "Password123!" }
```
**What happens inside** (`auth.service.login`):
1. Look up the user by lower-cased email.
2. Verify the bcrypt password hash — uniform `INVALID_CREDENTIALS` if either half is wrong (no user-enumeration leak).
3. Reject `suspended` / `removed` accounts (`403`).
4. First-ever login flips `invited → active`.
5. Issue a short-lived **access token** (JWT, 15m) + a rotating **refresh token** (hashed at rest).
6. For zone-scoped users, attach their primary zone's **descendants** + **ancestors** so the app can cache the tree.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ…",
    "refreshToken": "8f14…",
    "user": { "id": "…", "name": "Priya Singh", "role": "client_admin", "clientId": "c22…", "zoneId": null },
    "zoneDescendants": [ … ],
    "zoneAncestors": [ … ]
  }
}
```
**Client stores:** `accessToken` in memory, `refreshToken` in secure storage.

### Supporting auth calls (all roles)
| Endpoint | Use | Where |
| -------- | --- | ----- |
| `POST /auth/refresh` | Rotate an expired access token (revokes the old refresh, issues a new pair) | silent, on 401 |
| `POST /auth/logout` | Revoke a refresh token | logout button |
| `GET /auth/me` | Re-fetch current identity | app resume |
| `POST /auth/device-token` | Register an FCM token for push | after login (mobile) |

---

## 3. `super_admin` — owns the whole platform

**Who:** the platform operator. Scope = everything.
**Where used:** Web app → *super_admin* section (Companies, Clients, Verticals, Platform dashboard).

### What they can do & the endpoints

| Capability | Endpoint(s) | Guard |
| ---------- | ----------- | ----- |
| Manage companies (tenants) | `GET/POST /companies`, `GET/PATCH/DELETE /companies/:id` | `super_admin` only |
| Manage clients under any company | `GET/POST /clients`, `GET/PATCH/DELETE /clients/:id` | `super_admin`, `company_admin` |
| Define verticals & toggle them per client | `GET/POST /verticals`, `GET/PATCH /client-verticals` | verticals create = `super_admin` |
| See everything (any zone/device/issue/log) | all list endpoints | scoped `{platform:true}` |
| Platform-wide dashboard | `GET /dashboard/summary?scope=platform` | `super_admin` |
| Full platform overview (one aggregated call for the overview page) | `GET /dashboard/overview` | `super_admin` only |

### Full cycle example — onboarding a new organization

1. **Create the company (tenant):**
   `POST /companies` → `{ "name": "Acme Facilities Group" }` → `201 { data: { id, name, status:"active" } }`
2. **Create a client (the zoo) under it:**
   `POST /clients` → `{ "companyId": "…", "name": "City Zoo", "type": "zoo" }` → `201`
3. **Turn on the hardware/CCTV vertical for that client:**
   `PATCH /client-verticals` → `{ "clientId": "c22…", "verticalId": "v-hardware-cctv", "active": true }`
4. **Invite the client admin** (see §5's `POST /users`).

Because scope is `{platform:true}`, none of these calls are filtered — a super
admin sees and edits across every tenant. This is the **only** role that joins
the `platform:all` socket room and receives the platform-wide live feed.

---

## 4. `company_admin` — owns one company, many clients

**Who:** the operator of a single company (e.g. a facilities-management firm).
Scope = every client belonging to `user.companyId`.
**Where used:** Web app, same pages as super_admin but auto-limited to their company.

### What they can do

| Capability | Endpoint(s) | Notes |
| ---------- | ----------- | ----- |
| Add / manage clients in **their** company | `POST /clients`, `PATCH /clients/:id` | `clientId` scope auto-limits reads |
| Toggle verticals for their clients | `PATCH /client-verticals` | `super_admin`+`company_admin` |
| Invite client admins & staff | `POST /users`, `PATCH /users/:id` | `adminOnly` |
| See all zones/devices/issues/logs across their clients | list endpoints | scope = company's `clientIds` |
| Assign technicians across their clients | `POST /technicians/:id/assignments` | client- or zone-level |

### Full cycle example — reading issues across the company

`GET /issues?status=open,assigned&page=1&limit=20`

Inside `issue.service.list`: the base filter (`status in [open,assigned]`) is
**AND-combined** with `issueScopeWhere(scope)`, which for a company admin expands
to *"the device's zone belongs to one of my company's clients."* The company
admin therefore sees open issues from **every** zoo/site their company runs, but
never another company's. Same envelope as everyone else — the difference is
entirely in the `where` the scope injected.

---

## 5. `client_admin` — the "organization owner" (e.g. the zoo owner)

**Who:** runs one client (City Zoo). Scope = that one `clientId` and **all** its
zones (client admins always have full roll-up over their own client).
**Where used:** Web app → *client_admin* pages: Zone builder, Devices, Issues,
Staff, Client dashboard.

This is the busiest role — it builds the zone tree, stocks it with devices,
staffs it, and triages issues.

### What they can do

| Capability | Endpoint(s) |
| ---------- | ----------- |
| Build the zone tree (zones + sub-zones) | `POST /zones`, `PATCH /zones/:id`, `PATCH /zones/:id/status` |
| Assign incharge / staff to zones | `POST /zones/:id/assign`, `DELETE /zones/:id/assignments/:aid` |
| Add / update / retire devices | `POST /devices`, `PATCH /devices/:id`, `PATCH /devices/:id/status` |
| Invite & manage staff | `POST /users`, `PATCH /users/:id`, `DELETE /users/:id` |
| Triage & assign issues client-wide | `GET /issues`, `PATCH /issues/:id/assign`, `PATCH /issues/:id/status`, `PATCH /issues/:id` |
| Manage technician coverage | `GET /technicians`, `POST /technicians/:id/assignments` |
| Client dashboard | `GET /dashboard/summary?scope=client` |

### Full cycle example A — creating a sub-zone (now with the uniqueness rule)

`POST /zones` → `{ "clientId": "c22…", "name": "Reptile House", "parentZoneId": "a…northwing" }`

Inside `zone.service.create`:
1. `requireRole` already confirmed the caller is an admin.
2. `assertInScope(clientInScope(...))` — the client must be in the admin's scope.
3. Parent-zone check — the parent must exist and share the same `clientId`.
4. **`assertUniqueName(clientId, name)`** — case-insensitive; if any zone under
   City Zoo already uses "Reptile House" (or "reptile house"), the call fails:
   ```json
   { "success": false, "code": "DUPLICATE_ZONE_NAME",
     "message": "A zone named \"Reptile House\" already exists for this client" }
   ```
   (A DB unique index `zones (client_id, lower(name))` is the race-proof backstop.)
5. Otherwise `201` with the new zone (`status: "draft"` until an incharge is assigned).

**Where used:** Web *Zone builder* — "Add zone / sub-zone" button; the created
row is inserted straight into the local tree.

### Full cycle example B — assigning a technician to an issue

`PATCH /issues/:id/assign` → `{ "technicianId": "t00…" }`

Inside `issue.service.assign → transition`:
1. Scoped `findFirst` loads the issue — a client admin can only assign issues in
   their own client (else `404`).
2. State machine check: `open`/`reopened` → `assigned` is legal (else
   `400 INVALID_TRANSITION`).
3. The technician must exist.
4. A row is appended to `issue_status_history` (nothing is overwritten).
5. `refreshMaintenanceStatus` keeps the device's `under_maintenance` flag in sync.
6. Emits `issue:updated` on the domain bus → **live** to the client/zone socket
   rooms **and** a **push** to the assigned technician (`type: issue_assigned`).

**Where used:** Web *Issues* page — "Assign technician"; disabled client-side
once `status` leaves `open`, mirroring the backend.

---

## 6. `zone_incharge` — runs one zone (and its subtree, if cascading)

**Who:** the person responsible for a zone. Scope = their assigned zone(s); if
`CASCADING_VISIBILITY=true`, also every sub-zone beneath them.
**Where used:** Flutter *zone_head* flow **and** Web *zone_officer* pages.

### What they can do

| Capability | Endpoint(s) |
| ---------- | ----------- |
| See their zone tree (from login cache) | — (uses `zoneDescendants`) |
| See their zone's devices | `GET /devices?zoneId=<own>&includeSubzones=true` |
| Raise issues | `POST /issues` |
| Update zone status | `PATCH /zones/:id/status` |
| Assign staff to their zone | `POST /zones/:id/assign` (role `staff`) |
| Confirm / reopen a resolved issue | `PATCH /issues/:id/status` (`closed` / `reopened`) |
| Submit / view daily logs | `POST /daily-logs`, `GET /daily-logs?zoneId=…` |
| Zone dashboard | `GET /dashboard/summary?scope=zone&id=<own>&includeSubzones=true` |
| Reassign a technician | `PATCH /issues/:id/assign` — **only if `INCHARGE_CAN_REASSIGN=true`** |

### Full cycle example — raising an issue

`POST /issues` →
```json
{ "deviceId": "d…", "categoryId": "e…", "priority": "high",
  "description": "Camera feed went dark this morning." }
```
Inside `issue.service.create`:
1. Loads the device **in scope** — an incharge can only raise against a device
   in a zone they hold (else `400`/`404`).
2. Rejects a `retired` device.
3. Validates the category belongs to the device's hardware type.
4. In one transaction: creates the issue (`open`), writes the first
   `issue_status_history` row, and sets the device `under_maintenance`.
5. Emits `issue:created` → live to the zone's + ancestors' + client's rooms, and
   a **push** to the client admins + the zone incharge(s).

**Response `201`** `{ data: { id, status:"open", priority:"high", createdAt } }`.
**Where used:** Flutter *Raise issue* screen (and Web *Zone issues*).

---

## 7. `zone_staff` — one zone, ground-level eyes

**Who:** day-to-day staff in a single zone. Scope = that one zone, **no**
cascade. Cannot manage assignments or confirm-close issues.
**Where used:** Flutter *zone_head* flow (shares screens with incharge; the UI
hides the incharge-only actions).

### What they can do

| Capability | Endpoint(s) |
| ---------- | ----------- |
| See their zone's devices | `GET /devices?zoneId=<own>` |
| Raise issues | `POST /issues` |
| Submit the daily status log | `POST /daily-logs` |
| See their own raised issues | `GET /issues?raisedByMe=true` |

### Full cycle example — submitting a daily log

`POST /daily-logs` →
```json
{ "deviceId": "d…", "status": "not_working", "notes": "Screen black on the wall this morning." }
```
Inside `dailyLog.service`:
1. Device loaded in scope.
2. One log per device per day — a repeat returns
   `409 ALREADY_LOGGED_TODAY` (the UI then offers the overwrite path).
3. The **faulty trend** rule: `FAULTY_THRESHOLD` (default 3) consecutive
   `not_working` logs auto-flags the device `faulty` — even with no ticket.
4. Emits `log:submitted` → live to zone dashboards.

**Response `201`** `{ data: { id, status:"not_working", logDate:"2026-09-01" } }`.
**Where used:** Flutter *Daily log* screen — one selector per device.

---

## 8. `technician` — receives and resolves issues

**Who:** the field engineer. Scope = their `technician_assignments` coverage
(client- or zone-level, subtree-expanded) **plus** any issue assigned to them.
**Where used:** Flutter *technician* flow (Issue queue, Issue detail).

### What they can do

| Capability | Endpoint(s) |
| ---------- | ----------- |
| See their work queue | `GET /issues?scope=technician&status=assigned,in_progress` |
| Open an issue's detail + history | `GET /issues/:id`, `GET /issues/:id/history` |
| Drive the issue forward | `PATCH /issues/:id/status` (`in_progress`, `on_hold`, `resolved`) |
| Register for push | `POST /auth/device-token` |

They **cannot** jump to `closed` — that's the raiser/incharge's confirmation
step (`400 INVALID_TRANSITION` if attempted).

### Full cycle example — working a ticket

1. **Queue:** `GET /issues?scope=technician&status=assigned,in_progress` — the
   service forces `assignedTechnicianId = self` from the token's `technicianId`,
   so a technician only ever sees their own queue.
2. **Start work:** `PATCH /issues/:id/status` → `{ "status": "in_progress" }` →
   `200`. Appends history, emits `issue:updated`, pushes the raiser/incharge.
3. **Resolve:** `PATCH /issues/:id/status` → `{ "status": "resolved" }` → sets
   `resolved_at`, notifies the raiser + incharge to confirm.
4. The raiser/incharge then **confirms** (`closed`, device → `active`) or
   **disputes** (`reopened`, back to the technician).

**Where used:** Flutter *Issue queue* → *Issue detail*; a push
(`type: issue_assigned`, `issueId`) deep-links straight into detail.

---

## 9. Cross-cutting: realtime + push (all roles)

Every mutating call above also emits a **domain event** consumed by two layers
(see `SCREEN_API_FLOW.md` §0 for the full contract):

- **Socket.IO** — the caller's zone/client/platform rooms get `issue:created`,
  `issue:updated`, `log:submitted` live. Rooms are server-derived from identity;
  technicians join their `technician_assignments` rooms.
- **Push (FCM)** — resolved per event to the right people (created → admins +
  incharge; assigned → technician; resolved → raiser + incharge; etc.). Incharge
  pushes honor `CASCADING_VISIBILITY`.

---

## 10. Appendix — endpoint → who may call it

"Scoped" = any authenticated user may call it, but results/writes are filtered to
their `req.scope`. "Role-gated" = a hard `requireRole` on the route.

| Endpoint | Gate |
| -------- | ---- |
| `POST /auth/*` | public |
| `/companies/*` | **super_admin** |
| `/clients/*` | **super_admin, company_admin** |
| `POST /verticals` | **super_admin** · `PATCH /client-verticals` → **super_admin, company_admin** |
| `POST/PATCH/DELETE /users` | **super_admin, company_admin, client_admin** (`GET` scoped) |
| `POST/PATCH /devices`, `/devices/:id/status` | **super_admin, company_admin, client_admin** (`GET` scoped) |
| `POST /zones`, tree edits | **super_admin, company_admin, client_admin** (assign/status also incharge via scope) |
| `/issues/*`, `/daily-logs/*`, `/technicians/*`, `/hardware-types`, `/issue-categories`, `/dashboard` | **scoped** (filtered by role) |

> Reminder: the role gate is coarse. The real "who sees what" is the **scope**
> layer — a client_admin and a zone_staff hit the same `GET /issues`, but the
> `where` the scope injects makes them see completely different rows.
