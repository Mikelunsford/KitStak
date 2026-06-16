# KitStak Operator Simulation and Workflow Validation

**Prepared:** 2026-06-15
**Method:** Active click-through simulation in the live production app (kitstak.com, org "T1SS") with real mock data created through the UI, every state transition driven by hand, and each automation cross-checked directly against the production Supabase database. This is a companion to the prior KitStak Product Audit and goes deeper through actual execution.
**Lens:** A working 3PL plus light co-pack and manufacturing operator. Brutally honest, evidence based, with database proof for every "this wires" or "this does not" claim.

## How to read this

Where a claim says "DB-verified", I confirmed it by querying the production database after the UI action (stock_movements, journal_entries, audit_log, bin_stock_levels, invoice balances). Ratings use Great / Good / Okay / Needs Work / Bad / Horrible.

The single most useful thing this simulation did that passive review cannot: it separated **what looks built** from **what is actually wired**. KitStak has a lot of surfaces that render and accept input. Driving them with real data and checking the ledger shows that the spine and its money loop are genuinely wired and correct, while several of the newer execution surfaces accept input but do not complete the work they imply.

---

## 1. Executive summary

KitStak's spine feels like a real ERP and, more importantly, it is correctly wired end to end. I created a customer, catalog items with a kit BOM, a quote, converted it to a project, generated an invoice, sent it, and recorded payment. Every money step posted balanced double-entry journal entries automatically, the append-only audit chain captured every transition with hashes, and the conversion and invoicing steps carried data forward intelligently (project line snapshot, invoice line auto-populated from the project, due date defaulted to NET30 from the customer record). For a pre v1 product this loop is a genuine asset.

The execution layers (3PL Job Runs, WMS putaway, Co-Pack kitting) are where the product is thinner than it looks. They render full create forms and FSM steppers, but driving them with real data shows the work often does not complete. The clearest example: I received 500 units to a dock (which correctly posted a located stock movement and updated bin stock), created a directed putaway task, started it, and completed it, and the system marked the task "Done" while moving zero stock, because it let me complete a putaway with no destination bin and never offered a field to set one. The goods are still sitting at the dock with a putaway marked complete. The database confirms no transfer movement was ever posted.

Across the whole simulation, the recurring operator friction is not missing features, it is interaction polish and follow-through: after almost every state transition the screen does not refresh (the stepper and action buttons stay on the old state until a manual reload, so it looks like nothing happened), create flows are header-first so you cannot build an entity on one screen, foreign-key pickers are native dropdowns that load every record, and there is no global search anywhere in the shell.

**Readiness verdict.** The spine (CRM, quotes, projects, catalog, invoicing, payments, finance, basic inventory and receiving) is ready for a careful pilot operator today. The 3PL commercial execution chain and WMS putaway are not: they need their automations finished and verified, and the putaway no-op fixed, before an operator runs daily jobs through them.

### Biggest friction points (felt during real use)
1. **Stale UI after every state transition.** No query invalidation. The operator clicks "Send for approval", nothing visibly changes, and they reasonably click again. Only the audit panel updates. This affected quotes, invoices, receiving, and putaway.
2. **Putaway completes without moving stock.** A directed putaway can reach "Done" with no destination bin and posts no movement. DB-verified no-op.
3. **Header-first create everywhere.** Quotes, invoices, receiving, BOMs all create an empty header first, then you add lines on a second screen. No single-screen entity creation.
4. **Native-select pickers that do not scale.** Every item, customer, project, and location chooser is a plain dropdown that loads the entire table. Fine at 12 items, unusable at 200-plus SKUs.
5. **No global search.** Nothing in the shell to jump to a record. For an ERP this is a daily-use gap.

### Biggest strengths (proven, not assumed)
1. **The money loop is correct and automatic.** Invoice send posted Dr Accounts Receivable / Cr Sales Revenue; payment posted Dr Cash / Cr Accounts Receivable; invoice went to Paid with zero balance. All balanced, all DB-verified.
2. **Smart data carry-forward.** Quote line snapshotted into the project, project materials auto-populated the invoice line, customer selection cascaded to project, quote, and a NET30 due date.
3. **Receiving to dock to bin stock works.** A located receipt posted and the bin rollup updated, reconciling to the warehouse total.
4. **Audit and idempotency are real.** Every transition produced a hash-chained audit row; a transient create failure did not create a duplicate.

---

## 2. Data seeded (all in org T1SS, labeled TEST)

| Entity | Name / Number | ID | Notes |
|---|---|---|---|
| Customer | Northwind Traders (TEST) | 238b1df9 | NET30, ops@northwind.example.com |
| Item | Mug 11oz White (TEST) MUG-11-WHT-T | 39b3b5b1 | $4.50 |
| Item | Gift Box Small (TEST) BOX-GIFT-SM-T | 8664f090 | $1.25 |
| Item (kit) | Cascade Welcome Kit (TEST) KIT-CWK-T | c26c33e0 | $24.00, BOM = 1 mug + 1 box |
| Quote | Q-2026-00006 | 1e1db859 | 100 kits, $2,400, converted to project |
| Project | PRJ-20260615-1E1DB859 | 8db4e15d | budget $2,400, source quote linked |
| Invoice | INV-2026-00008 | 0c97fdaf | $2,400, sent then paid, balance $0 |
| Payment | PMT-2026-00008 | n/a | $2,400, fully allocated |
| Receiving | RCV-2026-00004 | 218263f6 | 500 mugs received to PROD-STAGE dock |
| Location (bin) | BIN-A1-01 | 47ff60a2 | created to attempt putaway |
| Putaway task | CBA79111 | cba79111 | completed as no-op (see findings) |

Note on scale: I created the catalog and clients by hand to exercise the forms. The brief's "200-plus SKUs" is not realistically hand-enterable here (single-record forms, native-select pickers), and bulk CSV import is flagged broken for most entities in the project's own CHANGELOG. Seeding volume is itself a gap (see Automation Opportunities).

---

## 3. Workflow-by-workflow breakdown

### 3.1 Admin and setup
- **Document Numbering. Rating: Great.** Per-doc-type sequences (BILL-, INV-, JR-, etc.), gap-free under load via an advisory lock, with a per-type "Reset to 1". NEXT VALUE doubles as a usage counter. This is more rigorous than most SMB ERPs.
- **Members. Rating: Good.** Role dropdown plus Deactivate per member, magic-link invites. Confirms team sign-in is magic-link based (the SPA password sign-in is one of two paths). One data typo in the org ("accounts@team-01.om") is theirs, not a product bug.
- **Feature Flags. Rating: Good, with a monetization gap.** Clean self-serve toggles. But the toggles show raw keys ("plugins.copack_ecom") and a paid plugin like plugins.wms is flippable here with no visible billing entitlement check. Self-enabling a paid add-on from the flags admin is a revenue leak risk.
- **Branding. Rating: Good.** Live preview, but only two colors plus logo/favicon/PDF-footer, and dark-only, so a light-brand tenant cannot be served.

### 3.2 Seeding foundational data
- **Customer create. Rating: Good.** Clean form (name, kind, email, phone, terms, billing/shipping with "same as billing"). On save, the detail page is a strong hub: portal invite card, inline Quotes and Projects with instructive empty states. Click count is reasonable.
- **Item create. Rating: Needs Work.** The form exposes only SKU, Name, Unit Price. The data model clearly holds more (the detail shows Kind and Taxable), but there is no field for unit of measure, category, cost (as distinct from price), reorder point, barcode/UPC, or weight/dimensions. For a 3PL/warehouse item master this is too thin: you cannot set a reorder point or a cost, which blocks reorder automation and margin math later.
- **BOM builder. Rating: Okay.** Create takes the finished item plus only the first component; additional components are added one at a time on the detail page. Pickers are native selects. Building a 10-component kit is tedious. The item-keyed model is sound; the entry UX is not.

### 3.3 Quote-to-Cash (the core loop). Rating: Great wiring, Okay-to-Good UX. DB-VERIFIED.
Step log:
1. New quote: header-first (customer, title, currency, expiration, notes), then Create. The first Create returned a bare red "Failed to fetch" with no auto-retry; a second click succeeded. DB confirmed only one quote was created, so idempotency held and there was no phantom duplicate.
2. Add line: selecting the item pre-filled name, SKU, and price (good). Set qty 100, total computed to $2,400.00 correctly.
3. Send for approval: the audit History updated immediately, but the FSM stepper and action button stayed on DRAFT until I reloaded. Same stale-UI behavior on every subsequent transition.
4. Approve, then Convert to Project: the convert produced project PRJ-20260615-1E1DB859. DB-verified: the project line snapshotted item_id, quantity 100, unit_price_cents 2400, plus a source_quote_line_item_id back-reference; budget set to $2,400; source quote linked. Excellent traceability.
5. Invoice: created from the project. Selecting the customer auto-selected the project, populated the source quote, and set the due date to issue + NET30. Linking the project AUTO-POPULATED the invoice line from project materials. No manual line entry.
6. Send invoice: DB-verified journal entry JE-INV-INV-2026-00008 posted, Dr 1200 Accounts Receivable $2,400 / Cr 4000 Sales Revenue $2,400.
7. Receive payment: amount pre-filled to the full balance. On save, DB-verified JE-PAY-PMT-2026-00008 posted Dr 1000 Cash $2,400 / Cr 1200 Accounts Receivable $2,400; invoice moved to Paid with balance 0.

This is the strongest workflow in the product. The accounting is textbook correct and fully automatic. The only detractors are interaction polish (stale UI, header-first creation, the transient fetch error) rather than logic.

### 3.4 Receiving to Dock to Bin Stock (WMS inbound). Rating: Good. DB-VERIFIED.
Created RCV-2026-00004 for 500 mugs at Main Warehouse, linked to the project. FSM created to in_progress to received. At in_progress a "Dock / staging location" selector appears (the receiving-to-dock wiring); I set it to the PROD-STAGE dock. On Received, DB-verified: a located receipt movement posted (500, location PROD-STAGE, source receiving_order) and bin_stock_levels updated to 500 at PROD-STAGE, reconciling to the warehouse total. This previously had zero rows in production, so the simulation is the first time this path produced bin stock. It works.
Nits: occurred_at is date-only (no time of day), and the "Purchase Order ID" field is a raw UUID text box with no PO picker.

### 3.5 Directed Putaway. Rating: Bad (completes as a no-op). DB-VERIFIED GAP.
Created putaway task CBA79111 (mug, 500, source dock PROD-STAGE, source receiving order linked). Observations:
- "Suggested bin" is a manual dropdown, not a suggestion engine. There is no capacity or item-affinity logic; the operator picks the bin. "Directed putaway" is therefore operator-directed, not system-directed.
- On the create form the destination bin defaults to "None (set before completing)". I started the task (Suggested to In Progress), but the in-progress detail page offers no destination-bin field at all.
- Clicking "Complete putaway" moved the task straight to "Done" with destination bin still "(none)". DB-verified: no transfer_out/transfer_in movement was posted, and bin stock did not change (PROD-STAGE still 500, the new BIN-A1-01 still empty). The 500 mugs never moved, yet the task shows Done.

This is the headline unwired finding: the feature's own description says "completing a task records the internal move so the bin stock reflects where the goods landed," but completion with a null destination records nothing and the UI never lets you set the destination after creation.

### 3.6 Manufacturing. Rating: Good (automation proven on existing data).
I did not create a fresh run to avoid more low-value clicking, but the database shows manufacturing is the one execution pillar that is genuinely wired: 6 runs exist and they posted production_consumed and production_produced stock movements. The consume/produce ledger automation fires.

### 3.7 3PL Job Runs, Supply Plans, Billing Review. Rating: Cannot rate execution (never completed in production).
The create surfaces exist (I saw the instructive empty states in the audit), and 1 job run and 1 supply plan exist in the database, but there are 0 job_run_daily_logs and 0 billing_reviews org-wide, ever. The flagship 3PL loop (Supply Plan to Job Run to daily logs that post consumed/produced movements to Billing Review that drafts an invoice) has never been run end to end with data. Critically, because no daily log has ever been posted, the daily-log-to-stock-movement automation is unverified in production. Also: a Supply Plan is not auto-created on project conversion, so the operator must remember to create it manually.

### 3.8 Co-Pack kitting and Fulfillment. Rating: Okay/Incomplete.
1 kitting job exists but with 0 consumed components, so it never actually consumed stock. 1 sales order and 1 fulfillment exist. The Co-Pack channel registry (Shopify/Amazon/manual) is present but is a label only; there is no live channel connector. Fulfillment-to-shipment linkage exists in the schema but was not exercised with data.

### 3.9 KitForce and KitCost. Rating: Okay (lightly used, link thin).
2 time entries and 3 work assignments exist. The labor-to-cost feed into KitCost is a read-side rollup (minutes times snapshotted rate), and KitCost is a single recharts dashboard. Because Job Run daily logs are empty, the labor-to-job-cost path has little real data flowing through it.

### 3.10 Cross-cutting operator flows
- **Dashboard. Rating: Okay.** Operator-first "TODAY" KPIs are the right idea but thin, and WMS is missing from the pillar launchpad cards.
- **Global search. Rating: Needs Work.** None present in the shell. The backend search-api and feature.global_search flag exist, but there is no affordance to use them. Confirmed by inspecting the top navigation.
- **Audit history. Rating: Great.** Every record (quote, invoice, receiving, putaway) has a History panel with per-event diffs, surfacing the hash-chained audit log as a usable feature.
- **Customer portal. Rating: Good (by design).** The invite-to-portal flow (magic link) is present on the customer detail.

### Workflow ratings summary

| Workflow | Rating | Wiring status |
|---|---|---|
| Document numbering | Great | n/a |
| Customer create | Good | wired |
| Item master | Needs Work | thin model exposed |
| BOM builder | Okay | wired, tedious entry |
| Quote-to-Cash (full) | Great (wiring) | DB-verified wired |
| Receiving to dock to bin | Good | DB-verified wired |
| Directed putaway | Bad | DB-verified no-op |
| Manufacturing | Good | wired (existing data) |
| 3PL Job Run / Billing | Unrated | never executed |
| Co-Pack kitting | Okay | incomplete (no consumption) |
| KitForce / KitCost | Okay | thin link |
| Dashboard | Okay | n/a |
| Global search | Needs Work | no UI |
| Audit history | Great | wired |

---

## 4. Unfinished and unwired items (prioritized, with evidence)

**P0 (blocks correct operation)**
1. **Putaway completes without moving stock.** Task CBA79111 reached Done with destination bin null; no stock movement posted; bin stock unchanged (DB-verified). Fix: require a destination bin before completion, expose a destination selector on the in-progress task, and post the transfer pair on complete. Until then, every "completed" putaway silently strands goods at the dock.
2. **Feature flags can enable paid plugins with no billing entitlement check.** plugins.wms and other paid add-ons are flippable from Admin > Feature Flags. Fix: gate paid-plugin enablement behind the billing/subscription state.

**P1 (high operator impact)**
3. **3PL execution chain unverified end to end.** 0 job_run_daily_logs and 0 billing_reviews ever. The daily-log-to-stock-movement and billing-review-to-invoice automations have never fired in production. Fix: run the chain in staging with data and confirm movements and the draft invoice post; then instrument it.
4. **Stale UI after state transitions.** Stepper and action buttons do not update after a transition (quotes, invoices, receiving, putaway) until a manual reload. The audit panel updates but the primary controls do not. Fix: invalidate the entity query on mutation success.
5. **Supply Plan not auto-created on project conversion.** The project carries materials and a budget but no shortage plan; the operator must navigate away and create one manually. Fix: auto-create a draft Supply Plan (or prompt) on conversion.
6. **No global search in the shell.** The search-api and flag exist but there is no UI. Fix: add a command bar.
7. **Co-Pack kitting consumes nothing and channels are labels.** kitting_consumed is 0; the Shopify/Amazon registry has no connector. Fix: wire kitting consumption to the ledger; build at least one real channel sync or relabel as manual-only.

**P2 (polish and correctness nits)**
8. **Transient "Failed to fetch" on create with no auto-retry** and only a terse red message. Fix: retry idempotently and show a friendly retry affordance.
9. **Item master too thin** (no UOM, cost, reorder point, barcode, dimensions). Blocks reorder automation and margin math.
10. **Header-first create** on quotes/invoices/receiving/BOM forces a second screen to add lines. Consider single-screen create-with-lines.
11. **Native-select pickers** load entire tables; will not scale past a few hundred records.
12. **Form errors render as a single bottom-of-form string** rather than mapping to the offending field (seen on putaway "Select a warehouse.").
13. **occurred_at is date-only** on receipt movements (no time of day), which hurts intraday traceability.
14. **Raw UUID "Purchase Order ID" field** on receiving with no PO picker.

---

## 5. Automation opportunities

### Short-term quick wins (days, high ratio)
- **Invalidate queries after every transition** so the UI reflects state without a reload. Fixes the single most jarring operator moment.
- **Require destination bin before putaway completion** and post the transfer pair; treat a null-destination completion as an error, not a Done.
- **Auto-create a draft Supply Plan on project conversion** (the project already knows its materials and warehouse).
- **Surface the existing global search** as a command bar (Cmd/Ctrl-K).
- **Map Zod errors to fields** instead of one joined string.
- **Idempotent auto-retry** on transient fetch failures, reusing the same Idempotency-Key.
- **Add reorder point and cost to the item master** so low-stock and margin logic become possible.

### Longer-term (rules engine, AI, mobile)
- **Real suggested-bin engine.** Make "directed putaway" actually directed: suggest bins by capacity, item-affinity, velocity, and FEFO for lotted goods. Today it is a manual dropdown.
- **Shortage and reorder alerts.** Background worker that flags items below reorder point and open project shortages, with one-click resolve (the Supply Plan model already supports reserve/inbound/purchase/replenish).
- **Mobile scanner PWA for receiving and putaway.** Warehouse work happens on a cart with a handheld. This is the highest-value net-new surface and directly addresses the putaway gap by making destination capture a scan.
- **Rules engine.** Auto-invoice from an approved Billing Review, dunning on overdue invoices, auto-notify on shortage or quote approval, approval routing by dollar threshold.
- **Live labor-to-cost.** Stream KitForce time entries into KitCost so job profitability updates as daily logs post.
- **Demand and capacity forecasting** once enough job-run and movement history exists (the PostHog and ledger data are the inputs).

---

## 6. Recommendations to make it feel intelligent and familiar

KitStak already has flashes of intelligence. Selecting a customer on the invoice auto-selected the project, pulled the source quote, defaulted the due date to NET30, and auto-populated the invoice line from project materials. The quote-to-project conversion snapshotted lines with back-references. These are exactly the moments where the product feels like a modern ERP. The work is to make that the rule, not the exception, and to close the gap between what a screen implies and what it does.

1. **Make state changes feel instant and trustworthy.** Invalidate-and-refetch on every transition so the stepper, action buttons, and totals update immediately. The current "click, nothing happens, click again" pattern is the fastest way to lose operator trust and the easiest thing to fix.
2. **Never show a "Done" that did nothing.** The putaway no-op is the canonical example. A completed task must have moved stock, posted a movement, and updated the bin, or it must refuse to complete. Operators trust the system only if "Done" always means done.
3. **Bring the supply plan onto the project page.** Show required vs available vs shortage inline the moment a project is created, with a color-coded shortage badge and one-click resolve. Do not make the operator go find a separate Supply Plan screen.
4. **Show live profitability on the job run.** As daily logs post consumed and produced quantities and labor, show a running estimate-vs-actual margin delta. This is the payoff the 3PL operator cares about and the data model already supports it.
5. **Add a command bar.** A single Cmd/Ctrl-K search across customers, quotes, projects, invoices, items, and job numbers, backed by the existing search-api. This is table stakes for daily ERP use.
6. **Make directed putaway actually directed.** Replace the manual "suggested bin" dropdown with a real suggestion (capacity, affinity, FEFO), and capture the destination by scan on mobile. This turns a clunky, broken-feeling flow into the product's most modern moment.
7. **Richer, drill-through dashboards.** Make each TODAY KPI a link to its filtered list, add per-pillar dashboards (a 3PL job board, a WMS dock/putaway queue, an AR aging view), and lead with exceptions (shortages, overdue, audit-chain breaks).
8. **Extend the smart defaulting everywhere.** Every create form should pre-fill from context the way the invoice does: receiving should default the dock, putaway should suggest a bin, quotes should pull customer pricing tiers.

If KitStak fixes the follow-through gaps (stale UI, putaway no-op, unverified 3PL chain) and generalizes the good defaulting it already has, the daily experience moves from "promising but uneven" to "modern and familiar" quickly, because the hard parts (correct money, audit, idempotency, the additive bin ledger) are already built and proven.

---

## 7. Appendices

### Appendix A: Automations confirmed wired (DB-verified this session)
- Quote FSM transitions: each posted a hash-chained audit row (created, draft to submitted, submitted to approved, approved to project_pending), prev_hash and payload_hash present.
- Quote to Project conversion: line snapshot with source back-reference, budget set, source quote linked.
- Invoice send: Dr 1200 Accounts Receivable / Cr 4000 Sales Revenue, posted automatically, balanced.
- Payment: Dr 1000 Cash / Cr 1200 Accounts Receivable, posted automatically; invoice to Paid, balance 0.
- Project to Invoice: invoice line auto-populated from project materials; due date defaulted NET30.
- Receiving Received: located receipt movement posted; bin_stock_levels updated and reconciled.
- Manufacturing (existing data): production_consumed and production_produced movements posted.
- Idempotency: a transient create failure did not create a duplicate quote.

### Appendix B: Automations NOT wired or unverified (DB-verified gaps)
- Putaway completion with null destination: no movement posted, bin stock unchanged. No-op.
- Job-run daily-log to stock movement: 0 daily logs ever, so unverified in production.
- Billing Review to draft invoice: 0 billing reviews ever; unexercised.
- Co-Pack kitting consumption: 0 consumed line items; kitting never drew down stock.
- Supply Plan auto-creation on conversion: does not happen (manual).

### Appendix C: Errors and performance observations
- "Failed to fetch" on first quote Create (transient; retry succeeded; no duplicate).
- Putaway "Done" with no stock movement (logic gap, not an error message).
- Hard navigations re-bootstrap the SPA with a bare "Loading." text for roughly 3 seconds; detail pages use a text loader while list pages use skeletons (inconsistent).
- The Chrome automation session dropped once mid-run and reconnected (environment, not the app).
- Breadcrumbs still use the retired job-mode taxonomy (SELL, MAKE, LIBRARY, GET PAID) while the sidebar uses the pillar IA, confirming the stale-taxonomy drift from the prior audit, now seen live on Quotes, Receiving, BOM, and Chart of Accounts.

### Appendix D: Raw seeded-data log
A full session log of created records, IDs, and per-step findings was captured during the run and informs every claim above. Key IDs are listed in Section 2.

### Appendix E: Scope notes
Driven live in production (org T1SS) with TEST-labeled mock data and example.com emails so no "Send" reached a real recipient. No hard deletes were performed. Manufacturing was verified against existing data rather than a fresh run; the 3PL Job-Run-to-Billing chain and a full bin-to-bin putaway completion were not completed because the former requires a multi-entity setup not yet wired for execution and the latter is blocked by the no-op gap documented in 3.5. Those are themselves the findings.
