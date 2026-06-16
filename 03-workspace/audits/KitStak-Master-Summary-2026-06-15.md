# KitStak Master Summary: Product Audit and Operator Simulation

**Prepared:** 2026-06-15
**Combines:** (1) the exhaustive Product Audit (code, live database, authenticated app, usage analytics) and (2) the active Operator Simulation (real mock data created through the UI, every flow driven by hand, every automation cross-checked against the production database).
**Audience:** Internal engineering, product, and UX. Brutally honest, evidence based.
**Full reports:** `03-workspace/audits/KitStak-Product-Audit-2026-06-15.*` and `03-workspace/audits/KitStak-Operator-Simulation-2026-06-15.*`.

---

## 1. The verdict in one paragraph

KitStak is architecturally production-grade and commercially pre-launch. On a single multi-tenant chassis it carries a full ERP spine (CRM, quotes, projects, catalog, inventory, purchasing, double-entry finance) plus six composable add-ons, governed by a documented constitution (BIGINT-cents money, RLS on every table, forward-only migrations, idempotency, an append-only hash-chained audit log, an 8-role capability canon) and a rigorous Definition of Done. The simulation proved the spine is not just present but correctly wired: a quote flowed to a project, to an invoice, to a payment, posting balanced double-entry journal entries automatically at each money step. The gating risks are not missing features. They are a short list of security-hardening items, a data layer not yet built for volume, a few execution-layer wiring gaps, and the absence of a live operator. The newer execution surfaces (3PL Job Runs, WMS putaway, Co-Pack kitting) render fully but, when driven with real data, often do not complete the work they imply.

---

## 2. How this was validated

The audit triangulated four sources: the codebase (constitution, ADRs, all 10 API contracts, ~178 SPA pages, the shared edge-function kernel, 109 migrations), the live Supabase database (schema plus the full security and performance linters), the authenticated production app, and PostHog usage. The simulation then went further: it created interconnected records through the UI and confirmed each automation by querying the database after the action (stock movements, journal entries, audit rows, bin stock, invoice balances). Every "this wires" or "this does not" claim below has database evidence behind it.

A grounding fact from both: the product has near-zero live usage (PostHog shows founder/test traffic tapering to a few sign-ins per week). UX findings are expert-review and execution based, not behavioral. Getting one real operator onto production is the most important next step and is also KitStak's own stated v1 gate.

---

## 3. Maturity scorecard

| Dimension | Rating | Basis |
|---|---|---|
| Backend architecture and correctness | Great | Idempotency, DB-side audit hash chain, atomic RPCs, capability canon, near-zero TODO debt. |
| Data model and migrations | Great | 109 migrations, uniform FSM/RLS/audit pattern, exemplary headers. |
| Money loop (quote to cash) | Great | Simulation-proven: balanced auto journal entries on invoice and payment. |
| Documentation and canon | Great | Complete API contracts, user docs, ADRs; honest about its own gaps. |
| Frontend architecture | Good | Routing/gating, bundle discipline, accessibility, money handling. |
| Product breadth | Great | Full spine plus six add-ons is well above the norm at this stage. |
| UX at operator scale | Needs Work | Client-side pagination, native-select pickers, no grid sort/virtualization, no global search. |
| Execution-layer wiring (3PL/WMS/Co-Pack) | Needs Work | Surfaces render but several flows do not complete (see findings). |
| Security posture | Needs Work | Forge-able verify_jwt:false routes, 37 mutable search_path functions, leaked-password off. |
| Performance and scale readiness | Needs Work | 101 unindexed FKs, 88 multiple-permissive-policy tables, full-table list fetches. |
| Auth surface | Needs Work | Password plus magic-link, but no MFA or SSO UI despite capabilities. |
| Commercial traction | Bad | No paying operator, near-zero live usage; v1 gate unmet. |

---

## 4. Strengths to keep and market (proven, not assumed)

1. **The money loop is correct and automatic.** Invoice send posted Dr Accounts Receivable / Cr Sales Revenue; payment posted Dr Cash / Cr Accounts Receivable; invoice reached Paid at zero balance. All balanced, all database-verified.
2. **Audit you can trust and see.** An append-only, per-org hash-chained audit log, verified nightly for tamper and surfaced in the UI as a per-record history with diffs. Every simulated transition produced a hashed row.
3. **Smart data carry-forward.** Quote line snapshotted into the project with a back-reference; project materials auto-populated the invoice line; customer selection cascaded to project, quote, and a NET30 due date.
4. **Idempotency done right.** A transient create failure did not create a duplicate quote.
5. **Additive WMS ledger.** Bin-level stock is a nullable location on the existing append-only ledger; receiving to dock correctly posted a located movement and reconciled the bin rollup to the warehouse total.
6. **Engineering hygiene.** Near-zero TODO debt, no raw SQL, PII-scrubbed telemetry, a 40 kB index bundle budget, a 10-point Definition of Done, and gap-free document numbering via advisory locks.

---

## 5. Consolidated findings by priority

### P0 (fix before a paying operator goes live)
1. **Security: forge-able authenticated routes.** `tenants-api` and `admin-console-api` run verify_jwt:false but only decode the JWT on authenticated routes. `tenants-api` leaks any org's branding and profile today; `admin-console-api` becomes a platform-admin takeover vector once impersonation lands. Split the public route out or verify the signature in-handler.
2. **WMS putaway completes as a no-op.** A directed putaway reached "Done" with a null destination bin and posted no stock movement; bin stock did not change and the goods stayed at the dock (database-verified). Require a destination before completion and post the transfer pair.
3. **Data layer not built for scale.** List pages fetch entire tables and paginate in memory; foreign-key pickers are native selects that load every row; 101 foreign keys are unindexed. Add server pagination and sort, a searchable combobox, and FK indexes.
4. **Paid plugins enable without a billing check.** Admin > Feature Flags lets a tenant self-enable paid add-ons (for example plugins.wms) with no entitlement gate. A revenue leak. Gate enablement behind subscription state.

### P1 (high impact)
5. **Stale UI after every state transition.** No query invalidation: the stepper and action buttons stay on the old state until a manual reload, so transitions look like they failed (seen on quotes, invoices, receiving, putaway). Invalidate on mutation success.
6. **Auth hardening.** No MFA or SSO in the UI; Supabase leaked-password protection is disabled.
7. **3PL execution chain unverified.** Zero job-run daily logs and zero billing reviews have ever existed, so the daily-log-to-movement and billing-review-to-invoice automations are unproven in production. Run the chain in staging and confirm, then instrument it.
8. **No global search.** The search-api and feature flag exist, but there is no command bar in the shell.
9. **Supply Plan not auto-created on project conversion.** The operator must create shortage resolution manually even though the project already knows its materials and warehouse.
10. **Analytics blind spots.** Only the spine job-to-cash funnel emits events; the newer pillars (3PL, WMS, manufacturing, KitForce) emit nothing, so usage of the most differentiated features is invisible.
11. **Breadcrumb taxonomy drift.** Breadcrumbs still use the retired job-mode taxonomy (SELL, MAKE, LIBRARY, GET PAID) while the sidebar uses the pillar IA. Confirmed live on Quotes, Receiving, BOM, and Chart of Accounts.
12. **Item master too thin.** Create exposes only SKU, name, price; no unit of measure, cost, reorder point, barcode, or dimensions, which blocks reorder automation and margin math.

### P2 (correctness and polish)
13. Set search_path on the 37 flagged functions; review the 11 anon-executable definers; collapse 88 multiple-permissive RLS policies; wrap auth calls in 7 init-plan policies.
14. Add a status-equals-from guard to the SELECT-then-UPDATE transitions in invoicing/ops/manufacturing.
15. Drop the JSON line mirrors (one source of truth for receiving/shipment lines).
16. Header-first create on quotes/invoices/receiving/BOM; consider single-screen create-with-lines.
17. Transient "Failed to fetch" with no auto-retry; map form errors to fields rather than one banner string; date-only occurred_at on movements; raw-UUID PO field on receiving.
18. Co-Pack channels are labels with no real Shopify/Amazon connector; CSV import is reported broken for most entities.

---

## 6. Module and workflow ratings (combined)

| Area | Rating | Note |
|---|---|---|
| Quotes (detail, FSM, audit, PDF) | Great | Highlight surface. |
| Finance (double-entry, period close) | Great | Real accounting; statements UI missing. |
| Quote-to-Cash loop | Great (wiring) | DB-verified end to end. |
| Receiving to dock to bin | Good | DB-verified. |
| Document numbering | Great | Advisory-lock, gap-free. |
| CRM, Projects, Catalog/BOM | Good | Solid; BOM entry tedious. |
| Inventory, Invoicing | Good | Scale ceiling on lists. |
| Manufacturing | Good | Movement automation proven. |
| Whitelabel/Branding, Admin | Good | Dark-only; raw flag keys. |
| Customer portal, Audit history | Good to Great | Differentiators. |
| Item master, Global search, Auth UI | Needs Work | Thin/absent. |
| 3PL Job Run / Billing chain | Unrated | Never executed with data. |
| Co-Pack kitting | Okay | Incomplete (no consumption). |
| WMS directed putaway | Bad | Completes as a no-op. |

---

## 7. Recommended sequence

1. **Harden the four P0s** (the two auth holes, the putaway no-op, the paid-plugin gate) and index the foreign keys. These are small, high-severity, and gate go-live.
2. **Build the server-driven data grid and the searchable combobox**, and add the command bar. This single workstream fixes scale, the worst UX friction, and unblocks the skipped end-to-end test.
3. **Fix query invalidation** so transitions feel instant and trustworthy.
4. **Finish and verify the 3PL execution chain** (daily-log movements, billing-review invoice) in staging, then instrument the new pillars in analytics.
5. **Generalize the smart defaulting** already proven in the invoice flow across receiving, putaway, and quotes; bring the Supply Plan inline on the project page; add a live profitability readout on job runs.
6. **Get one design-partner operator onto production** and keep them. The architecture is ready for that operator; the data layer and the items above need to be ready before they arrive.

The through-line of both reports: the hard, load-bearing parts (correct money, tamper-evident audit, idempotency, the additive bin ledger, clean composability) are genuinely built and proven. The remaining work is finishing the follow-through on the newer surfaces and the operator-scale polish, then proving it with a real customer.
