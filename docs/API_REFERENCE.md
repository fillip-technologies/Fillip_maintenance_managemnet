# Maintenance Management API — Full Reference

Complete request/response documentation for the Node.js + Express + Prisma + PostgreSQL
maintenance-management API. Every endpoint below lists its method, path, auth requirement,
request shape (params / query / body), an example request, an example response, side
effects, and the errors it can return.

- **Base URL:** `http://localhost:3000/api/v1`
- **Content type:** `application/json` (request and response)
- **Auth:** JWT Bearer access token on every route except `POST /auth/login`,
  `POST /auth/refresh`, `POST /auth/logout`, and `/health/*`.

---

## Table of contents

1. [Conventions](#1-conventions)
2. [Authentication & tokens](#2-authentication--tokens)
3. [Roles](#3-roles)
4. [Global middleware & limits](#4-global-middleware--limits)
5. [Errors](#5-errors)
6. [Health](#6-health)
7. [Auth](#7-auth)
8. [Companies](#8-companies)
9. [Clients](#9-clients)
10. [Verticals & Client-Verticals](#10-verticals--client-verticals)
11. [Users](#11-users)
12. [Zones](#12-zones)
13. [Hardware Types & Issue Categories](#13-hardware-types--issue-categories)
14. [Devices](#14-devices)
15. [Issues](#15-issues)
16. [Daily Logs](#16-daily-logs)
17. [Technicians](#17-technicians)
18. [Dashboard](#18-dashboard)
19. [Realtime (Socket.IO)](#19-realtime-socketio)
    - [19a. Push notifications (FCM)](#19a-push-notifications-firebase-cloud-messaging)
20. [State machines reference](#20-state-machines-reference)

---

## 1. Conventions

### Response envelope

Every response uses one of three shapes.

**Success (single object):**
```json
{ "success": true, "data": { "...": "..." } }
```

**Success (list):** paginated collections wrap items plus pagination meta:
```json
{
  "success": true,
  "data": {
    "items": [ { "...": "..." } ],
    "page": 1,
    "limit": 20,
    "totalItems": 42,
    "totalPages": 3
  }
}
```

**Error:**
```json
{ "success": false, "code": "NOT_FOUND", "message": "Resource not found", "details": [ ] }
```
- `details` is present only on validation errors and some conflicts.
- In non-production, error responses also include a `stack` field.

### Pagination

All list endpoints accept:

| Query param | Type | Default | Notes |
| ----------- | ---- | ------- | ----- |
| `page`      | int  | `1`     | 1-based, must be positive |
| `limit`     | int  | `20`    | positive, max `100` |

> The two "flat lookup" lists — `GET /verticals` and `GET /issue-categories` — return the
> whole set in one page (`page: 1`, `limit` = item count) and ignore `page`/`limit`.

### HTTP status codes

| Status | When |
| ------ | ---- |
| `200 OK` | Successful read, update, delete, or action |
| `201 Created` | Successful `POST` that creates a resource |
| `204 No Content` | Successful hard `DELETE` (empty body) |
| `400 Bad Request` | Validation failure, illegal state transition, bad reference |
| `401 Unauthorized` | Missing/invalid access token, bad credentials |
| `403 Forbidden` | Authenticated but wrong role / suspended account |
| `404 Not Found` | Resource does not exist, or unknown route |
| `409 Conflict` | Uniqueness / dependency conflict (e.g. duplicate assignment) |
| `429 Too Many Requests` | Rate limit exceeded |
| `500 Internal Server Error` | Unexpected error |

---

## 2. Authentication & tokens

The API uses **JWT access tokens** plus **rotating opaque refresh tokens**.

- **Access token** — a signed JWT, TTL `15m` by default (`ACCESS_TOKEN_TTL`). Sent on every
  protected request as `Authorization: Bearer <accessToken>`. Its claims populate `req.user`:
  `{ id, role, companyId, clientId, technicianId }`.
- **Refresh token** — a 96-char random hex string, TTL `30` days by default
  (`REFRESH_TOKEN_TTL_DAYS`). Only its SHA-256 hash is stored server-side. Exchanged at
  `POST /auth/refresh`, which **rotates** it: the presented token is revoked and a new pair
  is issued.

**Typical flow**
1. `POST /auth/login` → `{ accessToken, refreshToken, user, zoneDescendants, zoneAncestors }`.
2. Call protected routes with `Authorization: Bearer <accessToken>`.
3. On `401 TOKEN_INVALID` (expired access token), call `POST /auth/refresh` with the refresh
   token to get a fresh pair.
4. `POST /auth/logout` revokes the refresh token.

Header for all protected requests:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 3. Roles

`UserRole` enum: `super_admin`, `company_admin`, `client_admin`, `zone_incharge`,
`zone_staff`, `technician`.

Route-level role guards currently enforced:

| Route group | Allowed roles |
| ----------- | ------------- |
| `/companies/*` | `super_admin` |
| `/clients/*` | `super_admin`, `company_admin` |
| `POST/PATCH/DELETE /users/*` | `super_admin`, `company_admin`, `client_admin` |
| `POST /verticals` | `super_admin` |
| `PATCH /client-verticals` | `super_admin`, `company_admin` |
| everything else | any authenticated user |

`accountStatus` (`invited`, `active`, `suspended`, `removed`) gates login: `suspended` and
`removed` accounts are refused; `invited` flips to `active` on first successful login.

---

## 4. Global middleware & limits

Applied in `src/app.js` to every request:

- **Helmet** security headers; `x-powered-by` disabled.
- **CORS** — origin from `CORS_ORIGIN` (default `*`), `credentials: true`.
- **Compression** (gzip).
- **Body limit** — `1mb` for both JSON and URL-encoded bodies. Larger bodies → `413`.
- **Request id** — every response carries `x-request-id` (echoes an inbound
  `x-request-id` header if provided, otherwise a generated UUID).
- **Rate limiting** — applies to `/api/*` only (health checks exempt). Default `100`
  requests per `15 min` window per IP (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`). Standard
  `RateLimit-*` headers are returned; exceeding it → `429`.

---

## 5. Errors

Errors always use the error envelope. Common machine `code`s:

| `code` | Status | Meaning |
| ------ | ------ | ------- |
| `VALIDATION_ERROR` | 400 | Body/query/params failed Zod validation. `details` lists `{ path, message }`. |
| `BAD_REQUEST` | 400 | Bad reference or domain rule violation |
| `INVALID_TRANSITION` | 400 | Illegal issue status transition |
| `UNAUTHORIZED` | 401 | Missing/malformed Authorization header |
| `TOKEN_INVALID` | 401 | Access token invalid or expired |
| `INVALID_CREDENTIALS` | 401 | Wrong email/password on login |
| `REFRESH_INVALID` | 401 | Refresh token missing, revoked, or expired |
| `FORBIDDEN` | 403 | Wrong role, or suspended/removed account |
| `NOT_FOUND` | 404 | Resource or route not found |
| `CONFLICT` | 409 | Uniqueness/dependency conflict |
| `DUPLICATE_ASSIGNMENT` | 409 | User already has that active zone assignment |
| `DUPLICATE_ZONE_NAME` | 409 | Another zone under the same client already has that name (case-insensitive) |
| `ALREADY_LOGGED_TODAY` | 409 | A daily log for that device/day already exists |
| `DB_REQUEST_ERROR` | 400 | Unmapped database error |
| `INTERNAL_ERROR` | 500 | Unexpected error |

**Validation error example**
```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Validation failed",
  "details": [
    { "path": "body.email", "message": "Invalid email" },
    { "path": "body.password", "message": "String must contain at least 1 character(s)" }
  ]
}
```

---

## 6. Health

Unauthenticated, rate-limit exempt. Base path `/health` (not under `/api/v1`).

### `GET /health/live`
Liveness — process is up. No dependencies.

**Response `200`**
```json
{ "status": "ok", "uptime": 128.42 }
```

### `GET /health/ready`
Readiness — runs `SELECT 1` against the DB.

**Response `200`**
```json
{ "status": "ok", "db": "connected" }
```
Returns `500` if the database is unreachable.

---

## 7. Auth

Base path `/api/v1/auth`.

### `POST /auth/login` — public

Authenticate with email + password. Returns tokens, a compact user object, and the primary
zone subtree/ancestor path (for zone-scoped users; empty arrays otherwise).

**Body**
| Field | Type | Required | Notes |
| ----- | ---- | -------- | ----- |
| `email` | string (email) | yes | trimmed, lowercased |
| `password` | string | yes | min length 1 |

**Request**
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"priya@cityzoo.com","password":"Password123!"}'
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "9f3c...48hexchars...e21",
    "user": {
      "id": "6d2b1f0e-8c4a-4a1e-9b23-0f5c2a7d1e90",
      "name": "Priya Sharma",
      "role": "zone_incharge",
      "clientId": "b1a2c3d4-...",
      "zoneId": "f0e1d2c3-..."
    },
    "zoneDescendants": [
      { "id": "f0e1d2c3-...", "name": "North Wing", "parentZoneId": null, "status": "active", "depth": 0 },
      { "id": "aa11bb22-...", "name": "Enclosure A", "parentZoneId": "f0e1d2c3-...", "status": "active", "depth": 1 }
    ],
    "zoneAncestors": [
      { "id": "f0e1d2c3-...", "name": "North Wing", "depth": 0 }
    ]
  }
}
```

**Side effects:** creates a refresh-token row; flips an `invited` account to `active`.

**Errors:** `401 INVALID_CREDENTIALS` (unknown email or wrong password — deliberately
uniform), `403` (account suspended / removed).

---

### `POST /auth/refresh` — public

Rotate tokens. Revokes the presented refresh token and issues a new pair.

**Body**
| Field | Type | Required |
| ----- | ---- | -------- |
| `refreshToken` | string | yes |

**Request**
```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"9f3c...e21"}'
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...new...",
    "refreshToken": "7a2d...new96hex...c19"
  }
}
```

**Errors:** `401 REFRESH_INVALID` (unknown, already revoked, or expired token).

---

### `POST /auth/logout` — public

Revoke a refresh token. Idempotent — always succeeds even if the token was already revoked
or unknown.

**Body:** `{ "refreshToken": "..." }`

**Response `200`**
```json
{ "success": true, "data": { "loggedOut": true } }
```

---

### `GET /auth/me` — authenticated

Return the identity claims decoded from the access token (no DB read).

**Request**
```bash
curl http://localhost:3000/api/v1/auth/me -H "Authorization: Bearer <accessToken>"
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "id": "6d2b1f0e-...",
    "role": "zone_incharge",
    "companyId": null,
    "clientId": "b1a2c3d4-...",
    "technicianId": null
  }
}
```

---

### `POST /auth/device-token` — authenticated

Register (upsert) an FCM/APNs device token for push notifications.

**Body**
| Field | Type | Required | Notes |
| ----- | ---- | -------- | ----- |
| `token` | string | yes | 1–512 chars |
| `platform` | enum | yes | `android` \| `ios` \| `web` |

**Request**
```bash
curl -X POST http://localhost:3000/api/v1/auth/device-token \
  -H "Authorization: Bearer <accessToken>" -H "Content-Type: application/json" \
  -d '{"token":"fcm-abc123","platform":"android"}'
```

**Response `200`**
```json
{ "success": true, "data": { "saved": true } }
```

---

## 8. Companies

Base path `/api/v1/companies`. **`super_admin` only.**

**Company object**
```json
{
  "id": "uuid",
  "name": "CityZoo Holdings",
  "status": "active",
  "createdAt": "2026-08-01T09:00:00.000Z",
  "updatedAt": "2026-08-01T09:00:00.000Z"
}
```

### `GET /companies`
**Query:** `page`, `limit`, `search` (matches name, case-insensitive).

**Response `200`** — list envelope of company objects.
```json
{
  "success": true,
  "data": {
    "items": [ { "id": "uuid", "name": "CityZoo Holdings", "status": "active", "createdAt": "...", "updatedAt": "..." } ],
    "page": 1, "limit": 20, "totalItems": 1, "totalPages": 1
  }
}
```

### `POST /companies`
**Body:** `name` (1–160, required), `status` (`active`|`inactive`, optional, default `active`).

**Response `201`** — the created company object.

### `GET /companies/:id`
**Response `200`** — the company object. `404` if not found.

### `PATCH /companies/:id`
**Body:** at least one of `name`, `status`.
**Response `200`** — the updated company object.

### `DELETE /companies/:id`
Hard delete, **but refused** while the company still has clients or users.

**Response `204 No Content`** — empty body on success.
**Errors:** `409 CONFLICT` "Cannot delete a company that still has clients or users".

---

## 9. Clients

Base path `/api/v1/clients`. **`super_admin` or `company_admin`.**

**Client object**
```json
{
  "id": "uuid",
  "companyId": "uuid",
  "name": "City Zoo — Main Park",
  "type": "zoo",
  "createdAt": "...",
  "updatedAt": "..."
}
```

### `GET /clients`
**Query:** `page`, `limit`, `search`, `companyId` (uuid filter).
**Response `200`** — list of client objects.

### `POST /clients`
**Body:** `companyId` (uuid, required), `name` (1–160, required), `type` (≤60, optional).
**Response `201`** — created client.
**Errors:** `400` if `companyId` references a non-existent company.

### `GET /clients/:id`
**Response `200`** — client object. `404` if missing.

### `PATCH /clients/:id`
**Body:** at least one of `companyId`, `name`, `type` (nullable).
**Response `200`** — updated client.

### `DELETE /clients/:id`
Refused while the client still has zones/users (dependency guard).
**Response `204 No Content`** on success, or `409 CONFLICT` if dependents exist.

---

## 10. Verticals & Client-Verticals

Feature toggles a client can switch on (e.g. hardware, CCTV).

### `GET /verticals` — authenticated
Full catalogue (single page).

**Response `200`**
```json
{
  "success": true,
  "data": {
    "items": [
      { "id": "uuid", "key": "cctv", "name": "CCTV", "createdAt": "..." },
      { "id": "uuid", "key": "hardware", "name": "Hardware", "createdAt": "..." }
    ],
    "page": 1, "limit": 2, "totalItems": 2, "totalPages": 1
  }
}
```

### `POST /verticals` — `super_admin`
**Body:** `key` (1–60), `name` (1–120).
**Response `201`** — created vertical.

### `GET /client-verticals` — authenticated
List the vertical toggles for one client.
**Query:** `clientId` (uuid, **required**).

**Response `200`**
```json
{
  "success": true,
  "data": [
    { "id": "uuid", "clientId": "uuid", "verticalId": "uuid", "active": true, "vertical": { "id": "uuid", "key": "cctv", "name": "CCTV" } }
  ]
}
```

### `PATCH /client-verticals` — `super_admin` or `company_admin`
Toggle a vertical on/off for a client (upsert).
**Body:** `clientId` (uuid), `verticalId` (uuid), `active` (boolean).

**Response `200`** — the upserted client-vertical row.

---

## 11. Users

Base path `/api/v1/users`. Reads are open to any authenticated user; **create/update/delete
require `super_admin`, `company_admin`, or `client_admin`.** Passwords are bcrypt-hashed and
never returned.

**User object (public select)**
```json
{
  "id": "uuid",
  "email": "priya@cityzoo.com",
  "name": "Priya Sharma",
  "role": "zone_incharge",
  "accountStatus": "active",
  "companyId": null,
  "clientId": "uuid",
  "createdAt": "...",
  "updatedAt": "..."
}
```

### `GET /users`
**Query:** `page`, `limit`, `search` (email or name), `clientId`, `companyId`, `role`.
**Response `200`** — list of user objects.

### `POST /users` — admin
**Body**
| Field | Type | Required | Notes |
| ----- | ---- | -------- | ----- |
| `email` | string (email) | yes | ≤200, lowercased |
| `name` | string | yes | 1–120 |
| `role` | UserRole enum | yes | |
| `password` | string | no | 8–128; if omitted the user is `invited` with no password |
| `companyId` | uuid | no | |
| `clientId` | uuid | no | |
| `accountStatus` | enum | no | defaults to `invited` |

**Response `201`** — the created user (public select).
**Errors:** `409 CONFLICT` if the email already exists.

### `GET /users/:id`
**Response `200`** — user object. `404` if missing.

### `PATCH /users/:id` — admin
**Body:** at least one of `email`, `name`, `role`, `accountStatus`, `companyId` (nullable),
`clientId` (nullable).
**Response `200`** — updated user.

### `DELETE /users/:id` — admin
**Soft-remove** — sets `accountStatus: "removed"` (never hard-deleted, so their authored
issues/logs keep the name).
**Response `200`** — the user object with `accountStatus: "removed"`.

---

## 12. Zones

Base path `/api/v1/zones`. Self-referencing tree of unlimited depth. Any authenticated user.

**Zone object (list includes `_count`)**
```json
{
  "id": "uuid",
  "clientId": "uuid",
  "parentZoneId": null,
  "name": "North Wing",
  "status": "active",
  "createdById": "uuid",
  "createdAt": "...",
  "updatedAt": "...",
  "_count": { "children": 2, "devices": 5 }
}
```

### `GET /zones`
**Query:** `page`, `limit`, `clientId`, `parentZoneId`, `topLevel` (`true`|`false` — `true`
filters to root zones), `status` (`draft`|`active`|`inactive`), `search`.
**Response `200`** — list of zones with `_count`.

### `POST /zones`
**Body**
| Field | Type | Required | Notes |
| ----- | ---- | -------- | ----- |
| `clientId` | uuid | yes | |
| `parentZoneId` | uuid | no | sub-zone must share the parent's `clientId` |
| `name` | string | yes | 1–120; **unique per client, case-insensitive** (a zone and a sub-zone under the same client may not share a name) |
| `createdById` | uuid | no | normally derived from the token |

**Response `201`** — created zone (status defaults to `draft`).
**Errors:** `400` if the parent doesn't exist or belongs to a different client;
`409 DUPLICATE_ZONE_NAME` if another zone under the same client already has that
name (case-insensitive). `PATCH /zones/:id` returns the same `409` on rename.

### `GET /zones/:id`
Returns the zone with immediate `children`, active `assignments` (incl. user), and device
count.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "id": "uuid", "clientId": "uuid", "parentZoneId": null, "name": "North Wing",
    "status": "active", "createdById": "uuid", "createdAt": "...", "updatedAt": "...",
    "children": [ { "id": "uuid", "name": "Enclosure A", "status": "active" } ],
    "assignments": [
      { "id": "uuid", "zoneId": "uuid", "userId": "uuid", "role": "incharge", "assignedAt": "...", "unassignedAt": null,
        "user": { "id": "uuid", "name": "Priya Sharma", "email": "priya@cityzoo.com", "role": "zone_incharge" } }
    ],
    "_count": { "devices": 5 }
  }
}
```

### `GET /zones/:id/descendants`
Full subtree (including the zone itself), depth-annotated, ordered by depth then name.

**Response `200`**
```json
{
  "success": true,
  "data": [
    { "id": "uuid", "name": "North Wing", "parentZoneId": null, "status": "active", "depth": 0 },
    { "id": "uuid", "name": "Enclosure A", "parentZoneId": "uuid", "status": "active", "depth": 1 }
  ]
}
```

### `PATCH /zones/:id`
**Body:** at least one of `name`, `parentZoneId` (nullable). Re-parenting validates the new
parent exists, shares the client, and isn't the zone itself.
**Response `200`** — updated zone.

### `PATCH /zones/:id/status`
Lifecycle transition. **Zones are archived here, not hard-deleted.**
**Body:** `status` (`draft`|`active`|`inactive`).
Allowed transitions: `draft→active`, `active→inactive`, `inactive→active`.
**Response `200`** — updated zone. **Errors:** `400` on an illegal transition.

### Zone assignments

#### `GET /zones/:id/assignments`
Active (`unassignedAt: null`) assignments for the zone.
**Response `200`**
```json
{
  "success": true,
  "data": [
    { "id": "uuid", "zoneId": "uuid", "userId": "uuid", "role": "staff", "assignedAt": "...", "unassignedAt": null,
      "user": { "id": "uuid", "name": "Ravi", "email": "ravi@cityzoo.com", "role": "zone_staff" } }
  ]
}
```

#### `POST /zones/:id/assign`
Assign a user as `incharge` or `staff`. Assigning an **incharge to a draft zone activates
it**. Returns the refreshed zone with active assignments.
**Body:** `userId` (uuid), `role` (`incharge`|`staff`).
**Response `201`** — zone with `assignments`.
**Errors:** `409 DUPLICATE_ASSIGNMENT` if that active (zone, user, role) already exists;
`404` if the zone is missing.

#### `DELETE /zones/:id/assignments/:assignmentId`
Soft-unassign — sets `unassignedAt` (history preserved; the row is not deleted).
**Response `204 No Content`** — empty body.
**Errors:** `404` if no matching active assignment.

---

## 13. Hardware Types & Issue Categories

### Hardware Types — base path `/api/v1/hardware-types`, any authenticated user

**HardwareType object**
```json
{
  "id": "uuid",
  "name": "IP Camera",
  "specFields": { "resolution": "string", "ip": "string" },
  "createdAt": "..."
}
```

#### `GET /hardware-types`
**Query:** `page`, `limit`, `search`.
**Response `200`** — list of hardware types.

#### `POST /hardware-types`
**Body:** `name` (1–80, unique), `specFields` (object, default `{}`).
**Response `201`** — created hardware type. `409` on duplicate name.

#### `GET /hardware-types/:id`
**Response `200`** — hardware type (typically with its `issueCategories`). `404` if missing.

#### `PATCH /hardware-types/:id`
**Body:** at least one of `name`, `specFields`.
**Response `200`** — updated hardware type.

#### `DELETE /hardware-types/:id`
**Response `204 No Content`** — empty body.

#### `POST /hardware-types/:id/categories`
Add an issue category under this hardware type.
**Body:** `name` (1–100).
**Response `201`**
```json
{ "success": true, "data": { "id": "uuid", "hardwareTypeId": "uuid", "name": "No power" } }
```

#### `DELETE /hardware-types/:id/categories/:categoryId`
Remove a category.
**Response `204 No Content`** — empty body.

### Issue Categories — base path `/api/v1/issue-categories`, any authenticated user

Flat lookup used to populate the "raise issue" category dropdown.

#### `GET /issue-categories`
**Query:** `hardwareTypeId` (uuid, optional). Without it, returns all categories.
**Response `200`** (single-page list, ordered by name)
```json
{
  "success": true,
  "data": {
    "items": [
      { "id": "uuid", "hardwareTypeId": "uuid", "name": "No power" },
      { "id": "uuid", "hardwareTypeId": "uuid", "name": "No signal" }
    ],
    "page": 1, "limit": 2, "totalItems": 2, "totalPages": 1
  }
}
```

---

## 14. Devices

Base path `/api/v1/devices`. Any authenticated user. **Devices are never hard-deleted —
retire them via status.** `under_maintenance` and `faulty` are set automatically by the
issue and daily-log flows, not through the status endpoint.

**Device object (with flattened `zoneName`)**
```json
{
  "id": "uuid",
  "zoneId": "uuid",
  "hardwareTypeId": "uuid",
  "name": "Cam-01",
  "location": "Gate 3",
  "installDate": "2026-01-15T00:00:00.000Z",
  "status": "active",
  "isManualEntry": false,
  "customSpec": null,
  "addedById": "uuid",
  "createdAt": "...",
  "updatedAt": "...",
  "zone": { "id": "uuid", "name": "Enclosure A", "clientId": "uuid" },
  "hardwareType": { "id": "uuid", "name": "IP Camera" },
  "zoneName": "Enclosure A"
}
```

### `GET /devices`
**Query:** `page`, `limit`, `zoneId`, `includeSubzones` (`true`|`false` — widen to subtree),
`status` (`provisioned`|`active`|`under_maintenance`|`faulty`|`retired`), `search` (name).
**Response `200`** — list of device objects.

### `POST /devices`
**Body**
| Field | Type | Required | Notes |
| ----- | ---- | -------- | ----- |
| `zoneId` | uuid | yes | |
| `hardwareTypeId` | uuid | conditional | required **unless** `isManualEntry` is `true` |
| `name` | string | yes | 1–120 |
| `location` | string | no | ≤200 |
| `installDate` | date | no | ISO date |
| `isManualEntry` | boolean | no | default `false` |
| `customSpec` | object | no | |
| `addedById` | uuid | no | normally from the token |

**Response `201`** — created device (status defaults to `provisioned`).
**Errors:** `400 VALIDATION_ERROR` if `hardwareTypeId` is missing while `isManualEntry` is
false.

### `GET /devices/:id`
**Response `200`** — device object. `404` if missing.

### `PATCH /devices/:id`
**Body:** at least one of `name`, `location` (nullable), `installDate` (nullable),
`hardwareTypeId` (nullable), `customSpec` (nullable).
**Response `200`** — updated device.

### `PATCH /devices/:id/status`
Manual transition only.
**Body:** `status` (`active` | `retired`).
Allowed manual transitions: `provisioned→active|retired`, `active→retired`,
`under_maintenance→retired`, `faulty→active|retired`. `retired` is terminal.
**Response `200`** — updated device. **Errors:** `400` on an illegal transition.

---

## 15. Issues

Base path `/api/v1/issues`. Any authenticated user. Core state machine; every transition is
recorded in status history and re-syncs the device's maintenance status.

**Issue object (detail select)**
```json
{
  "id": "uuid",
  "deviceId": "uuid",
  "categoryId": "uuid",
  "raisedByUserId": "uuid",
  "assignedTechnicianId": "uuid",
  "priority": "high",
  "status": "assigned",
  "description": "No power to camera",
  "createdAt": "...",
  "updatedAt": "...",
  "resolvedAt": null,
  "closedAt": null,
  "device": { "id": "uuid", "name": "Cam-01", "zoneId": "uuid", "hardwareTypeId": "uuid" },
  "category": { "id": "uuid", "name": "No power" },
  "raisedBy": { "id": "uuid", "name": "Priya Sharma", "email": "priya@cityzoo.com" },
  "assignedTechnician": { "id": "uuid", "specialization": "electrical", "user": { "id": "uuid", "name": "Sam Tech" } }
}
```

### `GET /issues`
**Query:** `page`, `limit`, `deviceId`, `zoneId`, `includeSubzones` (`true`|`false`),
`status` (comma-separated, e.g. `assigned,in_progress`), `priority`,
`assignedTechnicianId`, `raisedByMe` (`true` → only issues I raised), `scope=technician`
(→ only issues assigned to me as a technician).
Ordered by priority desc, then newest first.
**Response `200`** — list of issue objects.
**Errors:** `403` if `scope=technician` but the caller isn't a technician.

### `POST /issues`
Raise an issue. **Side effect: puts the device into `under_maintenance`** and writes an
`open` history row (in one transaction), then emits `issue:created`.
**Body**
| Field | Type | Required | Notes |
| ----- | ---- | -------- | ----- |
| `deviceId` | uuid | yes | must exist and not be `retired` |
| `categoryId` | uuid | yes | must belong to the device's hardware type (if set) |
| `raisedByUserId` | uuid | no | normally from the token |
| `priority` | enum | no | `low`\|`medium`\|`high`\|`critical`, default `medium` |
| `description` | string | yes | non-empty |

**Response `201`** — the created issue (detail select), `status: "open"`.
**Errors:** `400` if the device/category doesn't exist, the device is retired, or the
category's hardware type doesn't match the device's.

### `GET /issues/:id`
Issue with full `statusHistory` (each entry includes who changed it).
**Response `200`**
```json
{
  "success": true,
  "data": {
    "id": "uuid", "status": "in_progress", "priority": "high", "...": "...",
    "statusHistory": [
      { "id": "uuid", "fromStatus": null, "toStatus": "open", "changedAt": "...", "notes": null, "changedBy": { "id": "uuid", "name": "Priya" } },
      { "id": "uuid", "fromStatus": "open", "toStatus": "assigned", "changedAt": "...", "notes": null, "changedBy": { "id": "uuid", "name": "Priya" } }
    ]
  }
}
```

### `PATCH /issues/:id`
Edit details only (not status).
**Body:** at least one of `priority`, `description`.
**Response `200`** — updated issue.

### `GET /issues/:id/history`
Just the ordered status-history array.
**Response `200`**
```json
{
  "success": true,
  "data": [
    { "id": "uuid", "issueId": "uuid", "fromStatus": null, "toStatus": "open", "changedByUserId": "uuid", "changedAt": "...", "notes": null, "changedBy": { "id": "uuid", "name": "Priya" } }
  ]
}
```

### `PATCH /issues/:id/status`
Walk the issue through the state machine.
**Body:** `status` (any issue status **except `open`**), `notes` (optional),
`changedByUserId` (optional, normally from token).
Timestamps: `resolved` sets `resolvedAt`; `closed` sets `closedAt`; `reopened` clears both.
Each call appends a history row and re-syncs device status (closing the last open issue
returns the device to `active`). Emits `issue:updated`.
**Response `200`** — updated issue.
**Errors:** `400 INVALID_TRANSITION` for an illegal jump (the `details` list the allowed
next states).

### `PATCH /issues/:id/assign`
Assign or reassign a technician (moves `open`/`reopened` → `assigned`).
**Body:** `technicianId` (uuid), `notes` (optional), `changedByUserId` (optional).
**Response `200`** — updated issue with `assignedTechnician`.
**Errors:** `400` if the technician doesn't exist or the transition is illegal.

---

## 16. Daily Logs

Base path `/api/v1/daily-logs`. Any authenticated user. **One log per device per calendar
day** (UTC). Dates are normalized to UTC midnight.

**Daily-log object (flattened)**
```json
{
  "id": "uuid",
  "deviceId": "uuid",
  "loggedByUserId": "uuid",
  "status": "working",
  "logDate": "2026-08-31T00:00:00.000Z",
  "notes": "All good",
  "createdAt": "...",
  "device": { "id": "uuid", "name": "Cam-01", "zoneId": "uuid" },
  "loggedBy": { "id": "uuid", "name": "Ravi" },
  "deviceName": "Cam-01",
  "loggedByName": "Ravi"
}
```

### `GET /daily-logs`
**Query:** `page`, `limit`, `deviceId`, `zoneId`, `includeSubzones` (`true`|`false`),
`date` (single day), `from` / `to` (inclusive date range). Ordered newest first.
**Response `200`** — list of daily-log objects.

### `POST /daily-logs`
Submit today's (or a given day's) status for a device.
**Body**
| Field | Type | Required | Notes |
| ----- | ---- | -------- | ----- |
| `deviceId` | uuid | yes | must exist and not be `retired` |
| `status` | enum | yes | `working`\|`not_working`\|`needs_attention` |
| `loggedByUserId` | uuid | no | normally from the token |
| `logDate` | date | no | defaults to today (UTC) |
| `notes` | string | no | |
| `overwrite` | boolean | no | default `false`; `true` replaces an existing same-day log |

**Side effects:** if the last `FAULTY_THRESHOLD` (default 3) logs for an `active` device are
all `not_working`, the device is auto-flagged `faulty`. Emits `log:submitted`.
**Response `201`** — the created (or overwritten) log row.
**Errors:** `409 ALREADY_LOGGED_TODAY` if a same-day log exists and `overwrite` is false;
`400` if the device is missing or retired.

---

## 17. Technicians

Base path `/api/v1/technicians`. Any authenticated user.

**Technician object**
```json
{
  "id": "uuid",
  "userId": "uuid",
  "specialization": "electrical",
  "createdAt": "...",
  "user": { "id": "uuid", "name": "Sam Tech", "email": "sam@cityzoo.com" }
}
```

### `GET /technicians`
**Query:** `page`, `limit`, `search`.
**Response `200`** — list of technicians.

### `POST /technicians`
Promote a user to a technician profile.
**Body:** `userId` (uuid, unique per user), `specialization` (≤100, optional).
**Response `201`** — created technician. `409` if the user is already a technician.

### `GET /technicians/:id`
**Response `200`** — technician (typically with coverage assignments). `404` if missing.

### `PATCH /technicians/:id`
**Body:** `specialization` (string or `null`).
**Response `200`** — updated technician.

### `DELETE /technicians/:id`
**Response `204 No Content`** — empty body.

### `POST /technicians/:id/assignments`
Add a coverage assignment. **At least one of `clientId` / `zoneId` is required.**
**Body:** `clientId` (uuid, optional), `zoneId` (uuid, optional).
**Response `201`**
```json
{ "success": true, "data": { "id": "uuid", "technicianId": "uuid", "clientId": "uuid", "zoneId": null } }
```
**Errors:** `400 VALIDATION_ERROR` if neither `clientId` nor `zoneId` is provided.

### `DELETE /technicians/:id/assignments/:assignmentId`
Remove a coverage assignment.
**Response `204 No Content`** — empty body.

---

## 18. Dashboard

Base path `/api/v1/dashboard`. Any authenticated user.

### `GET /dashboard/summary`
Aggregate counts for a scope.
**Query**
| Param | Type | Required | Notes |
| ----- | ---- | -------- | ----- |
| `scope` | enum | yes | `zone` \| `client` \| `platform` |
| `id` | uuid | conditional | required for `zone` and `client` scopes |
| `includeSubzones` | enum | no | `true`\|`false`, only meaningful for `zone` scope |

**Request**
```bash
curl "http://localhost:3000/api/v1/dashboard/summary?scope=zone&id=<zoneId>&includeSubzones=true" \
  -H "Authorization: Bearer <accessToken>"
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "openIssues": 4,
    "faultyDevices": 1,
    "devicesMissingTodayLog": 7,
    "totalDevices": 25
  }
}
```
- `totalDevices` / `faultyDevices` exclude retired devices where relevant.
- `devicesMissingTodayLog` counts non-retired devices with no log dated today (UTC).
- `openIssues` counts issues in any non-`closed` state.

**Errors:** `400` if `id` is missing for `zone`/`client` scope.

### `GET /dashboard/overview`
Platform-wide aggregate backing the **super_admin** overview page — one call for
the whole dashboard (tenancy, device fleet, work orders, alerts, technicians,
client facilities, recent activity). **`super_admin` only** (`403` otherwise).

**Request**
```bash
curl "http://localhost:3000/api/v1/dashboard/overview" \
  -H "Authorization: Bearer <accessToken>"
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "tenancy":   { "companies": 13, "activeCompanies": 13, "clients": 13, "zones": 30, "activeZones": 21, "users": 34, "technicians": 10 },
    "devices":   { "total": 30, "working": 11, "underMaintenance": 4, "faulty": 0, "provisioned": 15, "retired": 0, "missingTodayLog": 27 },
    "byHardwareType": [ { "hardwareTypeId": "…", "name": "CCTV camera", "total": 4, "working": 2, "underMaintenance": 1, "faulty": 0 } ],
    "issues":    { "total": 37, "open": 35, "byStatus": { "open": 20, "assigned": 6, "in_progress": 0, "on_hold": 0, "resolved": 9, "closed": 2, "reopened": 0 }, "byPriority": { "low": 10, "medium": 11, "high": 10, "critical": 4 }, "createdToday": 37, "resolvedToday": 11, "closedToday": 2 },
    "criticalAlerts": [ { "id": "…", "title": "…", "priority": "critical", "status": "open", "deviceName": "…", "zoneName": "…", "clientName": "…", "assignedTo": null, "createdAt": "…" } ],
    "technicians": { "total": 10, "busy": 10, "idle": 0, "top": [ { "id": "…", "name": "Amit Shah", "specialization": "CCTV / networking", "openAssigned": 4 } ] },
    "facilities": [ { "clientId": "…", "name": "City Zoo", "companyName": "Acme Facilities Group", "zones": 9, "devices": 9, "faultyDevices": 0, "openIssues": 17 } ],
    "recentActivity": [ { "id": "…", "issueId": "…", "fromStatus": "open", "toStatus": "assigned", "priority": "high", "title": "…", "deviceName": "…", "zoneName": "…", "clientName": "…", "changedBy": "Super Admin", "changedAt": "…" } ]
  }
}
```
- `devices.total` and per-hardware-type totals exclude retired devices; `working` = `active`.
- `issues.byStatus` always carries all 7 states (zero-filled); `open` = every non-`closed`/non-`resolved`… state in `OPEN_ISSUE_STATES`. `byPriority` is over open issues only.
- `technicians.busy` = technicians with ≥1 open assigned issue; `top` is the 5 busiest.
- `facilities` are clients sorted by open-issue load; counts are reduced in JS (no N+1).

**Errors:** `403 FORBIDDEN` for any non-`super_admin` caller.

---

## 19. Realtime (Socket.IO)

Connect a Socket.IO client with the **access token** in the handshake auth. The server
verifies it and joins you to server-derived rooms (clients never name their own rooms):

- `client:<clientId>` — your client room (any user with a `clientId`)
- `zone:<zoneId>` — each of your active **zone assignments** (incharge / staff)
- `zone:<zoneId>` / `client:<clientId>` — each of a **technician's**
  `technician_assignments` (coverage rooms; a technician has no zone_assignments)
- `platform:all` — for `super_admin`

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:3000', { auth: { token: accessToken } });

socket.on('issue:created', (issue)  => { /* ... */ });
socket.on('issue:updated', (issue)  => { /* ... */ });
socket.on('log:submitted', (payload) => { /* { log, zoneId } */ });
```

**Emitted events**

| Event | Emitted when | Payload |
| ----- | ------------ | ------- |
| `issue:created` | `POST /issues` succeeds | the created issue (detail shape) |
| `issue:updated` | `PATCH /issues/:id/status` or `/assign` succeeds | the updated issue |
| `log:submitted` | `POST /daily-logs` succeeds | the daily-log row + its device's zone |

Each event fans out to the device's **zone + every ancestor zone + owning client
+ `platform:all`**, so clients only receive what their scope covers (with the one
known exception noted below).

> **Known gap:** the socket broadcast fans to *all* ancestor zones regardless of
> `CASCADING_VISIBILITY`, while HTTP reads and push honor it. With the flag off, a
> parent-zone incharge may get a live event for a child-zone issue they can't
> open over HTTP.

---

## 19a. Push notifications (Firebase Cloud Messaging)

The same domain events that drive realtime also drive **push**. There is no push
API to call per event — clients only **register a device token** once, and the
server pushes automatically.

**Registration:** `POST /auth/device-token` (see §7) stores an FCM token per
user. Dead tokens are pruned automatically when FCM reports them unregistered.

**Configuration:** FCM is enabled only when Firebase credentials are present in
the environment (`FIREBASE_SERVICE_ACCOUNT`, or `FIREBASE_PROJECT_ID` +
`FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`). When unset, the sender is a
logged **no-op** — the API still runs, it just doesn't dispatch pushes.

**Who gets pushed, per event**

| Issue event → status | Recipients | `data.type` |
| -------------------- | ---------- | ----------- |
| `issue:created` | client_admin(s) + device-zone incharge(s)¹ | `issue_created` |
| → `assigned` | the assigned technician | `issue_assigned` |
| → `in_progress` | raiser + incharge | `issue_in_progress` |
| → `on_hold` | raiser + incharge | `issue_on_hold` |
| → `resolved` | raiser + incharge | `issue_resolved` |
| → `reopened` | the assigned technician | `issue_reopened` |
| → `closed` | raiser + technician | `issue_closed` |

¹ Incharge pushes honor `CASCADING_VISIBILITY`: own zone only, unless the flag is
on (then zone + ancestors).

**Payload the device receives**
```json
{ "notification": { "title": "New issue assigned", "body": "Cam - Snake Enclosure East: no power" },
  "data": { "type": "issue_assigned", "issueId": "f0000000-...0001" } }
```
The `data.issueId` is used to deep-link into the issue detail screen.

---

## 20. State machines reference

### Issue status (`issue.status`)
```
open       → assigned
assigned   → in_progress, on_hold
in_progress→ resolved, on_hold
on_hold    → in_progress
resolved   → closed, reopened
reopened   → assigned
closed     → (terminal)
```
Any other jump → `400 INVALID_TRANSITION`. `open` is a creation-only state and cannot be a
transition target via `PATCH /issues/:id/status`.

### Device status (`device.status`)
```
Manual (PATCH /devices/:id/status):
  provisioned      → active, retired
  active           → retired
  under_maintenance→ retired
  faulty           → active, retired
  retired          → (terminal)

Automatic (domain-driven):
  any open issue           → under_maintenance
  last open issue closed   → active
  3 consecutive not_working logs (while active) → faulty
```

### Zone status (`zone.status`)
```
draft    → active   (also auto-activated when an incharge is assigned)
active   → inactive
inactive → active
```

### Account status (`user.accountStatus`)
```
invited → active   (on first successful login)
active  → suspended / removed  (via PATCH /users/:id or DELETE soft-remove)
suspended / removed → login refused
```

---

*Generated from the source in `src/` and `prisma/schema.prisma`. Business-rule defaults
(`AUTO_CLOSE_DAYS=3`, `FAULTY_THRESHOLD=3`, token TTLs, rate limits) are configurable via
environment variables — see `.env.example`.*
