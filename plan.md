# Fixly — Hardware Defect & Maintenance Platform
## Product Vision & Build Plan

> A single, shared source of truth for what we are building and why.
> Rewritten 2026-09-02 from the full working understanding of the project.

---

## 1. The Problem (why this exists)

Our company (led by the **CEO**) supplies and is accountable for **hardware components**
deployed across **many different client organizations** (schools, facilities, campuses,
etc.). When a component becomes defective anywhere, it is ultimately **the CEO's
responsibility** to see it resolved.

Today that coordination is manual and invisible. We are building a platform that:

1. Gives each **organization** a self-service way to **report and track defective
   hardware** and take action on it.
2. Gives the **CEO a single pane of glass** over **every** organization — every product,
   every defect, every action — so nothing is missed and he can step in anywhere.
3. **Automates the flow** from "a component is faulty" → the right people are notified →
   a technician fixes it → everyone sees it resolved, with a full audit trail.

In one line: **a multi-tenant defect-management system for hardware, with the CEO on top
and each organization managing its own equipment underneath.**

---

## 2. Who Uses It (roles & hierarchy)

```
CEO  (super_admin)                 ── platform owner: sees & controls EVERYTHING
 │
 ├─ Organization = Company         ── a client organization (e.g. "Fillip Technologies")
 │    │
 │    └─ Org Head (client_admin)   ── runs one organization; manages its people & equipment
 │         │
 │         ├─ Zone In-charge (zone_incharge) ── supervises a zone (+ all its sub-zones)
 │         │     │
 │         │     └─ Zone Staff (zone_staff)  ── works a sub-zone; logs status, reports defects
 │         │
 │         └─ (zones form a tree: Facility → Floor → Room …)
 │
 └─ Technician (technician)        ── FREE / independent field engineer. Belongs to NO
                                       organization. Just does the repair work (mobile app).
```

| Role | Belongs to | Can do |
|---|---|---|
| **CEO** `super_admin` | the platform | See & act on everything across all orgs; manage companies, org heads, technicians, products |
| **Org Head** `client_admin` | one Company | Manage their org's users (except other admins & technicians), zones, products, and defects |
| **Zone In-charge** `zone_incharge` | a Company, assigned to a zone | Supervise their zone subtree; report & act on defects in scope |
| **Zone Staff** `zone_staff` | a Company, assigned to a sub-zone | Daily status logging; report defects |
| **Technician** `technician` | nobody (free) | Receive assigned defects and fix them (mobile app) |

**Access model:** every read/write is scoped by this hierarchy. The CEO is platform-wide;
an org head is bounded to their Company; an in-charge/staff to their zone subtree; a
technician to defects assigned to them (or unassigned within their coverage). This is
already enforced by `src/authz/scope.js` and proven by `scripts/authz.mjs`.

**Platform vs. mobile:** the **web app** serves the CEO, org heads, and zone officers
(oversight, management, reporting, action). The **mobile app** serves technicians (and
field daily-logging). Technician lifecycle on the web is create/delete only.

---

## 3. The Core Thing: a Product (tracked hardware unit)

**A "Product" is one physical, trackable hardware unit** (a camera, a display, a cable
run, etc.). It is the atom of the whole system. Decision (locked): **a Product IS the
tracked unit** — we do not keep a separate "inventory item" and "deployed device"; they
are one entity.

Every Product has:
- a **unique identification code** (system-generated, e.g. `CAM-000123`) — for tracking a
  specific unit;
- a **mandatory category** from a **global, CEO-managed list** (shared by all orgs);
- an owning **organization** (Company); a **zone is optional** — a unit can sit **in stock**
  (no zone) and be **deployed** into a zone later, or be added straight into a zone;
- a **health status**: `in stock` (no zone) · `active` · `under_maintenance` · `faulty` ·
  `retired`;
- attributes: price, purchase/install dates, image, plus its **daily status logs** and
  its **defect history**.

Products enter the system two ways:
1. **Excel/CSV bulk import** — upload a spreadsheet of many units at once.
2. **Direct single entry** — a form for one unit.

Both auto-assign the unique code and require a category. (No user-typed serial number.)

---

## 4. The Core Flow: Defect Lifecycle

This is the heart of the platform. It reuses the existing, tested Issue engine
(`src/modules/issues`, `src/utils/issueStateMachine.js`, `src/push`).

```
1. REPORT   Zone staff / in-charge / org head sees a bad unit and raises a defect
            on it (picks the unit by code, sets priority + description, optional photo).
            → unit auto-flips to "under_maintenance"
            → NOTIFY: org head + zone in-charge + CEO
            → everyone in scope now sees it (org head in their org, CEO everywhere)

2. TRIAGE   Org head or CEO reviews, sets priority, assigns a Technician.
            → NOTIFY: the technician (on mobile)

3. FIX      Technician works it on mobile: in-progress → (optional on-hold) → resolved.
            → NOTIFY: reporter + in-charge + CEO at each step

4. CONFIRM  Reporter / org head / CEO confirms the fix → closed.
            → unit returns to "active"
            → (auto-closes after a grace period if nobody disputes)

5. REOPEN   If it wasn't really fixed → reopened → back to the technician. (loop)
```

**Automatic detection:** zone staff log daily unit health (from **web or mobile**). If a
unit reads `not_working` for several consecutive days, it **auto-flags `faulty`** — the
signal to raise a defect (and a candidate for future auto-raising).

**Everything is auditable:** every status change records who did it and when
(`issue_status_history`), so the CEO and org head can see the full timeline of any defect.

**Visibility & notifications summary:**
| Step | Sees it (in-app) | Gets notified (push) |
|---|---|---|
| Reported | reporter, in-charge, **org head**, **CEO** | org head + in-charge + **CEO** |
| Assigned | + technician | technician |
| In progress / hold / resolved | all above | reporter + in-charge + **CEO** |
| Closed | all above | reporter + technician + **CEO** |

*(Adding the CEO to the push chain is the one notification gap remaining — everything else
already works.)*

---

## 5. Feature Map

### 5.1 CEO (super_admin) — the command center
- **Cross-org overview**: totals across all organizations (companies, orgs, units, open
  defects, technicians).
- **All-defects board**: every open defect across every org, filter by org/priority/age;
  drill in and act (assign, comment, close).
- **Manage organizations** (companies) and **org heads** (client_admins).
- **Manage technicians** (create/delete; they're free of any org).
- **Manage the product catalog** for any org (import, categories, codes).
- **Full audit visibility** (who changed what, everywhere).

### 5.2 Org Head (client_admin) — run one organization
- **Org overview** scoped to their organization (real numbers, never fabricated).
- **Defect board** for their org: raise, triage, assign, track, close.
- **Manage their people**: create zone in-charges & zone staff (NOT other org heads, NOT
  technicians); can't touch other orgs.
- **Manage zones** (tree) and **products/inventory** (import + direct entry).
- New users are **emailed their login credentials** automatically.

### 5.3 Zone Officer (zone_incharge / zone_staff) — the field
- **Scope-limited dashboard**: only their assigned zone(s) and sub-zones.
- **Report defects** on units in their scope.
- **Daily status logging** (drives auto-faulty detection).
- No org-wide or admin controls.

### 5.4 Technician (mobile) — do the work
- Receive assigned defects; move them in-progress → resolved; add notes.
- Free agent — not part of any org.

### 5.5 Product management (cross-cutting)
- **Excel/CSV import** (template → upload → validate/preview → commit → per-row report).
- **Direct entry** (single unit).
- **Mandatory category** + **auto unique code**.
- **Audit** of every add/remove.

---

## 6. Where We Are Today (state as of 2026-09-02)

### Built & working
- **Stack**: Node/Express/Prisma/PostgreSQL(Neon) backend; Vite/React web; socket.io
  realtime; optional FCM push + SMTP email (graceful no-op when unconfigured).
- **Auth & security**: JWT access + rotating refresh; **per-request DB re-validation**
  (deleted/suspended accounts lose access immediately); self-deletion blocked; user
  management tenant-scoped; `super_admin`-only role assignment (an org head can't mint
  another org head or a technician).
- **Hierarchy is real**: `company_id` is a first-class column on users; the
  client_admin → zone_incharge → zone_staff chain carries the org; technicians are
  correctly company-less; a demo chain exists under "Fillip Technologies"
  (Main Facility → Floor 1) with in-charge/staff assignments.
- **Defect engine**: full Issue state machine, status-history audit, unit auto-status
  sync, daily-log auto-faulty, realtime events, role-targeted push (org head +
  in-charge today).
- **Products/inventory**: company-scoped table with an audit trail (create/delete),
  super-admin picks org / org-head locked to own org — verified end-to-end.
- **Role dashboards**: separate zone-officer area; per-zone device breakdown endpoint.
- **Credential email** on user creation.
- **No fake data**: removed all demo/placeholder fallbacks and the localStorage mock
  layer; every list is backend-driven (`?? 0`, never fabricated).
- **Technician web portal**: create (atomic user+profile, emailed) / delete.
- **Infra basics**: multi-stage `Dockerfile`, `/health/live` + `/health/ready`,
  verification scripts (`smoke`, `authz`, `overview.check`, `push.test`), API docs.

### Not yet done / known issues
- **Product ≠ tracked unit yet**: the new company-scoped `products` table is separate
  from `Device` (the actual tracked/zoned/logged unit). The unification (§3) is pending.
- **Unique code + mandatory category + Excel import**: not built.
- **CEO not in the push chain**; no CEO cross-org defect board; no org-head defect board;
  no web raise-defect flow; no in-app notification center.
- **Ops maturity**: no CI, no real test framework (ad-hoc `.mjs` only), secrets still in
  a committed `.env`, product images as base64 in a TEXT column, frontend not code-split.
- **Environment hygiene**: Neon auto-suspend causes transient failures; a schema-drift
  incident occurred (`users.company_id` briefly became `integer` — fixed); the running
  `:3000` server is on stale code; **a large body of work is uncommitted (2 migrations)**.

---

## 7. Build Roadmap (to the full vision)

### Phase 0 — Stabilize & checkpoint 🔴 (do first)
- Commit the current work (2 migrations + features) on a branch; open a PR.
- Redeploy so the API runs current code.
- Secrets: rotate JWT/DB creds, move real values to a secret store, keep only `.env.example`.
- Revert `ACCESS_TOKEN_TTL` to `15m`; add a DB **type-drift guard** script.
- **Exit:** `smoke` + `authz` green on a fresh deploy.

### Phase 1 — Unify the Product/Unit + catalog 🟢 (the foundation of everything)
- Add **global** `ProductCategory` (companyId null, CEO-managed); seed a master set.
- Extend the tracked unit (`Device`) with `code` (unique, category-prefixed, generated
  in-transaction), `categoryId`, price, image; make **`zoneId` nullable** (in-stock units)
  and add an **`in stock`** status for zone-less units.
- **Excel/CSV import** creating units (template → dry-run preview → commit → per-row report)
  + **direct entry**; category **mandatory**; **zone optional** (in stock or into a zone);
  auto unique code. Add a **Deploy** action (assign a stock unit to a zone).
- Migrate the separate `products` data onto the unit; retire the redundant table/UI.
- **Exit:** create a categorized unit (with a unique code) via import and direct entry,
  both in-stock and into a zone; deploy a stock unit; concurrent creates never collide;
  imports audited.

### Phase 1.5 — Complete the defect flow 🟢 (the core purpose)
- Add **CEO (super_admin) to the push audience** on raise/progress/resolve/close.
- **Org-head defect board** (raise + triage + assign + close, scoped to their org).
- **CEO cross-org defect board** (all orgs, filterable, act anywhere).
- Web **raise-defect** flow (pick unit by code, priority, description, photo).
- **In-app notification center** (persisted, so web users see the chain without FCM).
- **Exit:** the §4 flow works end-to-end on the web for staff → org head → CEO →
  technician, with cross-org isolation still proven by `authz`.

### Phase 2 — Performance & polish 🟡
- Product images → object storage (URL, not base64); backfill.
- Frontend route code-splitting + error boundaries; resolve the bundle-size warning.
- DB index review; confirm no N+1 in dashboards; server-side pagination everywhere.

### Phase 3 — Delivery & infra 🔵
- CI (GitHub Actions): install → prisma generate → lint → run smoke/authz/product checks
  on an ephemeral Postgres → build web → build image.
- `.dockerignore`, `docker-compose` (api + postgres), web build/deploy config.
- Deploy runs `prisma migrate deploy` (never `dev`); DB backup + restore runbook.

### Phase 4 — Observability & hardening 🟣
- Error tracking (Sentry) + request-id correlation + basic RED metrics.
- Rate limits on login/import; tighter helmet/CSP; body-size limits.
- Port ad-hoc `.mjs` checks into a real test suite with a coverage gate.
- *(SLA auto-escalation intentionally out of scope — CEO always-on visibility, per §9.2.)*

---

## 8. Definition of Done (production ready)
- [ ] The §4 defect flow works end-to-end across roles, with the CEO seeing & acting on
      everything and each org isolated from others (proven by `authz`).
- [ ] A Product = the tracked unit: mandatory category, unique code, Excel + direct entry,
      all audited.
- [ ] Auth hardened (short token TTL, instant revocation), secrets externalized.
- [ ] CI green (lint + tests + build + image) gates every merge; deploy via `migrate deploy`
      with a documented rollback + DB restore.
- [ ] Observability in place (errors, health, correlated logs); rate/body limits on
      sensitive routes.
- [ ] No demo/mock/localStorage data anywhere; images in object storage; web code-split.

---

## 9. Resolved Decisions (locked 2026-09-02)
1. **Import target — Both allowed.** A unit's zone is **optional at add time**: it can be
   added "in stock" (no zone) OR straight into a zone, and assigned/moved later. →
   `Device.zoneId` becomes nullable; a unit with no zone shows as **in stock**; deploying
   = assigning a zone.
2. **Escalation — Always-visible is enough.** No SLA timers/auto-escalation. The CEO sees
   every defect on their cross-org board from the moment it's raised and can act anytime.
   (SLA/escalation dropped from the roadmap.)
3. **Categories — Global (shared).** One master `ProductCategory` list used by every org,
   **managed by the CEO** (`super_admin`). `ProductCategory.companyId` is therefore `null`
   (global); consistent cross-org reporting. (No per-org categories.)
4. **Daily logging — Both web and mobile.** Zone staff can submit daily status logs from
   the web zone dashboard **and** the mobile app.

---

## 10. Immediate Next Steps
1. **Commit current work** (checkpoint before the unification touches core models).
2. Phase 0 quick wins (token TTL, drift guard, secrets).
3. Start Phase 1: `ProductCategory` + unique `code` + extend the unit + Excel import.
