# Wave 12 closeout: 3PL A7 (Billing Review and Job Profitability)

Date: 2026-06-14
Wave: 12 (3PL commercial layer)
Phase: A7, the LAST phase of Body A. After this, Body B (WMS) is the only remaining planned work.
Branch: `claude/3pl-a7-billing-profitability` (off main `dd05e2c`).
Parent plan: `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md` (section 6.1, section 7 Body A: A7). Handoff: `03-workspace/specs/2026-06-14-3pl-a7-billing-profitability-handoff.md`.

## Scope

The money-out end of the 3PL loop. Two deliverables, light scope (KitMeter metered billing stays deferred):

1. Billing Review. An estimate-versus-actual check before invoicing. Approve creates a spine DRAFT invoice with lines from the account service rates, snapshots currency and the estimate and actual totals, and sets `invoice_id`. The operator finishes and sends the invoice on the existing spine invoicing surface. Billing Review does not send invoices or take payment.
2. Job Profitability. A derived read model (no new write table): quote estimate vs job-run actuals vs billed revenue, exposed as a SQL view and a `/3pl-operations/profitability` page.

## Decisions locked (operator)

Three settled live via the question prompt, two by grounded recommendation:

1. Invoice draft lines on approve: ONE line per active `account_service_definition` for the review's account (description = service name, quantity 1, unit_price_cents = rate_cents, no tax or discount). Operator fills quantities before sending. Zero lines when there is no account.
2. Approve FSM: approve creates the draft invoice and lands the review in `approved` (sets `invoice_id`). `invoiced` is reserved for when the spine invoice is actually sent and is not auto-reached in A7.
3. Roles: `threepl.billing_review.create|update|approve|cancel` granted to org_owner, org_admin, ops, sales, and accounting (the 3PL set plus accounting, the finance surface). `threepl.profitability.read` to those plus viewer.
4. `BILL-` numbering prefix. Grain is nullable `job_run_id` + `project_id` + `account_id`, primary grain the job_run (mirrors supply_plans).
5. Estimate = `projects.budget_cents`. Actual = posted daily-log labor (`labor_hours * labor_rate_cents`) plus consumed material (`quantity * unit_cost_cents`). Revenue = sum of `invoices.total_cents` where `project_id` matches the run's project and the invoice is not cancelled or deleted. `invoices` carries `project_id` (confirmed), so the keying needs no breadcrumb. Profitability is a SQL view with `security_invoker = true`. No `billing_review_lines` child table.

## DB layer

Three forward migrations, applied to staging only as an aborting transaction during the build (the post-merge file-based push ships them to prod and staging).

- `0102_billing_reviews.sql`: the parent table (Pattern A RLS, write gated to the five roles including accounting), the FSM audit trigger (entity_type `billing_review`), and the two RPCs. `approve_billing_review` is a 4-arg cross-tenant guarded SECURITY DEFINER write that reads its refs from the in-org review row, acquires the invoice number the chassis way (`next_doc_number('invoice')`), cuts a spine DRAFT invoice, builds one line per active account service rate, recomputes totals via `recompute_invoice_totals` (it never reinvents invoice math), snapshots currency and the estimate and actual, and sets `invoice_id`. It is idempotent on an already approved or invoiced review and surfaces cross-tenant as NOT_FOUND, never 403. `cancel_billing_review` is the 3-arg status-only cancel. Models `convert_quote_to_project` (0094).
- `0103_billing_reviews_numbering.sql`: the `BILL-` doc_type (CHECK superset, per-org seed, `seed_org_numbering` rebased on 0100).
- `0104_job_profitability_view.sql`: `view_job_profitability` with `security_invoker = true`. Correlated scalar subqueries for labor, material, and revenue so the per-run grouping is free of daily-log and consumed-line fan-out, and revenue is not multiplied. margin = revenue minus actual.
- The audit_log entity_type CHECK in 0102 is a strict superset of the 0099 list plus `billing_review`. The `db-0083` audit-superset pin moved from 0099 to 0102 (discovery array gains 102, `billing_review` present-assertion added).
- New static regression tests: `db-0102`, `db-0103`, `db-0104`.

### Staging proof

One aborting transaction on staging (`dnkgaufydcnedgkuoyml`): the full 3-migration DDL plus a seeded fixture (org, customer, account with two service rates, project with a budget, job run, a posted daily log with labor and a consumed line), then approve, then assertions, then rollback. Nothing persisted; staging stayed at 0101. Eighteen assertions passed, including: approve creates the draft invoice with one line per service def, recompute totals, the currency and estimate and actual snapshot, the view margin, idempotent re-approve (still one invoice), and the cross-tenant NOT_FOUND probe.

## App layer

- Capabilities: five new caps in both byte-mirror canons, granted to the locked roles. Accounting received its first 3PL block.
- Types: `BillingReview` (plus Status, Create, Patch) and `JobProfitabilityRow` in both byte-mirror `threepl.ts` files, identical.
- Numbering: `'billing_review'` added to the `DocType` union in `_shared/numbering.ts` (deno check requires it).
- Edge (`three-pl-api`): billing_review list, create, detail, patch, soft-delete, approve, cancel, plus `GET /profitability` and `GET /profitability/:jobRunId`. Reads are RLS-only (mirroring job_run); writes are cap-gated; the approve and cancel routes call the RPCs and map NOT_FOUND to 404 and STATE_CONFLICT to 409. Every inbound FK is validated with `assertRefInOrg`. The profitability reads explicitly filter by `caller.orgId` because the service-role client bypasses RLS (the view's `security_invoker` is only a backstop). Every non-GET is wrapped in `respondWithIdempotency` with a distinct route template.
- SPA: `billingReviewsService`, `jobProfitabilityService`, `useBillingReviews`, query keys, the billing-reviews List, Detail (FSM hub, no eyebrow, estimate-versus-actual panel, approve and cancel cluster, a link to the created spine invoice), and Create pages, plus a Profitability report page. Routes under `/3pl-operations/billing-reviews` and `/3pl-operations/profitability`. Sidebar gained Billing Review and Profitability after Job Runs. StatusBadge gained `invoiced` (`approved`, `draft`, `cancelled` were already mapped). All A7 pages are lazy chunks.

## Gates (all green)

- contract parity 27 (byte-mirror types and caps identical)
- typecheck, lint (max-warnings 0)
- regression 519 passed including the new `db-0102`, `db-0103`, `db-0104` and the moved `db-0083`; src unit 763 passed
- build, deno check 29 bundles
- size-limit all budgets pass; SPA index 39.99 of 40 kB gz (see flag below)

## Adversarial review

Four review lenses (SQL logic, tenancy and security, constitution and mirrors, SPA contract) followed by a refute-pass verification on every finding. Four findings confirmed, all the SAME comment-accuracy issue and all LOW or MEDIUM: a stale `BR-` prefix in three comments (the actual seeded prefix is `BILL-`) and one type-canon comment misstating that `invoice_id` is filled at `invoiced` (it is filled at approve). All fixed in both byte-mirror files identically (parity preserved). The review verified the approve RPC logic, the view fan-out, the profitability cross-tenant org filter, the byte-mirror identity, and the role grants are all correct. Zero logic, security, money, or contract defects in the shipped code.

## Constitutional invariants verified

- Money is BIGINT cents; the issued invoice line amounts use integer `rate_cents` with no rounding. See the rounding caveat below for the derived analytic.
- RLS Pattern A from the creation migration; cross-tenant via the RPCs is NOT_FOUND, never 403.
- Idempotency-Key on every non-GET edge handler, distinct templates.
- Byte-mirror types and caps identical (contract parity green).
- audit_log entity_type CHECK is a strict superset; the hash chain and append-only posture are untouched.
- Migrations forward-only and idempotent; no existing numbered file edited.
- Brand voice on disk: no em dashes, no prose double hyphens, no emojis in the new and edited files.

## Flags and follow-ups

- F-Wave12-A7-PROFITABILITY-ROUNDING-01. The profitability view and the billing_review estimate and actual snapshot compute `quantity * cents` with SQL `round()` (half away from zero), not the constitution's `roundHalfEven`. This is a DERIVED read model only. The issued invoice line amounts use integer `rate_cents` directly, so the books are exact. Reconcile if strict banker's rounding is wanted on the derived analytic.
- F-Wave12-INDEX-BUDGET-HEADROOM-01. The SPA index is at 39.99 of 40 kB gz. A7 is as lean as it can be (all A7 pages are lazy chunks; the growth is only the four route declarations plus two sidebar entries). Operator decision 2026-06-14: SPLIT to reclaim headroom and keep the 40 kB budget; do not raise it now (the raise is reserved for a deliberate UI and navigation investment later). This is the recommended next task and a prerequisite for WMS B0. Full startable plan in the section below.
- Brand-voice debt (observation, not swept this PR): the existing `db-NNNN` regression test scaffolding pervasively uses em dashes in header comments and `describe()` strings. A7's new tests were written clean. A repo-wide sweep is optional and was left untouched to avoid scope creep.
- F-Wave12-JOB-PROFITABILITY-SNAPSHOT-01 (named, not built). The `job_profitability_snapshots` freeze table, if frozen numbers are wanted later.

### Carried from A6 and A5

- F-Wave12-JOB-RUN-INVENTORY-CACHE-01, F-Wave12-JOB-RUN-POST-PAIRING-TEST-01.
- F-Wave12-SUPPLY-PLAN-FULFILL-CONSUME-01, F-Wave12-SUPPLY-PLAN-RESERVE-CONTRACT-TEST-01.

## SPA index budget lean-up (startable on a fresh session)

Follow-up `F-Wave12-INDEX-BUDGET-HEADROOM-01`. A standalone front-end-only task to ship BEFORE WMS B0. A fresh session can start from this section cold.

Goal. Reclaim headroom under the existing 40 kB gz SPA index size-limit budget so WMS B0 and future phases can add eager navigation and route weight without raising the budget. Hold the budget at 40 kB now. Raise it later only as a deliberate UI and navigation investment, never to absorb phase creep.

Why now. As of A7 the SPA index chunk is 39.99 of 40 kB gz (the `size-limit` measurement, which is the gate). Each phase adds eager weight: route declarations, sidebar entries, and the lucide icons those entries reference. WMS B0 adds a whole `/wms` sidebar section (four entries plus icons) and the `/wms` home route, which is more eager weight than A7 added and will exceed the budget. Splitting keeps first paint lean and fast and keeps the gate meaningful; raising the budget would ship the same or more bytes and only silence the warning.

Start here, analysis first.
1. Measure what is actually in the index chunk. Run `pnpm build` (it emits sourcemaps to `apps/web/dist/assets/index-*.js.map`), then a one-shot sourcemap size analysis such as `npx source-map-explorer apps/web/dist/assets/index-*.js` or `npx vite-bundle-visualizer`. Do NOT add either as a project dependency (npx one-shot only; a new top-level dependency triggers the constitution-review checklist). Rank the eager modules by gzip contribution and identify the top contributors. Do not assume; let the data pick the cuts.
2. Likely suspects to confirm against the analysis.
   - The sidebar navigation config and its lucide-react icons. The shell renders the sidebar eagerly, so every sidebar icon across every pillar is in the index (roughly thirty-plus icons). The highest-leverage single cut is usually to lazy-load the sidebar or move its icons behind a dynamic registry so the config and icon set leave the index, accepting a tiny first-paint nav placeholder.
   - The `ROUTES` table metadata. The router needs every route path eagerly to match, so this grows per route. The structural lever is per-pillar lazy route-group loading (this is the existing `F-Wave10-INDEX-SPLIT` follow-up).
   - Any shared util, Zod schema, or context eagerly imported into the shell but only needed by lazy pages. Verify nothing leaks; a schema module pulled eager inflates the index.
3. Make the one or two highest-leverage cuts. Re-run `pnpm build` and `pnpm --filter web bundle-budget` and confirm the index drops with real headroom (target a few kB of slack, for example at or under 37 kB, so the next two or three phases fit).

Constraints and gates.
- Keep the `size-limit` SPA index budget at 40 kB. Do not raise it. When a deliberate UI and navigation investment comes later, still lazy-load heavy UX surfaces and raise the budget only for the genuinely eager shell.
- Front end only. No edge, migration, money, RLS, audit, or idempotency changes. No new top-level dependency (npx one-shot tools only for the analysis).
- All existing gates stay green: typecheck, lint (max-warnings 0), the full test suite (watch the `sidebarModes` exact-paths test if the sidebar structure changes), canon-steward, build, and `size-limit`. `deno check` is unaffected (no edge change).
- Brand voice on disk.
- Ship as its own small standalone PR before WMS B0. WMS B0 is blocked on this; B0 adds eager nav weight with zero current headroom.

Pairs with `F-Wave10-INDEX-SPLIT` (the per-pillar route-table split lever).

## Second deliverable: WMS Body B plan

The WMS Body B (Phase 1 deepening core, B0 to B4) implementation handoff was written this session: `03-workspace/specs/2026-06-14-wms-bodyb-phase1-handoff.md`. It is build-ready: the B0 chassis checklist (the `plugins.wms` flag in both mirrors, the `inferPluginForPath` clause, the `wms-api` bundle and gate, the deploy BUNDLES entry, the WMS sidebar section, the provisioning seed), B1 locations and bins, B2 the additive nullable `stock_movements.location_id` plus the `bin_stock_levels` rollup whose recompute is byte-identical to the spine's so bins sum to the warehouse total by construction, B3 directed putaway, and B4 lots and expiration. B2 is the constitutional stop-point: the operator confirms before the spine column lands, and the sum-reconcile contract test ships in the same PR.

## On merge

The migrate workflow applies 0102, 0103, and 0104 to prod and staging. deploy-functions ships the updated `three-pl-api` bundle. Body A is then complete. Body B (WMS) is the only remaining planned work, gated behind the B2 stock_movements stop-point.
