# Migrating live Fixly (backend + web) to v2

> Same file in `fixly_backend/docs/v2/` and `fixly_frontend/docs/v2/`.
> Written 2026-10-21 for branch `ayush-dev4`. Nothing below has been run against the live
> database yet; every step was rehearsed on a local copy of the live dump.

## 0. What changes for users
- **Fixly web:** a new **Hardware Lifecycle** menu (devices, stock, transfers, purchasing, maintenance, repairs, disposals, reports for super admin; fewer for other roles). Old screens stay.
- **Mobile app:** nothing changes. It keeps using `/api/v1`, and the `status` field means the same.
- **Behaviour changes in the old API:**
  - A zone, site or organization that still holds devices can't be deleted (409). Before, its devices silently went back to stock.
  - A retired device can't be deployed again (409 `DEVICE_RETIRED`).
  - A device with issues or daily logs can't be hard-deleted. No screen did this, but the database now refuses it.
- **New issues** get a number (`ISS-2026-0001`), the warranty status at the time, and a fix-by time.

## 1. Decide before you start

| Decision | Setting | Default if you don't decide |
|---|---|---|
| Who owns a device once it reaches an organization (D3) | `INVENTORY_DEFAULT_OWNERSHIP` | `company_owned` |
| Hours to fix an issue per priority | `INVENTORY_SLA_HOURS` | `critical:4,high:24,medium:72,low:168` |
| Connect to FBOS now or later | `FBOS_*` settings (§7) | later: Fixly works on its own |

## 2. What to deploy: `release/fixly-v2` (Phase 6 taken out)
`ayush-dev4` contains Phase 6 (`25af91d`). It turns `devices.status` into a generated column and must go out separately (§8). For the backend, deploy branch **`release/fixly-v2`**: `ayush-dev4` with Phase 6 reverted.
- **The revert conflicted** in `device.service.js` and was resolved: kept READ COMMITTED and put back the `status` writes.
- **Tested on a database without Phase 6:** 60/60 tests, 27/27 legacy smoke checks.
- **Check it:**
  ```
  cd fixly/fixly_backend
  git switch release/fixly-v2
  ls prisma/migrations           # last one: 20261021150000_v2_maintenance_plans
  ```
- **If `ayush-dev4` moves on:** bring the new commits into `release/fixly-v2` with `git merge ayush-dev4`. The revert stays, because Phase 6 is already in the release branch's history. Check that the Phase 6 migration folder is still absent.

The frontend needs no special branch: `ayush-dev4` (or a release branch from it).

## 3. Rehearse on a fresh copy of live (always, the same day)
1. Take a dump of live:
   ```
   mysqldump -h srv1276.hstgr.io -u u516064072_fixly -p --single-transaction --routines --triggers u516064072_fixly > fixly-live-YYYYMMDD.sql
   ```
2. Load it locally and apply the migrations: `npm run v2:reset-local-db -- /path/to/fixly-live-YYYYMMDD.sql`. This rebuilds `test_fixly_v2` and runs `prisma migrate deploy`.
3. Dry-run the backfill, then run it: `npm run v2:backfill -- --dry-run`, then `npm run v2:backfill`. The last step prints the reconcile, which must show `problems` all 0 and the live counts of devices, companies, sites and zones.
4. Check:
   - `npm run v2:local-passwords`
   - `~/Projects/fbos/dev-local.sh start`
   - Sign in to Fixly web as each role and click through the old screens and the new menu.
   - Run `npm run v2:smoke` and `node --test scripts/inventory_*.test.mjs`.
5. Note how long steps 2–3 took. That is roughly the live run.

If a migration fails halfway, MariaDB keeps the statements that already ran (DDL isn't transactional). Locally, reset and fix. That is exactly why this rehearsal exists.

## 4. Back up live, right before
- **Database:** take the same dump as §3.1 and keep it.
- **Backend:** note the current backend commit or image tag.
- **Web:** keep a copy of the current web build (`/var/www/fixly/dist`).

## 5. Backend: migrate, deploy, backfill
The migrations are **additive**: the current live code keeps working on the new schema. So migrate first, then deploy the code.

1. **Production `.env`.** Keep its own `DATABASE_URL` and **its own** `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`; never copy the local `.env`. Add:
   ```
   INVENTORY_API_ENABLED=true
   INVENTORY_DEFAULT_OWNERSHIP=company_owned
   INVENTORY_SLA_HOURS=critical:4,high:24,medium:72,low:168
   OUTBOX_WORKER_ENABLED=true        # warranty notices + maintenance visits (+ FBOS notifications if connected)
   ```
2. **Apply the migrations, once, from the server** (or from a machine whose `.env` has the live `DATABASE_URL`):
   ```
   npm ci
   npx prisma generate
   npm run prisma:deploy       # applies the 4 v2 migrations; prints each one
   ```
   It adds 4 migrations: the history-safe deletes, the v2 schema, the FBOS actor columns and the maintenance plans.
3. **Deploy the new code** the usual way (Docker image from `Dockerfile`, or `npm ci --omit=dev` + restart `node src/server.js`).
4. **Backfill live data** (fills the new columns from the old ones; safe to re-run):
   ```
   node scripts/v2/backfill.mjs --remote --dry-run    # read the counts
   node scripts/v2/backfill.mjs --remote              # commits; must end with problems all 0
   ```
   Until this runs, older devices have no lifecycle state and don't appear correctly in the new screens. The old screens are unaffected.
5. **Check:**
   - `GET /health/live` is 200.
   - `GET /api/inventory/v1/health` is 200. (`/ready` reports Identity "unavailable" unless FBOS is connected; that's fine.)
   - Sign in as super admin, a client admin, zone staff and a technician.
   - Open a device's timeline: it starts with "Existing unit (before v2)".
   - The mobile app still signs in and lists issues.

## 6. Web: build and publish
The production build reads `.env.production`, which points at the live backend. `.env` is only for local testing (it points at `localhost`).
```
cd fixly/fixly_frontend
git switch ayush-dev4 && git pull
npm ci
npm run build
grep -o "fixly-backend.fillipsoftware.com/api/v1" dist/assets/*.js | head -1   # must print the live URL
```
Copy `dist/` to the server path in `nginx.conf` (`/var/www/fixly/dist`). Nothing else changes on nginx.

Publish the web **after** the backend (§5). The new pages call `/api/inventory/v1`, which only exists once the backend runs with `INVENTORY_API_ENABLED=true`.

## 7. Connecting FBOS (optional, any time later)
1. Deploy the FBOS side from `fbos_services` `ayush-dev4`:
   - Identity with the `inventory.*` codes. This must go **before** the backend serves FBOS users.
   - The gateway with `INVENTORY_SERVICE_URL` pointing at the Fixly backend.
   - Documents with `"inventory"` added to `SUBJECT_SERVICES`.
2. In the FBOS console, create the operator organization's org units: one per customer, and under it one per site.
3. Set on the Fixly backend:
   - `FBOS_ORGANIZATION_ID`
   - `FBOS_IDENTITY_URL`
   - `FBOS_COMMUNICATION_URL`
   - `FBOS_INTERNAL_TOKEN` (the same value as FBOS `INTERNAL_SERVICE_TOKEN`)
4. Link Fixly rows to FBOS: `companies.fbos_org_unit_id` / `fbos_customer_id`, `clients.fbos_org_unit_id`, and `users.fbos_user_id` for technicians. `scripts/v2/fbos_dev_bootstrap.mjs` shows how; it is dev-only, so do the live links by hand or with a reviewed script. Then run `backfill.mjs --remote --only=09` to stamp the organization.
5. Give FBOS users inventory permissions in the console. Customer staff need grants on **their site's unit**: an organization-wide grant shows them nothing.

## 8. Phase 6, later (needs a short stop)
Phase 6 (`25af91d`) makes `devices.status` a column the database computes from `lifecycle_state`. Code from before Phase 6 writes `status` and would fail against it. Code after Phase 6 doesn't write `status`, and with the old column that value would go stale. So the code and the migration go together:
1. Prove it on a fresh copy of live (as in §3) with the `ayush-dev4` code.
2. Stop the backend.
3. Run `npm run prisma:deploy`. It applies `20261021180000_v2_phase6_status_from_lifecycle`, which takes seconds for a few thousand devices.
4. Start the backend with the Phase 6 code.
5. Check that the device status counts on the dashboard are unchanged.

Future migrations: `prisma migrate diff` will propose turning `status` back into a plain column. Leave that line out.

## 9. Rolling back
| Problem | Do |
|---|---|
| New web pages misbehave | Put the previous `dist/` back. The backend can stay. |
| Backend misbehaves | Deploy the previous backend build. The old code runs fine on the v2 schema (additive), and the new tables are simply unused. |
| Data is wrong after the backfill | Fix and re-run the backfill (idempotent), or restore the §4 dump if needed. |
| Phase 6 misbehaves | Stop the backend, restore the dump taken right before §8, and deploy the pre-Phase-6 build. |

Don't drop the v2 tables to "undo": old code ignores them, and they hold the history new screens wrote.

## 10. Checklist
- [ ] §1 decisions written down (D3, SLA)
- [ ] Release branch without Phase 6; tests green
- [ ] Rehearsal on today's dump: migrations, backfill reconcile 0 problems, smoke, all roles clicked
- [ ] Live dump + current build saved
- [ ] `prisma:deploy` on live: 4 migrations applied
- [ ] Backend deployed with the new `.env` keys (live JWT secrets kept)
- [ ] Backfill `--remote` dry run, then real: 0 problems
- [ ] Health checks, four roles signed in, mobile app checked
- [ ] Web built with `.env.production`, live URL confirmed, `dist/` published
