# Screen-to-API Flow Reference — Part 3 (extension)

Extends the original `screen-api-flow.md` (Flutter + Web) with the screens it
didn't cover yet, and documents the **realtime + push contract** now implemented
in the backend. Same demo dataset throughout: **City Zoo** → zone **North Wing**
→ sub-zone **Reptile House** → sub-zone **Snake Enclosure**, one camera device,
one issue, users **Ravi Kumar** (zone_incharge), **Priya Singh** (client_admin),
**Amit Shah** (technician).

All endpoints referenced here already exist in `API_REFERENCE.md` unless marked
**(new)**. Base URL `…/api/v1`; every call carries the `Authorization: Bearer`
access token except where noted.

---

## 0. Realtime + Push contract (applies to every screen)

### Socket.IO rooms (server-derived — clients never name their own rooms)

On connect the client sends only `{ auth: { token: <accessToken> } }`. The
server joins the socket to rooms based on the **verified identity in the token**:

| Room | Who joins it | Source |
| ---- | ------------ | ------ |
| `client:<clientId>` | any user with a `clientId` (client_admin, zone users) | `user.clientId` |
| `zone:<zoneId>` | zone incharge/staff — one room per active assignment | `zone_assignments` |
| `zone:<zoneId>` / `client:<clientId>` | **technicians** — one room per coverage row | `technician_assignments` |
| `platform:all` | `super_admin` only | role |

> **Technician fix:** technicians are scoped through `technician_assignments`
> (client- or zone-level), not `zone_assignments`. The socket layer now joins
> those coverage rooms on connect, so a technician's Issue Queue receives live
> `issue:created` / `issue:updated` events. Previously it joined none.

### Events emitted to those rooms

An issue/log event fans out to the **device's zone + every ancestor zone + the
owning client + `platform:all`** — so an incharge assigned higher up, the
client_admin, and super_admin all see it live.

| Event | Payload | Fired when |
| ----- | ------- | ---------- |
| `issue:created` | the created issue (`detail` shape) | `POST /issues` |
| `issue:updated` | the updated issue | any `PATCH /issues/:id/status` or `/assign` |
| `log:submitted` | the daily log row | `POST /daily-logs` |

### Push notifications (FCM) — server-side, no client action beyond token reg

The same domain events drive push. Recipients are resolved per event and only
users with a registered device token are messaged; dead tokens are pruned
automatically.

| Event → issue status | Push audience | Title | `data.type` |
| -------------------- | ------------- | ----- | ----------- |
| `issue:created` | client_admin(s) + the device-zone incharge(s)¹ | New issue raised | `issue_created` |
| `assigned` | the assigned technician | New issue assigned | `issue_assigned` |
| `in_progress` | raiser + incharge | Technician started work | `issue_in_progress` |
| `on_hold` | raiser + incharge | Issue on hold | `issue_on_hold` |
| `resolved` | raiser + incharge | Issue resolved — please confirm | `issue_resolved` |
| `reopened` | the assigned technician | Issue reopened | `issue_reopened` |
| `closed` | raiser + technician | Issue closed | `issue_closed` |

¹ **Push honors `CASCADING_VISIBILITY`.** Incharge pushes go to the device's own
zone only; ancestor-zone incharges are added *only* when the flag is on — so a
parent-zone incharge never gets a phone push about a child-zone issue they can't
open over HTTP. (The live-socket cascade below is the one place this isn't yet
aligned.)

Push payload the device receives (matches the technician deep-link contract):
```json
{ "notification": { "title": "New issue assigned", "body": "Cam - Snake Enclosure East: no power" },
  "data": { "type": "issue_assigned", "issueId": "f0000000-...0001" } }
```
Device tokens are registered once after login via `POST /auth/device-token`
(already in Part 1). No other screen calls the push API directly.

---

# Part 3A — Web app (client_admin)

## Page: Technician coverage
**Role:** client_admin (super_admin / company_admin may also manage)

1. `GET /technicians?page=1&limit=20` — list technicians and their coverage.
   ```json
   { "success": true, "data": { "items": [
     { "id": "t0000000-...0001", "user": { "name": "Amit Shah" }, "specialization": "CCTV/networking",
       "assignments": [ { "id": "ta-...01", "clientId": "c2222222-...", "zoneId": null } ] }
   ], "page": 1, "limit": 20, "totalItems": 1, "totalPages": 1 } }
   ```
2. "Add coverage" → `POST /technicians/:id/assignments`
   ```json
   { "zoneId": "a0000000-...0001" }
   ```
   At least one of `clientId` / `zoneId` is required (client-wide vs. zone-specific);
   `400` if both are null. Response `201` with the new assignment row.

   > Side effect: next time that technician connects a socket, they auto-join
   > `zone:a0000000-...0001` and start receiving that subtree's live issues.
3. "Remove coverage" → `DELETE /technicians/:id/assignments/:assignmentId` → `204`.

---

## Page: Issue detail — reopen / dispute
**Role:** zone_incharge or the original raiser, within the confirmation window

Shown when an issue is `resolved` and the viewer disputes the fix.

1. `GET /issues/:id` — must currently be `status: "resolved"`.
2. "Dispute / reopen" → `PATCH /issues/:id/status`
   ```json
   { "status": "reopened", "notes": "Feed still black after the visit — not fixed." }
   ```
   Response `200`: `{ "success": true, "data": { "id": "f0000000-...0001", "status": "reopened" } }`

   - `400 INVALID_TRANSITION` if the issue isn't in a reopenable state (only
     `resolved → reopened` is legal) — hide the button otherwise.
   - Side effects: `resolved_at`/`closed_at` cleared, a row appended to
     `issue_status_history`, `issue:updated` emitted, and a push fires to the
     assigned technician (`issue_reopened`).
3. Re-assignment after reopen → `PATCH /issues/:id/assign`
   ```json
   { "technicianId": "t0000000-...0001" }
   ```
   Moves `reopened → assigned`. Whether a **zone_incharge** may do this (vs.
   client_admin only) is gated by the `INCHARGE_CAN_REASSIGN` server flag —
   mirror it client-side to show/hide the control.

---

# Part 3B — Flutter + Web (shared)

## Screen/Page: Notifications center
**Role:** all authenticated roles

There is no dedicated "notifications" table — the feed is reconstructed from
issue history the user is scoped to, and live pushes deep-link into detail.

1. Live: the socket subscriptions from §0 push `issue:*` events into a local
   in-app list as they arrive (no polling).
2. Cold open / backfill: `GET /issues?page=1&limit=20` (scoped server-side to
   the caller) gives the current actionable set; each item's timeline comes from
   `GET /issues/:id/history` on tap.
   ```json
   { "success": true, "data": [
     { "fromStatus": null, "toStatus": "open",     "changedAt": "2026-08-31T11:00:00Z", "changedBy": { "name": "Ravi Kumar" } },
     { "fromStatus": "open", "toStatus": "assigned","changedAt": "2026-08-31T11:10:00Z", "changedBy": { "name": "Priya Singh" } }
   ] }
   ```
3. A background push (`data.issueId`, `data.type`) deep-links straight into
   Issue Detail for that `issueId` — same handler the technician queue uses.

---

## Page: Reports & history
**Role:** client_admin, zone_incharge (subtree only)

Read-only historical browsing — no socket subscription; a manual refresh is
enough.

1. Daily-log history: `GET /daily-logs?zoneId=<id>&includeSubzones=true&date=2026-08-31`
   ```json
   { "success": true, "data": { "items": [
     { "id": "g0000000-...0001", "deviceName": "Cam - Snake Enclosure East", "status": "not_working",
       "logDate": "2026-08-31", "loggedByName": "Ravi Kumar" }
   ], "page": 1, "limit": 20, "totalItems": 1, "totalPages": 1 } }
   ```
2. Issue history (SLA/timeline): `GET /issues?status=closed,resolved&page=&limit=`
   for the resolved/closed set, then `GET /issues/:id/history` per issue for the
   full transition timeline (each row carries `changedAt` + `changedBy`, so
   dwell-time-per-state is derivable client-side).
3. Device trend: `GET /devices?zoneId=<id>&includeSubzones=true&status=faulty`
   surfaces devices auto-flagged `faulty` by the consecutive-`not_working`
   trend (threshold = `FAULTY_THRESHOLD`), the entry point for "why is this
   faulty?" → daily-log history filtered to that device.

---

## Notes for the frontend

- **Scope is enforced server-side.** Every list endpoint AND-combines the
  caller's zone-path scope, so passing a `zoneId` the user can't see returns an
  empty page / `404`, never another tenant's data. Client-side filters are UX,
  not security.
- **Realtime cascade vs. HTTP visibility (known gap).** Push and HTTP reads both
  honor `CASCADING_VISIBILITY`, but live **socket** `issue:*` events still fan to
  *all* ancestor zones regardless of the flag. If it's `false`, a parent-zone
  incharge may see a live toast for a child-zone issue they can't open over HTTP.
  This lives in the pre-existing socket-broadcast layer (left untouched this
  round); align it before relying on parent-zone roll-up dashboards.
