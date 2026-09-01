# Maintenance Management API

Production-grade REST API built with **Node.js**, **Express**, **Prisma ORM**, and **PostgreSQL**. Designed as a single backend that serves both **web and mobile** clients via a versioned, CORS-enabled JSON API.

Domain: a hardware/CCTV maintenance platform with a fixed hierarchy
(**Company → Client**) and a **self-referencing Zone tree** of unlimited depth.
Devices attach to zones; issues move through a full state machine; daily status
logs feed an auto-`faulty` trend check. The complete data model lives in
[`prisma/schema.prisma`](prisma/schema.prisma).

## Data model

| Area        | Models                                             |
| ----------- | -------------------------------------------------- |
| Hierarchy   | `Company`, `Client`, `Zone` (self-referencing), `ZoneAssignment` |
| Devices     | `HardwareType`, `Device`                           |
| Issues      | `IssueCategory`, `Issue`, `IssueStatusHistory`     |
| Operations  | `DailyStatusLog`                                   |
| Technicians | `Technician`, `TechnicianAssignment`               |
| Identity    | `User` (platform-wide, role + account status)      |

State machines (enums): zone `draft→active→inactive`; device
`provisioned→active→under_maintenance→faulty→retired`; issue
`open→assigned→in_progress→on_hold→resolved→closed`/`reopened`.

Two constraints can't be expressed in the Prisma schema and are documented as
raw SQL to add to the generated migration (see comments in the schema): the
**partial unique index** on active `zone_assignments`, and the **CHECK** that a
`technician_assignments` row has at least one of `client_id` / `zone_id`.

## Business rules ("decisions to lock in")

Tunable via env vars ([`.env.example`](.env.example)) so they can change without a code edit:

| Variable                | Default | Meaning                                                 |
| ----------------------- | ------- | ------------------------------------------------------- |
| `AUTO_CLOSE_DAYS`       | `3`     | Days after `resolved` before an issue auto-closes       |
| `FAULTY_THRESHOLD`      | `3`     | Consecutive `not_working` logs before a device → `faulty` |
| `CASCADING_VISIBILITY`  | `false` | Parent-zone incharge sees sub-zone data?                |
| `INCHARGE_CAN_REASSIGN` | `false` | Can a zone incharge reassign a technician?              |

## Features

- **Layered architecture** — routes → controllers → services, with feature modules under `src/modules/`
- **JWT auth** — access + rotating refresh tokens (hashed at rest), bcrypt passwords, role-guarded routes
- **Zone-path authorization** — every read/write is scoped to the caller's role + zone assignments (spec §2); cross-tenant/zone access returns 404, not data
- **Realtime** — Socket.IO with token-authenticated, server-derived zone/client rooms and a domain event bus
- **Validation** with Zod (body / query / params) via reusable middleware
- **Centralized error handling** with Prisma mapping and a stable `{success:false, code, message}` shape
- **Self-referencing zone tree** with recursive `descendants` / `ancestors` / `includeSubzones` queries
- **Security** — Helmet, configurable CORS, rate limiting, request-size limits
- **Structured logging** with Pino (+ pretty output in dev) and per-request IDs
- **Health checks** — liveness (`/health/live`) and readiness (`/health/ready`)
- **Graceful shutdown** — drains connections and closes the DB pool on SIGTERM/SIGINT
- **Env validation** — the app fails fast if configuration is invalid

## Project structure

```
src/
├── config/          # env validation, logger
├── lib/             # prisma client singleton
├── middleware/      # authenticate/requireRole, validate, notFound, errorHandler
├── modules/         # one folder per feature: routes/controller/service/validation
│   ├── auth/           # login, refresh, logout, device-token, me
│   ├── users/          # soft-remove, bcrypt passwords
│   ├── companies/      # super_admin
│   ├── clients/        # + type
│   ├── verticals/      # catalogue + client-verticals toggle
│   ├── zones/          # tree (descendants/ancestors), assignments, lifecycle
│   ├── hardwareTypes/  # + nested issue categories
│   ├── issueCategories/# flat lookup by hardware type
│   ├── devices/        # status lifecycle, maintenance sync, includeSubzones
│   ├── issues/         # state machine, status history, scope filters
│   ├── dailyLogs/      # one log/device/day, auto-faulty trend
│   ├── technicians/    # + coverage assignments
│   └── dashboard/      # summary by zone/client/platform scope
├── realtime/        # Socket.IO server + domain event bus
├── routes/          # api aggregator (auth guard) + health checks
├── utils/           # ApiError, asyncHandler, pagination, response, jwt, password, issueStateMachine
├── app.js           # express app factory
└── server.js        # http server + realtime + lifecycle
prisma/
├── schema.prisma
├── migrations/      # baseline 0_init (incl. hand-added constraints)
└── seed.js
```

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `DATABASE_URL` to point at your PostgreSQL instance (a local install or a
hosted database such as Neon/Supabase/RDS).

### 3. Run migrations & seed

A baseline migration (`prisma/migrations/0_init`) is already included — it
creates every table **and** the two hand-added constraints (the partial unique
index on active `zone_assignments` and the `technician_assignments` scope CHECK).

```bash
npm run prisma:migrate    # dev: applies migrations + regenerates the client
# or, for an existing/production database:
npm run prisma:deploy
npm run db:seed           # optional sample data
```

### 4. Start the server

```bash
npm run dev               # watch mode
# or
npm start
```

The API is available at `http://localhost:3000`.

## API reference

Base URL: `http://localhost:3000/api/v1`. **All routes except `/auth/login`,
`/auth/refresh`, and `/health/*` require `Authorization: Bearer <accessToken>`.**
All list endpoints accept `?page` & `?limit` and return
`data: { items, page, limit, totalItems, totalPages }`. Standard CRUD is
`GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id` unless noted.

Records that carry an audit trail are **archived, not hard-deleted**, so history
survives (spec §3.1/§3.5): users soft-remove to `removed`, zones/devices move to
`inactive`/`retired`, and company/client deletes are refused while children exist.

| Resource         | Base path         | Notable extras                                             |
| ---------------- | ----------------- | --------------------------------------------------------- |
| Auth             | `/auth`           | `POST /login`, `POST /refresh`, `POST /logout`, `GET /me`, `POST /device-token` |
| Companies        | `/companies`      | super_admin only; `DELETE` blocked if it has clients/users |
| Clients          | `/clients`        | super_admin/company_admin; `?companyId`; `client.type`     |
| Verticals        | `/verticals`, `/client-verticals` | catalogue + `PATCH /client-verticals` toggle |
| Users            | `/users`          | `role`, `accountStatus`; `?clientId`; `DELETE` = **soft-remove** |
| Zones            | `/zones`          | `GET /:id/descendants`, `PATCH /:id/status`; `?clientId`, `?topLevel` |
| Zone assignments | `/zones/:id/...`  | `POST /:id/assign`, `GET`/`DELETE /:id/assignments[/:assignmentId]` |
| Hardware types   | `/hardware-types` | `POST /:id/categories`, `DELETE /:id/categories/:categoryId` |
| Issue categories | `/issue-categories` | `GET ?hardwareTypeId=` (dropdown lookup)                |
| Devices          | `/devices`        | `PATCH /:id/status` (retire); `?zoneId&includeSubzones`    |
| Issues           | `/issues`         | `PATCH /:id/status`, `PATCH /:id/assign`, `GET /:id/history`; `?raisedByMe`, `?scope=technician`, `?status=a,b`, `?zoneId&includeSubzones` |
| Daily logs       | `/daily-logs`     | `POST` (one/device/day, `overwrite`), `?zoneId&includeSubzones&date` |
| Technicians      | `/technicians`    | `POST /:id/assignments`, `DELETE /:id/assignments/:assignmentId` |
| Dashboard        | `/dashboard`      | `GET /summary?scope=zone|client|platform&id=&includeSubzones=` |

Health: `GET /health/live`, `GET /health/ready`

### Auth quickstart

```bash
# 1. Log in (seeded password for every demo user is "Password123!")
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"priya@cityzoo.com","password":"Password123!"}'
# → { success, data: { accessToken, refreshToken, user, zoneDescendants, zoneAncestors } }

# 2. Call protected routes with the access token
curl http://localhost:3000/api/v1/zones?clientId=<id> \
  -H "Authorization: Bearer <accessToken>"

# 3. Rotate when the access token expires
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" -d '{"refreshToken":"<refreshToken>"}'
```

### Authorization (zone-path scoping)

`src/authz/scope.js` resolves each request's visibility from role + active zone
assignments; `attachScope` runs after `authenticate` and hangs it on `req.scope`.

| Role            | Sees / acts on                                              |
| --------------- | ---------------------------------------------------------- |
| `super_admin`   | everything (platform)                                       |
| `company_admin` | their company's clients and everything below               |
| `client_admin`  | their client, all zones/devices/issues                     |
| `zone_incharge` | their assigned zone(s); sub-zones only if `CASCADING_VISIBILITY=true` |
| `zone_staff`    | their assigned zone only                                    |
| `technician`    | coverage zones/clients + issues assigned to them           |

Enforcement is uniform: list endpoints AND the scope filter into the query;
by-id reads **and** writes load via a scoped `findFirst` and return **404** if
out of scope (so ids don't leak across tenants); `/dashboard/summary` gates
`scope=platform` to super_admin and asserts `client`/`zone` ids are in scope.
Verified by `scripts/authz.mjs` (14 negative-path assertions) — run it against a
seeded DB with the server up: `node scripts/authz.mjs`.

### Realtime (Socket.IO)

Connect with the access token in the handshake; the server joins you to your
`client:<id>`, assigned `zone:<id>` rooms (and `platform:all` for super_admin).
Emitted events: `issue:created`, `issue:updated`, `log:submitted`.

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:3000', { auth: { token: accessToken } });
socket.on('issue:updated', (issue) => { /* update UI */ });
```

### Example — the issue lifecycle

All calls carry `-H "Authorization: Bearer <accessToken>"` (omitted for brevity);
`raisedBy`/`changedBy` are derived from the token, not the body.

```bash
# Raise an issue (device → under_maintenance automatically)
curl -X POST http://localhost:3000/api/v1/issues \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"<uuid>","categoryId":"<uuid>","priority":"high","description":"No power"}'

# Assign a technician (open → assigned)
curl -X PATCH http://localhost:3000/api/v1/issues/<id>/assign \
  -H "Content-Type: application/json" -d '{"technicianId":"<uuid>"}'

# Technician walks it forward; closed is confirmed by client_admin/incharge
curl -X PATCH http://localhost:3000/api/v1/issues/<id>/status \
  -H "Content-Type: application/json" -d '{"status":"in_progress"}'
# → in_progress → resolved → closed (device returns to active)
```

Every transition is validated against the state machine in
`src/utils/issueStateMachine.js` and appended to `issue_status_history`. An
illegal jump returns `400` with `code: "INVALID_TRANSITION"`.
Success responses are `{ "success": true, "data": ... }`; errors are
`{ "success": false, "code": ..., "message": ..., "details"?: ... }`.

## Adding a new feature module

1. Create `src/modules/<name>/` with `*.routes.js`, `*.controller.js`, `*.service.js`, `*.validation.js`.
2. Add the model to `prisma/schema.prisma` and run `npm run prisma:migrate`.
3. Mount the router in `src/routes/index.js`.

## Available scripts

| Script                    | Description                        |
| ------------------------- | ---------------------------------- |
| `npm run dev`             | Start with file watching           |
| `npm start`               | Start the server                   |
| `npm run prisma:migrate`  | Create/apply a dev migration       |
| `npm run prisma:deploy`   | Apply migrations (production)       |
| `npm run prisma:studio`   | Open Prisma Studio                 |
| `npm run db:seed`         | Seed sample data                   |
