# Fixly v2 — local copy of the Eraser workspace

Copied from https://app.eraser.io/workspace/XBHGdC4VuBWkbhfkXjM2 (file "Fixly", team "Ayush's Team") on 2026-10-14.

The Eraser file was **not** modified. This folder is a local working copy; edits here do not sync back.

| File | Content |
|---|---|
| `fixly-v2-design.md` | The full document: audit of v1, principles, ownership model, lifecycle states, walkthrough, table dictionary, rules, migration plan, queries, open questions, build order |
| `diagrams/01-v1-erd-as-is.eraser` | v1 ERD (current live schema) |
| `diagrams/02-v2-domain1-organization-access.eraser` | v2 ERD: organization, sites, users |
| `diagrams/03-v2-domain2-catalog-procurement-warranty.eraser` | v2 ERD: catalog, vendors, PO, GRN, warranty |
| `diagrams/04-v2-domain3-inventory-transfers.eraser` | v2 ERD: stock locations, transfers, allocation |
| `diagrams/05-v2-domain4-device-lifecycle.eraser` | v2 ERD: device, installation, lifecycle log, disposal |
| `diagrams/06-v2-domain5-issues-repair.eraser` | v2 ERD: issues, visits, repair, replacement |
| `diagrams/07-v2-full-overview.eraser` | v2 ERD: 36 tables, key columns (the doc says 38; `refresh_tokens` and `device_tokens` are only in 02) |
| `diagrams/08-flow-device-journey.eraser` | Flowchart: order → install |
| `diagrams/09-flow-fault-handling.eraser` | Flowchart: fault → repair / replace / retire |

## Working with the diagrams
- `.eraser` files are Eraser's diagram-as-code. To view one, paste it into a new ER diagram (or flowchart for 08 and 09) in Eraser's code editor.
- The ER ones are plain text, so they are also easy to diff and to turn into Prisma models.

## Related
- `docs/` — the full, illustrated documentation set (overview, architecture, lifecycle, flows, data model, permissions, API, UI, rollout, decisions). Start at `docs/README.md`.
- `FIXLY_V2_INTEGRATION_PLAN.md` — how Fixly v2 connects to FBOS (a copy also sits in `fbos_services/docs/fixly-v2-integration-plan.md` without these links).
- The role matrix in section 8 of the design doc should become permission codes when integrated (see the plan's section 6).
