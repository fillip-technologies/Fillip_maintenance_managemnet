# 08 · FBOS UI

The inventory UI lives in the FBOS admin app: `fbos_frontend/clientadmin`, as a new module **`features/inventory/`**. The Fixly web app is frozen (no new features) and kept running for current customers until the FBOS UI reaches parity, then redirected.

> Screen names and layout are a proposal. Final designs come from the product owner.

## 1. Navigation map

```mermaid
flowchart TB
    NAV[Inventory menu]
    NAV --> DASH[Dashboard]
    NAV --> DEV[Devices]
    NAV --> LOC[Stock locations]
    NAV --> TRF[Transfers]
    NAV --> PUR[Purchasing]
    NAV --> SRV[Service]
    NAV --> WAR[Warranties]
    NAV --> EOL[Disposals]
    NAV --> REP[Reports]

    DEV --> DEVD[Device detail]
    DEVD --> TL[Timeline]
    DEVD --> DOCS[Documents]
    DEVD --> WARR[Warranty]
    DEVD --> ISS[Issues]

    PUR --> VND[Vendors]
    PUR --> MOD[Models]
    PUR --> PO[Purchase orders]
    PUR --> GRN[Goods receipts]

    SRV --> ISSL[Issues and visits]
    SRV --> RPO[Repair orders]
    SRV --> RPL[Replacements]
    SRV --> MNT[Maintenance plans]
```

## 2. Pages

| Page | Who uses it | What it shows | Key actions | Permissions |
|---|---|---|---|---|
| **Dashboard** | Everyone (content varies) | Stock by tier, open issues, transfers in transit, warranties expiring, out for repair | Jump to lists | `device.read` + others |
| **Devices** | Operator, company, site | Searchable register with model, status, health, holder, zone, warranty end | Filter, export, open detail | `device.read` |
| **Device detail** | Same | Identity, location now, custody, warranty, installation history, files | Install, raise issue, move | `device.read` |
| **Timeline** (tab) | Same | Full lifecycle from `device_lifecycle_events` | — | `device.read` |
| **Stock locations** | Operator, storekeepers | Platform / company / site stores with stock per model | Open stock, start transfer | `stock_location.read` |
| **Transfers** | Operator, storekeepers | List and detail; sender, receiver, items, status | Create, approve, dispatch, receive | `stock_transfer.*` |
| **Vendors / Models** | Operator | Master data | CRUD | `vendor.*`, `device_model.*` |
| **Purchase orders** | Operator | PO list, lines, approval status | Create, submit, approve | `purchase_order.*` |
| **Goods receipts** | Operator | GRN against a PO, serial capture, QC | Receive, accept, reject | `goods_receipt.*` |
| **Warranties** | Operator, company | Expiry calendar, claim status | Open claim | `warranty.read` |
| **Issues and visits** | Everyone | Issue list, status, warranty badge, visits | Raise, assign, log visit | `issue.*`, `service_visit.*` |
| **Repair orders** | Operator | Out-for-repair board, RMA, costs | Create, dispatch, close | `repair_order.*` |
| **Replacements** | Operator, company | Request, approval, spare picker, disposition | Request, approve | `replacement.*` |
| **Maintenance plans** | Operator | Plans and upcoming preventive visits | Create plan | `maintenance_plan.*` |
| **Disposals** | Operator | Retired devices awaiting disposal, certificates | Approve, record wipe | `disposal.*` |
| **Reports** | Operator, company | The reports in [design doc §11](../fixly-v2-design.md#11-reports-and-dashboards-this-model-enables) | Filter, export | `report.read` |

## 3. Device detail layout

```mermaid
flowchart TB
    subgraph PAGE["Device CAM-000136 · Dome Camera · Installed · Healthy"]
        direction TB
        subgraph TOP["Header"]
            h1["Serial · Model · Asset tag"]
            h2["Lifecycle badge + health badge"]
            h3["Warranty: active until 2027-03-01"]
        end
        subgraph MID["Where and who"]
            m1["Location: Zone 12 / Rajgir Zoo Safari / Main gate"]
            m2["Custody: Rajgir Zoo Safari · Owner: company"]
            m3["Installed 2026-02-10 by Technician A"]
        end
        subgraph TABS["Tabs"]
            t1[Timeline]
            t2[Installations]
            t3[Issues and visits]
            t4[Repairs]
            t5[Documents]
        end
        subgraph ACT["Actions - shown only if permitted"]
            a1[Raise issue]
            a2[Move or transfer]
            a3[Send for repair]
            a4[Retire]
        end
    end
```

## 4. How users move through it

### Storekeeper receives a delivery

```mermaid
flowchart LR
    n[Notification:<br/>transfer dispatched] --> t[Transfers > detail]
    t --> c[Check items against delivery]
    c --> r{All good?}
    r -- yes --> a[Receive all]
    r -- no --> b[Mark damaged or missing]
    a --> s[Stock location shows new stock]
    b --> s
```

### Zone staff reports a problem

```mermaid
flowchart LR
    d[Devices > search CAM-000136] --> x[Device detail]
    x --> i[Raise issue]
    i --> f[Pick category, describe, photo]
    f --> w[Warranty badge appears automatically]
    w --> n[Technician notified]
```

### Operator handles a failed unit

```mermaid
flowchart LR
    i[Issue: needs vendor] --> r[Create repair order<br/>warranty claim on]
    r --> k[Enter RMA number]
    k --> t[Create to_vendor_rma transfer]
    t --> b[Board: At vendor]
    b --> y[Receive back]
    y --> c[Close repair, QC]
```

## 5. Frontend structure

Follows `fbos_frontend/CLAUDE.md` conventions.

```
clientadmin/src/features/inventory/
├── api.js                  # one function per endpoint, base /api/inventory/v1
├── hooks/                  # useInventoryNames (id → name, like useDeliveryNames)
├── pages/
│   ├── DashboardPage.jsx
│   ├── devices/            # list, detail, timeline
│   ├── locations/
│   ├── transfers/
│   ├── purchasing/         # vendors, models, POs, GRNs
│   ├── service/            # issues, visits, repairs, replacements, maintenance
│   ├── warranties/
│   ├── disposals/
│   └── reports/
└── components/             # StatusBadge, WarrantyBadge, TransferItemsTable, DocumentPanel use
```

| Concern | How |
|---|---|
| Access gating | `features/auth/access.js` hides menu items and actions the user's permission list lacks |
| Files | Reuse `DocumentPanel` with subject types `inventory.*` |
| Names | Ids resolved to names via Identity / Revenue lookups, not copied |
| Dev proxy | Add `/api/inventory` → `INVENTORY_URL` to the Vite proxy |
| Feature flag | One flag per page; turning it off falls back to Fixly web during rollout |
| Docs | Add `/api/inventory` and the module to `fbos_frontend/CLAUDE.md` |

## 6. What a customer user sees

Customer staff (`client_user`) get the same pages with narrower data:

| Area | Customer view |
|---|---|
| Dashboard | Only their site(s) |
| Devices | Their site's devices; no cost or vendor price |
| Stock | Their site store |
| Purchasing, Vendors, Disposals, Reports with cost | Hidden (no permission) |
| Issues | Raise and follow their own |

## 7. Technician mobile app

The Flutter app stays on the legacy API through Phases 1–3. In Phase 4 it signs in with FBOS Identity (mobile refresh is already supported when the request sends `X-Client-Type: mobile`) and switches to the inventory API. It must store the refresh token and serialize refreshes, because reusing a refresh token revokes the whole session family.
