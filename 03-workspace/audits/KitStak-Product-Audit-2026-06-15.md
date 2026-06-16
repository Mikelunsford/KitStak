# KitStak Product Audit and Redesign Recommendation

**Prepared:** 2026-06-15
**Subject:** KitStak (kitstak.com) extended ERP. Spine plus composable add-ons (3PL Operations, Manufacturing, Co-Pack/Ecom, KitForce, KitCost, WMS).
**Stack audited:** React 18 SPA (Vite, Tailwind, TanStack Query), Supabase Postgres plus Deno Edge Functions, Vercel.
**Audience:** Internal engineering and UX backlog. Brutally honest, evidence based, file cited.

## Methodology and access

This audit triangulated four evidence sources, not opinion:

1. **Codebase.** The repo at `KITSTAK V.01 GH 6.15.26 12.50PM` read in depth: the constitution (`CLAUDE.md`), `STATUS.md`, `PROJECT.md`, `DEFINITION-OF-DONE.md`, `00-canon/01-architecture.md`, all ADRs, all 10 API contracts under `docs/api/`, user docs, `apps/web/src` (routing, 178 page files, primitives, lib, auth, whitelabel), and `supabase/functions` (the `_shared` kernel plus a sample of the 30 deployed bundles).
2. **Live database.** The production KitStak Supabase project (80+ tables) queried directly, plus the full security and performance linter (advisors) run against it.
3. **Live application.** The authenticated production app at kitstak.com walked through a logged in session across the spine, 3PL, WMS, finance, and admin surfaces.
4. **Usage analytics.** The KitStak PostHog project (event taxonomy and 30 day volumes).

Rating scale used throughout: **Great, Good, Okay, Needs Work, Bad, Horrible, Scrap.**

A note on usage data. The product has near zero live activity (peak ~30 sign-ins per week in late May, tapering to 5 to 8 per week, with 21 to 27 pageviews in the last two weeks and effectively no recent funnel events). It is pre design-partner. Behavioral UX findings are therefore expert-review based, not traffic driven, and are labeled as such.

---

## 1. Executive summary

KitStak is, for a pre v1 product, an unusually disciplined and broad piece of engineering. A single multi-tenant chassis carries a full ERP spine (CRM, quotes, projects, catalog, inventory, purchasing, invoicing, double-entry finance) plus six composable add-ons gated by feature flags, all on a documented "constitution" that enforces BIGINT-cents money, row level security on every tenant table, forward-only migrations, idempotency on every mutation, an append-only hash-chained audit log, and a byte-identical type/capability mirror between the SPA and the edge functions. The schema runs through migration 0111 with 30 edge-function bundles. This is the work of a team that takes correctness seriously.

The honest headline: **KitStak is architecturally production-grade and commercially pre-launch.** The gating risks to its stated goal ($250K ARR within 18 months, first paying operator live) are not missing features. They are a short list of security-hardening items, a data layer that has not yet been built for scale, and the absence of a live operator. The breadth is real, but breadth shipped fast leaves predictable debt: list views fetch entire tables and paginate in memory, foreign-entity pickers are plain dropdowns that load every row, there is no MFA or SSO in the UI despite the capabilities existing, and analytics instrument only the spine quote-to-cash loop while the newer pillars (3PL job runs, WMS, manufacturing, KitForce) emit no product events at all.

### Overall maturity by dimension

| Dimension | Rating | One line |
|---|---|---|
| Backend architecture and correctness | Great | Idempotency, DB-side audit hash chain, atomic RPCs, capability canon, near-zero TODO debt. |
| Data model and migrations | Great | 109 migrations, 100% DOWN-block coverage, uniform FSM/RLS/audit pattern, exemplary headers. |
| Documentation and canon | Great | Complete API contracts, user docs, ADRs. Documents its own gaps honestly. |
| Frontend architecture | Good | Exemplary routing/gating, bundle discipline, accessibility, money handling. |
| Product breadth | Great | Full ERP spine plus six add-ons on one chassis is far above the norm at this stage. |
| UX at operator scale | Needs Work | Client-side pagination, native-select pickers, no grid sort/virtualization, thin dashboards. |
| Security posture | Needs Work | Two forge-able `verify_jwt:false` routes, 37 mutable search_path functions, 11 anon-executable definers, leaked-password protection off. |
| Performance and scale readiness | Needs Work | 101 unindexed foreign keys, 88 multiple-permissive-policy tables, full-table list fetches. |
| Auth surface | Needs Work | Password-only sign in. No MFA or SSO UI. |
| Analytics and instrumentation | Okay | Clean job-to-cash funnel events. Newer pillars uninstrumented. |
| Commercial traction | Bad | No paying operator, near-zero live usage. The v1 gate is unmet. |

### Top strengths (keep and market these)

1. **Financial loop closure.** Quote to Project to Supply Plan to Job Run to Billing Review to Invoice to Payment is a closed loop with double-entry journal entries posted atomically by trigger. Few SMB tools in this space close the loop this cleanly.
2. **Audit you can trust and see.** The append-only, per-org hash-chained `audit_log` is verified nightly for tamper, and is surfaced to the user as a readable history timeline with per-event diffs on entity detail pages. This is both a compliance asset and a UX differentiator.
3. **Idempotency done right.** Reserve-before-execute with a fail-closed completion write on every mutation. This prevents the double-charge and double-post class of bugs that plagues operational software.
4. **Additive WMS.** Bin-level stock is a nullable `location_id` on the existing append-only ledger, so the sum of bins reconciles to the warehouse total by construction and turning the WMS plugin off leaves the spine untouched. A genuinely elegant design.
5. **Composable add-ons with clean gating.** Plugin bundles gate at both the API (404, surface hidden) and the SPA route. The pillar-grouped sidebar (ADR 0003) is a coherent information architecture.
6. **Engineering hygiene.** Near-zero TODO/FIXME debt, no raw SQL, PII-scrubbed telemetry, a 40 kB index bundle budget enforced in CI, and a 10-point Definition of Done.

### Top gaps and risks (prioritized)

1. **Security: forge-able authenticated routes.** `tenants-api` and `admin-console-api` run `verify_jwt:false` but serve authenticated routes that only decode (do not verify) the JWT. `tenants-api` leaks any org's branding and profile today; `admin-console-api` becomes a platform-admin takeover vector once impersonation wiring lands. Fix before any further admin work. (P0)
2. **Scale: the data layer is not built for volume.** List pages fetch the whole result set and paginate client-side; pickers load every customer/item into a native select; there is no server pagination, sort, or virtualization; 101 foreign keys are unindexed. The app will degrade at a few thousand rows per tenant. (P0 for go-live)
3. **Auth hardening.** Password-only sign in, no MFA or SSO in the UI, and leaked-password protection is disabled in Supabase Auth. (P1)
4. **UX polish that blocks real operators.** No global search affordance surfaced, breadcrumbs still use the retired job-mode taxonomy (SELL, LIBRARY, GET PAID) that ADR 0003 replaced, dashboards are thin, forms are verbose with errors not mapped to fields, and the app is dark-only which limits whitelabel. (P1)
5. **Analytics blind spots.** The newest and most differentiated pillars (3PL job runs, WMS putaway, manufacturing, KitForce labor) emit no events, so you cannot see whether operators use them. (P1)
6. **No operator live.** The single most important gap is commercial, not technical. Everything above is in service of getting a design partner onto production and keeping them. (P0 business)

The rest of this document rates every module, proposes redesigned flows, lays out a prioritized roadmap, and details the technical fixes with file citations.

---

## 2. Module-by-module audit

Each module is rated on three axes where relevant: UI/UX, feature completeness, and technical quality. Citations point at real files, routes, migrations, and tables.

### 2.1 Spine: the always-on backbone

The spine is the strongest part of the product. It is broad, consistent, and financially complete.

#### CRM (Customers, Contacts, Leads, Opportunities, Activities)
- **Rating: Good.** Full list/detail/create/edit quads, kanban for leads and a pipeline for opportunities (`apps/web/src/pages/crm/**`). Tables are clean with status filters.
- **Gaps.** Customer and contact pickers used elsewhere are native `<select>` that load the entire list (`components/ui/pickers/CustomerPicker.tsx`); the Customers list breadcrumb reads "LIBRARY" while the sidebar groups it under CRM (taxonomy drift). No bulk actions, no saved segments, no activity timeline merge across entities.
- **Missing vs competitive CRM.** Email/calendar capture, de-duplication, merge, tasks/reminders, lead scoring beyond a static field.

#### Quotes (job-to-cash entry)
- **Rating: Great (detail), Good (list).** The quote detail page is a highlight: a visual FSM stepper (DRAFT to SENT FOR APPROVAL to APPROVED to PROJECT PENDING), clean line items with correct money rendering, a working "Download PDF" (jspdf worker), and a full audit HISTORY panel with per-event diffs. Backed by `quotes`, `quote_line_items`, `quote_versions`, `quote_approvals`, `quote_templates`.
- **Gaps.** The list offers only a status filter (no search, date, or customer filter) and no column sort. Only the quote number is clickable to open a row (title and row body are inert), a weak affordance. Quote creation is not deep-linkable (`/quotes/new` style paths 404; create is modal/contextual).

#### Projects
- **Rating: Good.** Project conversion from an accepted quote snapshots the template (Wave 12 A4). Phase reordering uses dnd-kit (lazy loaded in `ProjectDetailPage`). Tables and detail are consistent.
- **Gaps.** `project_phases` is empty in practice; phase planning is light. No Gantt or timeline visualization, no critical-path or dependency view.

#### Catalog (Items, Bills of materials, Value-added services)
- **Rating: Good.** Item-keyed BOMs (no standalone BOM table, composed via `bom_items`), VAS catalog, item categories and units. Clean.
- **Gaps.** No variant/matrix items, no kit visualizer, no images on items (consistent with the no-stock-photography rule but operators expect product thumbnails), no barcode/UPC field surfaced.

#### Inventory (Warehouses, Stock levels, Stock movements)
- **Rating: Good (model), Okay (UI).** The append-only `stock_movements` ledger with a derived `stock_levels` rollup is the right design. Movement types are a documented enum.
- **Gaps.** Read-only by design is correct, but there is no reorder-point/min-max, no stock valuation view, no cycle-count workflow at the spine level, no transfer-between-warehouses UI surfaced. Stock lists will hit the same client-pagination ceiling at volume.

#### Purchasing (Vendors, Purchase orders, Vendor bills, Expenses)
- **Rating: Okay.** Tables exist (`vendors`, `purchase_orders`, `po_line_items`, `vendor_bills`, `expenses`) and the API contract is documented, but these tables are empty in production and the UI is the least exercised. Three-way match (PO to receipt to bill) is not evident.
- **Gaps.** No receiving-against-PO link surfaced, no vendor performance, no approval workflow on POs.

#### Invoicing (Invoices, Credit notes, Payments)
- **Rating: Good.** Invoices, credit notes, payments, payment allocations, all in BIGINT cents with currency snapshot. Payment application UI exists. PDF rendering works.
- **Technical note.** Invoice state transitions use a SELECT-then-UPDATE pattern without a `status = from` guard in the WHERE clause (`invoicing-api/handlers/invoices.ts`), a narrow TOCTOU window. See Section 5.
- **Gaps.** No dunning/reminders, no aging dashboard surfaced beyond a single "unpaid invoices" KPI, no partial-payment plans, no customer statement.

#### Finance (Chart of accounts, Journal entries, Period close)
- **Rating: Great.** A seeded standard chart of accounts (Cash, AR, Inventory, AP, Owner Equity, Retained Earnings, Sales/Service Revenue, COGS, OpEx), double-entry journal entries posted atomically by an RPC with a balance check, period close with a posted-period guard that returns 422 on writes to closed periods. Auto-JE triggers carry an idempotency guard (`EXISTS source_type+source_id+status='posted'`). This is real accounting, rare at this stage.
- **Gaps.** No financial statements (P&L, balance sheet, cash flow) surfaced in the UI, no trial balance view, no multi-currency revaluation (exchange_rates table is empty).

**Spine verdict: Good to Great.** The financial spine in particular is a moat. The recurring weaknesses are list-scale and the absence of reporting/statement views on top of the clean ledgers.

### 2.2 Add-on: 3PL Operations
- **Rating: Good (model and flow design), Incomplete (live exercise).** This is the commercial pivot (ADR 0002, Wave 12 Body A). The loop is real: Accounts and rate cards (`three_pl_accounts`, `account_service_definitions`), Job Builders (`job_templates`, `job_template_lines`), Supply Plans (shortage resolution against on-hand stock, `supply_plans`/`supply_plan_lines`), Job Runs with daily logs that post consumed/produced movements (`job_runs`, `job_run_daily_logs`), and Billing Review that produces a draft invoice from estimate-versus-actual (`billing_reviews`). Transitions are atomic SECURITY DEFINER RPCs, the gold standard pattern in this codebase.
- **UX strengths.** The empty states are genuinely instructive: Job Builders and Supply Plans each explain the concept and the role it plays before any data exists. This is excellent onboarding for a complex domain.
- **Gaps.** No live data in the audited tenant, so the populated multi-day Job Run and Billing Review experiences could not be exercised end to end in the UI. No labor/KitForce data flowing into Job Run actuals yet (the link is a nullable soft reference). Profitability is a page, not yet a visualization.

### 2.3 Add-on: WMS (warehouse execution)
- **Rating: Good.** The newest add-on (Wave 12 Body B, migrations 0105 to 0111). Locations (bin/shelf/rack/dock/staging with arbitrary-depth parent nesting), a bin-stock rollup derived from located movements, directed putaway (dock to bin as a transfer pair that keeps the warehouse total flat), and lot/expiration capture with a quarantine hold. The bin-stock empty state correctly explains that "bin rows appear as located movements post to the ledger."
- **Gaps.** This is Phase 1: no FEFO consumption yet (expiration indexed but not enforced), no mobile/scanner UI (the single highest-value WMS addition, see roadmap), no wave/pick-path optimization, no cartonization, no cycle counting at bin level. Bin stock and putaway were empty in the audited tenant.

### 2.4 Add-on: Manufacturing
- **Rating: Good (backend), Light (UI).** `manufacturing_runs` with a draft to started to completed FSM, consumed and produced line items, and a stock-movement emit on completion. Distinct from Pillar 1 production_runs by deliberate decision. 6 runs exist across tenants.
- **Gaps.** No routing/work-center model, no capacity or scheduling, no WIP tracking beyond run state, no yield/scrap analytics. Adequate for light assembly, not for true discrete or process manufacturing.

### 2.5 Add-on: Co-Pack and Ecom
- **Rating: Okay.** Sales channels (manual/shopify/amazon/other registry), sales orders, kitting jobs, and fulfillments (pick/pack/ship with a nullable link to shipments). The FSMs are clean.
- **Gaps.** The channel registry exists but there is no actual Shopify/Amazon integration (no connector, no order sync); channels are a label today. This is the biggest "looks done, is not connected" risk in the product. No rate shopping or carrier labels. See roadmap.

### 2.6 Add-on: KitForce (labor)
- **Rating: Okay.** Workforce members, teams, shifts, work assignments (polymorphic job link), and time entries that snapshot an hourly rate at clock-in and feed KitCost. Rate visibility is capability-gated (only owner/accounting can read `default_hourly_rate_cents`), a thoughtful touch.
- **Gaps.** No scheduling UI beyond shift records, no labor-standard or productivity tracking, no mobile clock-in, no overtime rules. The KitForce-to-Job-Run actuals link is not yet wired.

### 2.7 Add-on: KitCost (cost and margin)
- **Rating: Okay (cannot fully assess).** A dedicated dashboard page that is the only consumer of `recharts` (lazy-loaded so it stays out of the index bundle). Rolls labor (minutes times rate) and materials into job costing.
- **Gaps.** Depends on Job Run and KitForce data that is sparse, so the dashboard could not be exercised with real numbers. No standard-versus-actual cost variance surfaced yet.

### 2.8 Cross-cutting surfaces

| Surface | Rating | Notes |
|---|---|---|
| Dashboard | Okay | Operator-first "TODAY" KPIs (quotes awaiting approval, runs in production, shipments ready, unpaid invoices) are the right idea, but the page is thin, the KPI cards are not confirmed to drill into filtered lists, and WMS is missing from the "PILLARS" launchpad cards though it is in the sidebar. |
| Auth / Identity | Needs Work | Password-only sign in (`AuthContext.tsx`), no MFA or SSO UI despite `org.sso.*` capabilities existing. Clean protected-route and no-active-org handling. |
| Whitelabel / Branding | Good | Runtime CSS-variable theming with a live preview (app-name override, primary/accent colors, logo, favicon, invoice-PDF footer). Limited to a few tokens and dark-only, so a light-brand tenant cannot be served. |
| Admin (Feature flags, Numbering, Members, Billing) | Good | Self-serve flag toggles (bundle plugins plus per-feature flags), numbering sequences, members, Stripe billing. Flags show raw keys and paid plugins appear toggleable independent of billing entitlement. |
| Customer Portal | Good (by design) | Separate guard and surface (`/portal/*`) for invoices, quotes, projects. A real differentiator for a 3PL serving its own customers. Not exercised with live portal users. |
| Global search | Needs Work | A `search-api` and a `feature.global_search` flag exist, but no persistent search affordance was visible in the shell during the walkthrough. For an ERP this should be a always-present command bar. |
| Imports / Exports | Needs Work | Exports work; the CHANGELOG itself flags that CSV import is likely broken for 4 of 5 entities due to column-name mismatches. A known, filed defect. |
| Notifications | Okay | A notifications worker and 35 notification rows exist; in-app delivery surface was not prominent in the shell. |
| Loading / empty / 404 states | Good | List pages use skeletons, empty states are instructive, the 404 ("That page does not exist on this workspace") is on-brand. Inconsistency: detail pages use a bare "Loading." text instead of skeletons. |

**Consolidated module ratings**

| Module | UI/UX | Features | Technical |
|---|---|---|---|
| CRM | Good | Okay | Good |
| Quotes | Great | Good | Great |
| Projects | Good | Okay | Good |
| Catalog/BOM | Good | Okay | Good |
| Inventory | Okay | Okay | Great |
| Purchasing | Okay | Needs Work | Good |
| Invoicing | Good | Good | Good |
| Finance | Good | Good | Great |
| 3PL Operations | Good | Good | Great |
| WMS | Good | Okay | Great |
| Manufacturing | Okay | Okay | Good |
| Co-Pack/Ecom | Okay | Needs Work | Good |
| KitForce | Okay | Okay | Good |
| KitCost | Okay | Okay | Good |
| Auth/Identity | Needs Work | Needs Work | Good |
| Whitelabel | Good | Good | Good |
| Admin | Good | Good | Good |

---

## 3. UX/UI redesign proposals

The visual language (brutalist dark navy, red accent, Bebas Neue display, sharp corners) is distinctive and on brand. The redesign below keeps that identity and the hand-rolled-primitive philosophy. It targets operator productivity and visibility, which is where the leverage is.

### 3.1 Design principles for this redesign
1. **Visibility of critical state first.** An operator should see shortages, exceptions, aging, and "what is blocking shipment today" without navigating. Surface the numbers, then let them drill.
2. **Reduce clicks on the hot paths.** The job-to-cash and receiving-to-putaway loops are the daily grind. Every saved click compounds.
3. **Progressive disclosure.** Dense by default for power users, with detail on demand. Do not hide the audit trail and FSM state; do hide rarely used configuration.
4. **The list is the workspace.** In an ERP, operators live in lists. Lists must sort, filter, paginate server-side, support saved views, and offer bulk actions and inline row actions.

### 3.2 Global shell and information architecture
- **Add a persistent command bar.** A always-visible top-bar search (Cmd/Ctrl-K) backed by the existing `search-api`, spanning customers, quotes, projects, invoices, items, job runs, and SKUs, with type-ahead and keyboard nav. This is the single highest-impact navigation change for an ERP and the backend already exists.
- **Fix the breadcrumb taxonomy.** Breadcrumbs still read SELL, LIBRARY, GET PAID (the retired job-mode IA) while the sidebar uses the pillar-grouped IA from ADR 0003. Align breadcrumbs to the sidebar groups (CRM, QUOTES, FINANCE) so the two navigation systems agree. Also align `docs/design/ui-wireframes.md`, which still documents the old sidebar.
- **Make rows fully clickable.** Today only the entity number opens a record. Make the whole row (or at least the title) navigate, with the number as a secondary copyable id.
- **Sidebar polish.** Persist expand/collapse state per user, remember the last-open pillar, and add a collapse-to-icons mode for wide-table screens. Add WMS to the dashboard pillar cards for consistency.
- **Light mode and richer theming.** Promote the hardcoded `bg.2`, `bg.3`, `line`, `ink.dim` Tailwind values to CSS variables and ship a light theme plus a `prefers-color-scheme` default. This unblocks light-brand whitelabel tenants and accessibility preferences.

### 3.3 The data grid overhaul (highest leverage, applies to ~178 pages)
Replace the current "fetch all rows, slice in memory" list pattern with a single reusable server-driven `DataTable` that every list adopts:
- **Server pagination** via the cursor the API already supports (opaque base64 over created_at,id, limit clamp [1,200]). Retire client-side `rows.slice()` (`InvoicesListPage.tsx`, `Pagination.tsx`, follow-up `F-WS7-SERVER-PAGINATION`).
- **Column sort** (server `order_by`), deferred today as `F-Wave10-UI-KIT-DATATABLE-SORT-01`.
- **Virtualized rendering** for long pages, so 5,000 rows do not mount 5,000 nodes.
- **Saved views** backed by the existing `saved_views` table: per-user named filter/sort/column sets, set as default per list.
- **Bulk selection and a bulk-action bar** (approve, export, assign, status change) with row checkboxes.
- **Inline row actions** (a kebab menu: open, duplicate, download PDF, change status) so the common action does not require opening the detail page.
- **Density toggle and column chooser.**

### 3.4 Redesigned flow: Job-to-Cash (the core loop)
Today the loop spans Quotes, Projects, Supply Plans, Job Runs, Billing Review, and Invoicing as separate destinations. Redesign it as one guided pipeline with a persistent context rail.

Optimized sequence (operator view):
1. **Quote.** From a customer record, "New quote" opens a builder with a real combobox item picker (see 3.7), live margin (pull KitCost rate), and a single "Send for approval" primary action. The FSM stepper (already excellent) stays pinned at top.
2. **Approve to Project.** One action converts the approved quote to a project with the template snapshot. Show a confirmation that names exactly what is being snapshotted.
3. **Supply Plan inline.** On the new project, surface a "Materials" panel that runs the supply plan automatically and shows required/available/reserved/shortage per line with a color-coded shortage badge. Resolve each shortage inline (reserve, inbound, purchase, replenish) without leaving the project.
4. **Job Run.** "Start run" from the project. Daily-log entry is the floor screen: large touch targets, consumed/produced quick-add, labor hours, and a running estimate-versus-actual delta.
5. **Billing Review.** When the run closes, the billing review pre-fills estimate versus actual and one action posts the draft invoice. Show the margin outcome prominently (this is the payoff moment).
6. **Invoice and Payment.** Send invoice (PDF), then record payment with allocation.

Two cross-cutting additions for this flow: a **"job-to-cash" status pipeline view** (a board or horizontal pipeline showing every active job and where it sits in the loop, with the dollar value at each stage), and a **profitability readout** that is live from daily logs, not a separate report.

### 3.5 Redesigned flow: Receiving-to-Putaway (WMS)
This flow is where a scanner-first mobile UX matters most.
1. **Receive against expectation.** Open the receiving order; show expected versus received per line. Scan or key quantities. Capture lot and expiration at the line (the schema supports it).
2. **Receipt posts to dock.** Stock lands at the dock location automatically.
3. **Directed putaway.** The system suggests a bin (capacity and putaway-eligibility from the location attributes). Operator scans the bin to confirm; the transfer pair posts and keeps the warehouse total flat.
4. **Exceptions inline.** Short/over/damaged handled in the same screen with a reason code.

Redesign emphasis: a **mobile/scanner web app** (or PWA) for this flow specifically. The desktop tables are fine for setup and review, but receiving and putaway happen on a cart with a handheld. This is the single most valuable net-new UX surface for the WMS add-on.

### 3.6 Redesigned flow: Inventory reconciliation and shortage visibility
- **Shortage heatmap.** A view that lists every item below reorder point or with open shortages across projects, with the demand source and a one-click resolve. Today shortage lives inside individual supply plans; lift it to a warehouse-wide view.
- **Cycle counting.** A guided count workflow (blind count, variance review, adjustment posting to the ledger) at bin and warehouse grain.
- **Bin map.** A visual warehouse map (zones, aisles, bins) with occupancy and pick density. The hierarchical `warehouse_locations` model already supports the data; this is a visualization on top.

### 3.7 Component and interaction upgrades
- **Combobox / typeahead picker.** Replace the six native-select pickers (`CustomerPicker`, `VendorPicker`, `ProjectPicker`, `QuotePicker`, `InvoicePicker`, `ItemPicker`) with a searchable, server-paged, keyboard-navigable combobox. This fixes the biggest scale and testability gap in one move (it also unblocks the skipped end-to-end quote-to-cash Playwright test, which is blocked precisely because pickers are un-driveable native selects). Build it hand-rolled per the constitution; no Radix needed.
- **Form ergonomics.** Map Zod issues to the per-field `error` prop that `TextInput` already supports, instead of joining all issues into one banner string. Add inline validation on blur. This removes the most common friction in create/edit flows (for example `CustomerCreatePage.tsx`).
- **Consistent loaders.** Use the list skeleton pattern on detail pages too; retire the bare "Loading." text.
- **Modal focus management.** Add a focus trap and focus-restore to `ConfirmDialogHost` (it has role/aria-modal/Escape already; the trap and restore are the gap).
- **Dashboards and KPIs.** Make every dashboard KPI a link to the filtered list. Add per-pillar dashboards (3PL job board, WMS dock/putaway queue, finance AR aging) and an operator home that shows exceptions first.

### 3.8 New artifacts and visibility surfaces (recommended)
- **Profitability heatmap** by job, customer, and SKU (KitCost data).
- **AR aging dashboard** and customer statements (invoicing data already supports it).
- **Financial statements** (P&L, balance sheet, cash flow) on top of the journal entries.
- **Warehouse map and dock/putaway queue** (WMS).
- **Job pipeline board** (job-to-cash kanban with dollar value per stage).
- **Real-time alerts and notifications center**: shortages, approvals waiting, payments overdue, audit-chain breaks, low stock.

---

## 4. Feature roadmap and additions

Prioritized by impact versus effort. Effort is rough (S = days, M = weeks, L = a month or more). "Impact" is weighted toward getting and keeping a first operator.

### 4.1 Must-have before a paying operator goes live (P0)

| Item | Why | Effort |
|---|---|---|
| Server-side pagination + sort on all lists | The app degrades past a few thousand rows; this is the table-stakes scale fix. | M |
| Combobox pickers (replace native selects) | Pickers load entire tables and block end-to-end tests; unusable at scale. | M |
| Close the two `verify_jwt:false` auth holes | `tenants-api` leaks cross-tenant data today; `admin-console-api` is a latent takeover vector. | S |
| Index the 101 unindexed foreign keys | Prevents table-scan and slow cascade behavior under load. | S |
| Enable leaked-password protection; add MFA to the UI | Basic account security for a system of financial record. | S to M |
| Global command-bar search in the shell | Operators cannot navigate a real dataset without it; backend exists. | M |
| Instrument the newer pillars (3PL, WMS, manufacturing, KitForce) | You cannot improve what you cannot see; today only the spine funnel emits events. | S |
| Fix CSV import (broken for 4 of 5 entities) | Onboarding a real operator means importing their data. | S |

### 4.2 High-impact next (P1)

| Item | Why | Effort |
|---|---|---|
| WMS scanner/mobile PWA for receiving and putaway | The highest-value net-new UX; warehouse work is handheld, not desktop. | L |
| Financial statements (P&L, balance sheet, cash flow) and AR aging | The ledgers are clean; the reports on top are missing and customers expect them. | M |
| Job-to-cash pipeline board + live profitability readout | Turns the closed loop into a visible, sellable workflow. | M |
| Saved views + bulk actions on lists | Daily-driver productivity for operators. | M |
| Shopify/Amazon order sync (Co-Pack channels) | Channels are labels today; real connectors make the Co-Pack add-on real. | L |
| Carrier integration (rate shop + labels) for shipments/fulfillments | 3PL and ecom fulfillment expect carrier labels. | L |
| Reorder points + shortage heatmap + cycle counting | Inventory control operators rely on daily. | M |
| Light theme + fuller whitelabel token set | Unblocks light-brand tenants; "whitelabel is a product" per the README. | M |

### 4.3 Nice-to-have (P2)

- Automation/rules engine (for example: auto-create supply plan on project conversion, auto-notify on shortage, auto-dunning on overdue invoice).
- Accounting integration (QuickBooks/Xero export or sync) for operators not ready to run finance in KitStak.
- Manufacturing depth: work centers, routings, capacity scheduling, WIP, yield/scrap.
- KitForce scheduling UI, mobile clock-in, productivity standards.
- Warehouse bin map visualization and pick-path optimization.
- Customer portal self-service (approve quotes, pay invoices via Stripe, track projects).
- API/webhooks for customers to integrate (the edge functions are already a clean API surface).
- AI assists: natural-language search over the audit log, anomaly detection on margins, suggested putaway, demand forecasting. (The PostHog project already ingests LLM trace events, so the plumbing exists.)

### 4.4 Defer or scrap

- **Do not add manufacturing or KitForce depth before the spine and 3PL are exercised by a real operator.** Breadth is already ahead of validation; resist widening further until usage data justifies it.
- **Reconsider the production_runs vs manufacturing_runs split.** Two parallel "run" concepts (Pillar 1 `production_runs` and Pillar 2 `manufacturing_runs`) is a deliberate decision but a likely source of operator confusion; validate that both are needed or converge them.
- **Do not build a native mobile app yet.** A focused responsive PWA for the scanner flow beats a full native app at this stage.

### 4.5 Competitive gaps worth noting
Against established 3PL/WMS/ERP suites (3PL Central/Extensiv, ShipHero, Fishbowl, Cin7, NetSuite at the high end), KitStak's notable missing table-stakes are: carrier/shipping integration, e-commerce channel connectors, barcode/scanner workflows, reorder automation, financial statements, and reporting/BI. Its differentiators that those suites do not match cleanly are: the closed job-to-cash loop with double-entry posting, the user-visible tamper-evident audit trail, idempotent operations, the additive bin-level WMS, and true composability with clean whitelabel.

---

## 5. Technical recommendations

The engineering bar here is high, so these are sharp and specific. Citations are to real files and the live linter.

### 5.1 Security (do first)
- **Split or verify the `verify_jwt:false` functions.** `tenants-api` runs `verify_jwt:false` for a genuinely public host-resolve route, but the same bundle also serves authenticated `GET /branding` and `GET /tenants/me` that only decode the JWT. A forged unsigned token reads any org's branding and profile. Move the public route to its own function and keep authenticated routes under `verify_jwt:true`, or verify the signature in-handler. Same pattern is a latent platform-admin takeover in `admin-console-api` once impersonation lands; the MFA gate there validates the claimed user, not the caller. (P0)
- **Set search_path on the 37 flagged functions.** The constitution requires every RPC to be `SECURITY DEFINER, SET search_path = public`; 37 functions are flagged "Function Search Path Mutable" by the linter, a drift from your own rule and a search-path injection surface. (P1)
- **Review the 11 anon-executable SECURITY DEFINER functions** ("Public Can Execute"). Confirm each is intentionally callable by `anon`; revoke `EXECUTE` from `anon`/`public` where not. (Note: migration 0111 already revoked authenticated EXECUTE on 18 FSM RPCs, so the discipline exists; extend it.) (P1)
- **Enable leaked-password protection** in Supabase Auth (one setting). (P0, trivial)
- **`stripe_webhook_events` has RLS enabled but no policy** (effectively deny-all, fine for a service-role table) and stores the full Stripe event payload, which may include PII. Confirm retention and access match its sensitivity. (P2)
- **Constant-time secret compare** in `notifications-worker` (currently `!==`); negligible risk, trivial fix. (P3)

### 5.2 Performance and scale
- **Index foreign keys.** 101 unindexed foreign keys flagged. Add covering indexes, prioritizing high-traffic and cascade paths (line-item to parent, org_id-denormalized children). (P0 for go-live)
- **Collapse multiple permissive RLS policies.** 88 tables have multiple permissive policies for the same role/action, so Postgres evaluates all of them per query. Consolidate into single policies with OR conditions where possible. (P1)
- **Wrap auth calls in RLS.** 7 policies trigger "Auth RLS Initialization Plan": wrap `current_org_id()`/`auth.*()` calls as `(select current_org_id())` so they evaluate once per query, not once per row. (P1)
- **Server pagination end to end** (see 3.3); retire client-side slicing. (P0)
- **Drop the 2 duplicate indexes and review the 118 unused indexes** once real data exists (unused is expected at current volume; revisit post-traffic). (P2)

### 5.3 Correctness and consistency
- **Add a `status = from` guard to SELECT-then-UPDATE transitions.** `invoicing-api`, `ops-api`, and `manufacturing-api` check the FSM in application code then UPDATE without re-asserting the source state in the WHERE clause, a narrow TOCTOU. Add `.eq('status', from)` and treat a 0-row result as `STATE_CONFLICT`, matching the atomic-RPC pattern that three-pl/wms/finance already use. (P1)
- **Idempotency pending staleness** (`F-Wave10-IDEMPOTENCY-PENDING-STALENESS-01`): a thrown handler can leave a `pending` reservation row until nightly GC. Consider a shorter sweep or a status transition on handler error. (P2)

### 5.4 Schema and migration hygiene
- **Drop the JSON line mirrors.** `0050` normalized receiving/shipment lines into child tables but still dual-writes `payload.lines`; production runs remain JSON-stored entirely. Schedule the multi-stage drop migrations so there is one source of truth. (P1)
- **Document the 0005/0006 gap.** The migration sequence jumps 0004 to 0007 with no note; add a one-line placeholder or CHANGELOG note so the sequence reads as intentional. (P3)
- **Honor the ADR-for-dependencies rule.** jspdf, dnd-kit, posthog-js, and @sentry/react were approved as canon-table footnotes; the canon says new top-level deps require an ADR. Backfill ADRs 0004+ for traceability. (P3)
- **Refresh stale docs.** `docs/api/cross_cutting.md` still lists PDF render and imports as 501 stubs though PDF shipped; `docs/design/ui-wireframes.md` documents the retired job-mode sidebar. (P2)

### 5.5 Frontend and DX
- **Build the combobox and server `DataTable` primitives** (3.3, 3.7); they unblock scale, UX, and the skipped end-to-end test in one move.
- **Close the test gap.** The no-jsdom convention means 73 Vitest specs cover pure logic but not rendered interactions; the full quote-to-cash Playwright chain is skipped because pickers are un-driveable. Adding `data-testid` and a driveable combobox lets the headline e2e flow run in CI. (P1)
- **Re-enable Lighthouse.** The performance budget (LCP/CLS/TBT) is declared in canon and the Definition of Done but disabled (`LIGHTHOUSE_ENABLED` unset due to Vercel preview Deployment Protection 401s). Configure a Protection Bypass secret and turn the gate back on so the "every gate enforced" claim holds. (P2)
- **Extend bundle budgets to lazy chunks.** The 40 kB index budget is enforced, but `sentry-*` (120 kB), `posthog-*` (64 kB), and `supabase-*` (53 kB) lazy chunks have no budget; add ceilings so they do not grow unwatched. (P2)
- **Split `three-pl-api/index.ts` (1,935 lines).** Five sub-domains in one bundle; refactor into a `handlers/` layout like crm/finance/invoicing already use. (P3)
- **Edge-function Sentry capture.** SPA error capture is live; the Deno-side capture (`F-Wave5-CO-01-EDGE-01`) is still open. Close it so backend exceptions are observable. (P2)

### 5.6 What to keep exactly as is
The money model, idempotency kernel, DB-side audit hash chain, capability canon and byte-mirror parity tests, the bundle-gate-returns-404 pattern, forward-only migrations with DOWN blocks and constitutional-alignment headers, and the additive WMS ledger design. These are the load-bearing strengths. Do not refactor them to chase the items above.

---

## 6. Appendices

### Appendix A: Live walkthrough notes (authenticated session, org "T1SS", all add-ons enabled)

| Screen | URL | Observations |
|---|---|---|
| Dashboard | /dashboard | "BUILT TO SHIP." hero, "TODAY" KPI cards (0 quotes awaiting, 0 runs, 0 shipments ready, 1 unpaid invoice), PILLARS launchpad (5 cards, WMS missing). Thin below the fold. Pillar-grouped sidebar confirms ADR 0003. |
| Sidebar IA | n/a | SPINE expands into CRM, QUOTES, PROJECTS, CATALOG, INVENTORY, PURCHASING, INVOICING, FINANCE; one section per add-on; ADMIN group (Settings, Branding, Feature flags, Numbering, Members, Billing, Imports, Exports). |
| Customers list | /customers | Skeleton loading state (good). Search + status filter. Breadcrumb reads "LIBRARY" (taxonomy drift). |
| Quotes list | /quotes | 15 rows, clean table, correct money ($55,000,000.00 and $4,320.96), colored-dot statuses, hyperlinked customer/project. Status filter only, no sort. Breadcrumb "SELL". |
| Quote detail | /quotes/:id | Highlight. FSM stepper, line items, Download PDF, full audit HISTORY with per-event diffs. Only the number opens the row from the list. |
| Job Builders | /3pl-operations/job-builders | Empty state with an instructive concept explanation and CTA. Eyebrow "3PL OPERATIONS" (consistent). |
| Supply Plans | /3pl-operations/supply-plans | Instructive empty state explaining shortage resolution. |
| WMS Locations | /wms/locations | 1 location (PROD-STAGE, Staging, Main Warehouse, Active). Clean. |
| WMS Bin Stock | /wms/bin-stock | Empty state correctly explains bins derive from located movements. |
| Branding | /admin/branding | Whitelabel form (app-name override, primary/accent, logo, favicon, invoice-PDF footer) with a live preview. Two colors only; dark-only. |
| Feature flags | /admin/flags | Self-serve toggle list; all flags enabled for T1SS; raw flag keys shown; paid plugins toggleable independent of billing. |
| Chart of Accounts | /finance/coa | Fully seeded double-entry CoA, color-coded account types. Breadcrumb "GET PAID". |
| 404 | /404 | On-brand "NOT FOUND. That page does not exist on this workspace." with Back to dashboard. |

Notes: no console errors observed during the session. Detail pages use a bare "Loading." text rather than the list skeletons. Responsive could not be visually verified (the capture tool renders at a fixed width); responsive assessment is from code review (AppShell has a hamburger drawer below the md breakpoint; data tables use horizontal scroll rather than reflow).

### Appendix B: Security and performance advisor summary (live linter)

Security (167 WARN, 1 INFO):
- 117 Signed-In Users Can Execute SECURITY DEFINER Function (review; mostly expected for RPCs).
- 37 Function Search Path Mutable (drift from the constitution's RPC rule).
- 11 Public (anon) Can Execute SECURITY DEFINER Function (review and revoke where unintended).
- 1 RLS Enabled No Policy (`stripe_webhook_events`, effectively deny-all, acceptable).
- 1 Leaked Password Protection Disabled (enable).
- 1 Extension in Public (low risk).

Performance (97 WARN, 220 INFO):
- 118 Unused Index (expected at low volume; revisit post-traffic).
- 101 Unindexed Foreign Keys (index before go-live).
- 88 Multiple Permissive Policies (consolidate).
- 7 Auth RLS Initialization Plan (wrap auth calls in a subselect).
- 2 Duplicate Index (drop).
- 1 Auth DB Connection Strategy not Percentage (pooling config).

### Appendix C: Edge-function and API inventory (30 bundles)

idempotency-gc, audit-chain-verify, notifications-worker, auth-api, tenants-api, settings-api, admin-console-api, crm-api, quotes-api, sales-config-api, projects-api, invoicing-api, finance-api, vendors-api, inventory-api, ops-api, three-pl-api, collaboration-api, search-api, customer-portal-api, dashboard-api, exports-api, imports-api, pdf-worker, manufacturing-api, stripe-webhook, billing-api, copack-api, kitforce-api, wms-api.

`verify_jwt:false`: stripe-webhook (SAFE, HMAC verified), notifications-worker (SAFE, shared-secret), tenants-api (RISK, authenticated routes forge-able), admin-console-api (NEEDS REVIEW, latent takeover once impersonation lands).

Request lifecycle (shared kernel): bundle gate (404 if plugin off) to table-driven route to requireCaller (claims) to requireCap (capability) to Zod body/param validation to respondWithIdempotency (reserve-before-execute) to atomic RPC or FSM-guarded update to DB-trigger audit write to `{data,error}` envelope with x-request-id.

### Appendix D: Analytics instrumentation (PostHog project 433097, activated 2026-05-20)

Custom product events captured: `signed_in`, `quote_sent`, `project_converted`, `invoice_sent`, `payment_received`, `time_to_send_invoice`. Plus PostHog autocapture ($pageview, $identify, $rageclick, $exception, $dead_click, $web_vitals). LLM-trace event types are ingested (AI plumbing present).

30-day volumes (weekly): sign-ins peaked ~30 then fell to 5 to 8; pageviews 221, 66, 171, 27, 21 (declining); quote_sent/project_converted/invoice_sent/payment_received in low single digits and zero in the last two weeks. Interpretation: pre design-partner, test/founder usage only.

Instrumentation gap: no events for 3PL job runs, supply plans, WMS putaway/receiving, manufacturing runs, or KitForce labor. The newest and most differentiated pillars are invisible to analytics.

### Appendix E: What was not exercised

Populated 3PL Job Run / Billing Review / Profitability and KitCost dashboards (no live data in the audited tenant), the customer portal with real portal users, multi-role permission differences in the UI (audited as org owner), and visual mobile responsiveness (tooling constraint). The backend behavior of these is covered by the code and contract review.

---

*This audit is evidence based and current as of 2026-06-15. Ratings reflect the state of the audited build and live tenant on that date. The strongest recommendation is also the simplest: harden the short security list, build the server-driven grid and combobox, instrument the new pillars, and get one real operator onto production. The architecture is ready for that operator; the data layer and a few security items need to be before the operator arrives.*
