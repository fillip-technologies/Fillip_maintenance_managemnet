# 04 · Process flows

Each flow shows **who does what**, **which screen or API** is involved, and **what is written**. The Eraser flowcharts these are based on are [`08`](../diagrams/08-flow-device-journey.eraser) and [`09`](../diagrams/09-flow-fault-handling.eraser).

Index: [A Procurement](#a-procurement-and-receiving) · [B Stock movement](#b-stock-movement-transfers) · [C Installation](#c-installation) · [D Daily operations](#d-daily-operations) · [E Fault handling](#e-fault-handling) · [F Warranty claim](#f-warranty-claim-and-rma) · [G Replacement](#g-replacement) · [H Repair](#h-repair-round-trip) · [I Disposal](#i-retirement-and-disposal) · [J Preventive maintenance](#j-preventive-maintenance-amc) · [K Customer onboarding](#k-onboarding-a-new-customer-and-site)

---

## 0. The master flow

```mermaid
flowchart TB
    subgraph PROC["A · Procurement"]
        n1([Need identified]) --> n2[Create purchase order]
        n2 --> n3[Approve PO]
        n3 --> n4[Vendor ships]
        n4 --> n5[Goods receipt GRN]
        n5 --> n6{QC}
        n6 -- rejected --> n7[Return to vendor]
        n6 -- accepted --> n8[Register devices<br/>serial + warranty]
    end
    subgraph MOVE["B · Stock movement"]
        n8 --> p1[Platform stock]
        p1 --> p2[Allocate and dispatch to company]
        p2 --> p3[Company stock]
        p3 --> p4[Allocate and dispatch to site]
        p4 --> p5[Site stock]
    end
    subgraph FIELD["C · Installation"]
        p5 --> f1[Assign zone + technician]
        f1 --> f2[Install and commission]
        f2 --> f3([Installed and active])
    end
    subgraph OPS["D · Operations"]
        f3 --> o1[Daily status log]
        o1 --> o2{Healthy?}
        o2 -- yes --> o1
        o2 -- no --> o3[Issue raised]
    end
    o3 --> E[[E · Fault handling]]
```

---

## A. Procurement and receiving

**Who:** inventory manager (operator). **Where:** FBOS → Inventory → Purchasing.

```mermaid
sequenceDiagram
    autonumber
    actor M as Inventory manager
    participant UI as FBOS UI
    participant S as Inventory service
    participant C as Control (later)
    M->>UI: New purchase order (vendor, model, qty, price, tax)
    UI->>S: POST /purchase-orders
    S-->>UI: PO draft
    M->>UI: Submit
    alt approvals in Fixly (D5)
        S-->>S: approver role check
    else approvals in Control (phase 5)
        S->>C: create approval_request
        C-->>S: approved
    end
    Note over S: PO status: approved
    M->>UI: Goods arrived: record GRN per PO line<br/>received / accepted / rejected, serials
    UI->>S: POST /goods-receipts (Idempotency-Key)
    S-->>S: one transaction:<br/>GRN rows, devices (1 per accepted unit),<br/>warranties, lifecycle event "received",<br/>PO line quantity_received
    S-->>UI: GRN with created device ids
```

**Rules that apply**

| Rule | Effect |
|---|---|
| Receiving gate (§8 rule 11) | Accepted quantity on a GRN line = number of device rows created |
| Warranty at registration (rule 6) | `end_date = start_date + default_warranty_months`; start is GRN date or install date per vendor terms |
| Asset tag (rule 13) | Device `code` from the existing category sequence (e.g. `CAM-000136`) |
| Required at receiving | Serial, model, price, receiving location (fixes the empty-data problem in v1) |

**PO status** (`purchase_orders.status`): `draft → submitted → approved → partially_received → received`, or `cancelled`. **GRN status:** `pending_qc → accepted | partially_accepted | rejected`.

---

## B. Stock movement (transfers)

The same flow is used at every tier. Only the actors and the `transfer_type` change.

| `transfer_type` | From → To | Dispatcher | Receiver |
|---|---|---|---|
| `platform_to_company` | Platform warehouse → company store | Inventory manager | Company storekeeper |
| `company_to_client` | Company store → site store | Company storekeeper | Site storekeeper |
| `client_to_client` | Site store → another site store | Site storekeeper | Site storekeeper |
| `return_to_company` / `return_to_platform` | Back up one tier | Lower tier | Upper tier |
| `replacement_dispatch` | Any store → site | Whoever holds the spare | Technician / site |
| `to_repair` / `from_repair` | Site ⇄ in-house repair centre | Sender | Repair centre / store |
| `to_vendor_rma` / `from_vendor_rma` | Store ⇄ vendor | Operator | Vendor / store |

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> pending_approval: submit
    pending_approval --> approved: approve
    pending_approval --> cancelled
    approved --> dispatched: sender dispatches
    dispatched --> in_transit: courier has it
    in_transit --> received: receiver confirms all items
    in_transit --> partially_received: some items missing or damaged
    in_transit --> rejected: receiver refuses
    approved --> cancelled
    received --> [*]
    partially_received --> [*]
    rejected --> [*]
    cancelled --> [*]
```

```mermaid
sequenceDiagram
    autonumber
    actor Snd as Sender
    actor Rcv as Receiver
    participant S as Inventory service
    Snd->>S: POST /stock-transfers (items, from, to)
    Snd->>S: POST /stock-transfers/{id}/approve
    S-->>S: devices -> reserved, device_allocation created
    Snd->>S: POST /stock-transfers/{id}/dispatch (challan, tracking)
    S-->>S: devices -> in_transit, event "transferred"
    S-->>Rcv: notification via Communication
    Rcv->>S: POST /stock-transfers/{id}/receive (per-item condition)
    S-->>S: devices -> in_company_stock or in_client_stock<br/>previous allocation released<br/>event "transferred"
```

**Rules:** one open transfer per device (rule 4); each item gets `condition_in` and an `item_status` of `pending`, `received`, `missing` or `damaged`, so a partial receive shows exactly which units need follow-up.

---

## C. Installation

**Who:** technician (mobile app now; FBOS later).

```mermaid
flowchart TB
    a([Device in site store]) --> b[Admin assigns zone + technician]
    b --> c[Technician opens task]
    c --> d[Install and commission<br/>position, GPS, photos]
    d --> e[POST /installations]
    e --> f{One active installation<br/>already?}
    f -- yes --> g[409 conflict]
    f -- no --> h[Write installation row<br/>device.current_zone_id set<br/>current_location_id cleared]
    h --> i[lifecycle: installed<br/>event: installed]
    i --> j([Installed and active])
```

**Installation types** (`installation_type`): `new`, `replacement`, `relocation`, `reinstall_after_repair`. **Removal reasons:** `faulty`, `replaced`, `relocated`, `upgraded`, `retired`.

---

## D. Daily operations

```mermaid
flowchart LR
    s([Zone staff]) --> l[Daily status log<br/>working / not working / needs attention]
    l --> h[devices.health_status updated]
    h --> d{not_working?}
    d -- no --> l
    d -- yes --> i[Offer: raise issue]
    i --> E[[Fault handling]]
```

One log per device per day (existing v1 constraint). Issues can also be raised manually or by an automatic alert (`issues.raised_via`).

---

## E. Fault handling

```mermaid
flowchart TB
    subgraph TRIAGE["Triage"]
        t1([Issue raised]) --> t2[Warranty lookup<br/>auto-set warranty_status]
        t2 --> t3[Assign technician]
        t3 --> t4[Technician visits site]
        t4 --> t5[Diagnose]
        t5 --> t6{Fixed on site?}
        t6 -- yes --> t7[Close issue<br/>resolution: fixed_onsite]
        t7 --> t8([Device stays installed])
    end

    t6 -- no --> w{Warranty valid?}

    subgraph WARR["Warranty path"]
        w -- in warranty --> w1[Raise warranty claim]
        w1 --> w2{Vendor decision}
        w2 -- replace --> w3[Vendor sends replacement]
        w2 -- repair --> w4[Vendor RMA repair]
    end

    subgraph PAID["Paid path"]
        w -- out of warranty --> p1{Repair or replace?}
        p1 --> p2[Cost estimate and approval]
    end

    w3 --> G[[G · Replacement]]
    w4 --> H[[H · Repair]]
    p2 -- repair --> H
    p2 -- replace --> G
    p2 -- not worth it --> I[[I · Disposal]]
```

**Issue status** (history kept in `issue_status_history` with GPS): `open → assigned → in_progress → resolved → closed`, with `on_hold` and `reopened` as side paths. **Resolution types:** `fixed_onsite`, `replaced`, `repaired_offsite`, `warranty_rma`, `no_fault_found`, `not_repairable`.

**Visit** (`service_visits`): `visit_type` is `diagnosis`, `onsite_repair`, `replacement_swap`, `removal` or `preventive`; status `scheduled → en_route → on_site → completed` (or `cancelled`, `no_access`); check-in/out, GPS, findings, signature; `outcome` is `fixed`, `needs_replacement`, `needs_repair`, `no_fault_found` or `parts_pending`.

```mermaid
sequenceDiagram
    autonumber
    actor Z as Zone staff
    actor T as Technician
    participant S as Inventory service
    Z->>S: POST /issues {device, category, description}
    S-->>S: look up warranty covering today<br/>issue.warranty_status = in_warranty / out_of_warranty / unknown<br/>device -> faulty
    S-->>T: assignment notification
    T->>S: POST /issues/{id}/visits (check-in)
    Note over T: Sees warranty status BEFORE the visit
    T->>S: PATCH visit (findings, outcome, check-out)
    S-->>S: device -> under_maintenance, then installed (fixed)<br/>or next path
```

---

## F. Warranty claim and RMA

```mermaid
sequenceDiagram
    autonumber
    actor O as Operator
    participant S as Inventory service
    participant V as Vendor
    O->>S: Create repair order<br/>is_warranty_claim = true
    S-->>S: RMA number field available
    O->>V: Submit claim (document attached)
    V-->>O: RMA number, decision
    O->>S: Save rma_number, decision
    alt Vendor replaces
        V-->>O: Ships new unit
        O->>S: Register as replacement (flow G)
    else Vendor repairs
        O->>S: Transfer to_repair (vendor location)
        S-->>S: device -> at_vendor_rma
        V-->>O: Returns repaired unit
        O->>S: Transfer from_repair, close order<br/>condition = refurbished, repair_count + 1
    end
```

---

## G. Replacement

```mermaid
flowchart TB
    r1([Replacement request]) --> r2{Approved?}
    r2 -- no --> r3[Close issue: rejected]
    r2 -- yes --> r4[Pick spare:<br/>1 site store, 2 company store, 3 platform]
    r4 --> r5[Spare -> reserved]
    r5 --> r6[Stock transfer to site<br/>replacement_dispatch]
    r6 --> r7[Technician swaps device]
    r7 --> r8[New device: installed<br/>new installation replaces old one]
    r7 --> r9{Old device disposition}
    r9 -- to_repair or vendor_rma --> H[[Repair order]]
    r9 -- return_to_stock --> st[Back to stock]
    r9 -- scrap --> I[[Retire]]
```

The spare selection order is configurable (rule 8). **Loaner during repair** is modelled as a normal replacement with disposition `to_repair`.

---

## H. Repair round trip

```mermaid
stateDiagram-v2
    [*] --> created
    created --> awaiting_pickup
    awaiting_pickup --> in_transit_out: outbound transfer dispatched
    in_transit_out --> at_repair_center: received
    at_repair_center --> diagnosing
    diagnosing --> awaiting_cost_approval: paid repair
    awaiting_cost_approval --> repairing: approved
    diagnosing --> repairing: warranty, no approval needed
    repairing --> repaired
    repairing --> unrepairable
    diagnosing --> replaced_by_vendor: vendor swaps unit
    repaired --> in_transit_back
    replaced_by_vendor --> in_transit_back
    in_transit_back --> closed: received, QC, condition refurbished
    unrepairable --> closed: device retired
    created --> cancelled
    closed --> [*]
    cancelled --> [*]
```

| Rule 9 | Detail |
|---|---|
| Needs | An outbound transfer to a `service_center` or `vendor` location and a return transfer |
| On close | Device goes to the return location's tier stock, `condition = refurbished`, `repair_count + 1` |
| Costs | `cost_estimate`, `final_cost`, `cost_borne_by` (customer / operator / vendor); parts in `repair_parts` with `covered_by_warranty` |
| Billing (phase 5) | `billable` + `invoice_id` link to Revenue |

---

## I. Retirement and disposal

```mermaid
flowchart TB
    a([Retire request]) --> b[Approver signs off]
    b --> c[device -> retired]
    c --> d{Stores data?<br/>camera SD card, NVR}
    d -- yes --> e[Wipe data]
    e --> f[Attach certificate<br/>document_id]
    d -- no --> g
    f --> g[Create device_disposals<br/>method, approver, recovered value]
    g --> h[device -> disposed]
    h --> i([Terminal: history kept])
```

**Disposal gate (rule 10):** devices that store data cannot become `disposed` until `data_wiped = true` and a certificate is attached. Devices are **never deleted**; history is kept.

**Disposal methods:** `scrap`, `recycle`, `sold`, `returned_to_vendor`, `donated`, `lost`, `stolen`.

---

## J. Preventive maintenance (AMC)

> New in v2.1 (integration change 9). v2 covered corrective maintenance only; "preventive" existed as a `visit_type` with nothing generating it.

```mermaid
flowchart LR
    a[Maintenance plan<br/>scope: model / site / zone<br/>interval e.g. 90 days] --> b[Scheduler job]
    b --> c[Generates preventive<br/>service_visit due dates]
    c --> d[Assign technician]
    d --> e[Visit: checklist, findings]
    e --> f{Fault found?}
    f -- no --> g[Close visit, next due date]
    f -- yes --> h[Raise issue -> flow E]
    b -.-> i[Link to contract / AMC<br/>warranties.warranty_type = amc]
```

---

## K. Onboarding a new customer and site

```mermaid
sequenceDiagram
    autonumber
    actor A as Operator admin
    participant R as Revenue
    participant I as Identity
    participant S as Inventory service
    A->>R: Create / pick customer
    R-->>A: customer id
    A->>S: POST /customers {fbos_customer_id}
    A->>S: POST /sites {customer_id, name}
    S-->>S: create site store location automatically
    A->>S: POST /zones (tree)
    A->>I: Create client_user, grant<br/>inventory.device.read with scope_unit_id = site
    A->>S: Assign technicians to site / zones
```

Auto-created: one `company_store` per customer and one `client_store` per site (migration step 2 does this for the existing 5 and 4).
