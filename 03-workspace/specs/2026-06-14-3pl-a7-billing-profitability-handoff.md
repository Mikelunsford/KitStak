# Handoff: 3PL A7 (Billing Review and Job Profitability) for a fresh session

Date: 2026-06-14
Wave: 12 (3PL commercial layer)
Parent plan: `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md` (section 6.1 billing_reviews + Job Profitability; section 7 Body A: A7).
Canon: ADR `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`.
Prior phase: A6 Job Runs and Daily Progress, live on prod (PR #261 squash `31bc829`, migrations 0098 to 0101). Closeout: `03-workspace/journal/2026-06-14-3pl-a6-job-runs-closeout.md`.
Start state: main at `31bc829`, max migration `0101`, max audit-CHECK redefinition `0099` (the db-0083 superset pin points there), `seed_org_numbering` last redefined in `0100`. Prod + staging both at 0101 / 99 rows. No open PRs.

A7 is the LAST phase of Body A (the 3PL commercial layer). After it, Body B (WMS B0 to B4) is the only remaining planned work.

## What A7 is

The money-out end of the 3PL loop:

    Job Builder -> Quote -> Project -> Supply Plan -> Job Run -> Daily Logs -> **Billing Review -> invoice draft** + **Job Profitability**

Two deliverables, light scope (KitMeter metered billing stays deferred):

1. **Billing Review.** A `billing_reviews` record is an estimate-versus-actual
   check before invoicing. The operator reviews what a job run (or project)
   actually consumed and produced against what was quoted, then approves. Approve
   creates a spine **invoice draft** (status `draft`) with lines built from the
   run actuals and the account service rates, currency snapshotted at approval.
   The operator finishes and sends the invoice through the existing spine
   invoicing surface. Billing Review does NOT send invoices or take payment.

2. **Job Profitability.** A derived read model (NOT a new write table for A7):
   quote estimate vs job-run actuals (consumption cost plus labor cost) vs billed
   revenue, exposed as a SQL view and a `/3pl-operations/profitability` page. A
   `job_profitability_snapshots` freeze table is a named-not-built later option.

## Decisions to settle FIRST (operator)

These are the A7 analogues of the five A6 decisions. Recommend, then lock before
building (do not re-litigate mid-build).

1. **billing_review numbering prefix.** Plan says `BILL-`. Confirm `BILL-` (it is
   free; the chassis prefixes in use are Q-, INV-, CN-, PMT-, PO-, VB-, EXP-,
   RCV-, SHP-, RUN-, MFG-, SO-, KIT-, FUL-, EMP-, SHF-, WA-, ACC-, JB-, SUP-,
   JR-). Recommend `BILL-`.
2. **Subject grain.** Is a billing_review scoped to ONE job_run, to a project
   (aggregating its runs), or to an account? Plan section 6.1 says it references
   "the account, project, or job run". Recommend: nullable `job_run_id` +
   `project_id` + `account_id` (mirror supply_plans' nullable refs), with the
   PRIMARY grain being the job_run (the natural estimate-vs-actual unit). Confirm.
3. **What the approve path puts on the invoice draft.** Options: (a) one summary
   line per account service rate that applies (rate-card driven, light); (b) a
   line per produced output at the account rate; (c) a single "3PL services"
   summary line. Recommend (a): pull `account_service_definitions` rates for the
   run's account and emit one invoice line per applicable service, quantity from
   the run actuals where a service maps to a measured quantity, else operator-
   edited. Keep it LIGHT; the operator edits the draft before sending. Confirm.
4. **Estimate and actual sources for the review + profitability.** Recommend:
   - Estimate = the project budget (`projects.budget_cents`, rolled up from quote
     line items) or the originating quote total.
   - Actual cost = sum over the run's POSTED daily logs of (consumed
     `quantity * unit_cost_cents`) plus labor (`labor_hours * labor_rate_cents`).
   - Billed revenue = sum of `invoices.total_cents` for invoices tied to the
     project (or to the billing_review, via a breadcrumb). Confirm the keying.
5. **Profitability as a SQL view (not computed-in-edge).** Plan says SQL view.
   Recommend a `view_job_profitability` (or a SECURITY DEFINER function returning
   a set) that the `threepl.profitability.read` cap gates at the edge, RLS-scoped
   by org. Confirm view vs set-returning-function (a view inherits RLS from its
   base tables; a SECURITY DEFINER function must re-apply the org filter).

## Schema (DB-layer slice)

Mirror the A5/A6 migration discipline: forward-only, idempotent, validated on
staging in an aborting transaction, with `db-NNNN` static migration tests.
Suggested numbers (confirm contiguous at apply time): `0102` billing_reviews core
+ approve/cancel RPCs, `0103` BILL- numbering, `0104` the profitability view (or
fold the view into 0102). Confirm the audit-CHECK superset migration carries
`billing_review` and becomes the new db-0083 pin.

- `billing_reviews` (parent, Pattern A, rich FSM). Columns: `org_id`,
  `review_number` (BILL-), `job_run_id` -> `job_runs` (ON DELETE SET NULL),
  `project_id` -> `projects` (ON DELETE SET NULL), `account_id` ->
  `three_pl_accounts` (ON DELETE SET NULL), `invoice_id` -> `invoices` (ON DELETE
  SET NULL; set when approve creates the draft), money snapshot columns as needed
  (`currency_code`, and `_cents` BIGINT estimate/actual totals if you persist them
  rather than re-derive), `status` CHECK (draft / approved / invoiced /
  cancelled), paired `<state>_at` timestamps, `notes`, `payload jsonb`, standard
  `created_*` / `updated_*` / `deleted_at`. FSM: `draft -> approved -> invoiced`;
  `draft|approved -> cancelled`. Auto-state-transition audit trigger (entity_type
  `billing_review`), mirroring `trg_audit_supply_plans` / `trg_audit_job_runs`.
  RLS Pattern A, write gated to the 3PL commercial roles
  `('org_owner','org_admin','ops','sales')` plus consider `accounting` for the
  billing surface (confirm in decision 2/3; the rest of 3PL is the four-role set).
- Optional `billing_review_lines` child IF you persist the proposed invoice lines
  for review before approve (denormalised `org_id`, Pattern A, mirror
  `supply_plan_lines`). If you build the draft lines directly at approve from the
  account rates + actuals, you can skip this table for A7 light scope. Confirm.
- Job Profitability: NO new write table for A7. A SQL view keyed by job_run (and
  project) joining: the estimate source, the posted daily-log actuals (cost), and
  the billed revenue. `job_profitability_snapshots` is the named-not-built later
  freeze option.

## DB logic

- **approve_billing_review(p_id, p_actor, p_caller_org)** SECURITY DEFINER, 3-arg
  cross-tenant guard (NOT_FOUND not 403), idempotent on an already-approved /
  invoiced review: draft -> approved, then create a spine **draft** invoice
  in-org with `nextDocNumber(org, 'invoice')` (INV-), currency snapshotted, and
  invoice_line_items from the chosen source (decision 3). Set
  `billing_reviews.invoice_id` and move status -> invoiced (or keep approved and
  let a separate step mark invoiced; confirm the two-step vs one-step). REUSE the
  spine invoice shape from `0018_invoicing_invoices.sql` (invoices +
  invoice_line_items) and the invoicing-api creation logic; do NOT reinvent
  invoice math. Read `supabase/functions/invoicing-api/handlers/invoices.ts` for
  the authoritative create path and mirror its column set so totals
  (subtotal/tax/total_cents) compute the same way.
- **cancel_billing_review(p_id, p_actor, p_caller_org)** SECURITY DEFINER, 3-arg
  guard, idempotent: -> cancelled. Status-only (does not delete a created
  invoice; a created draft invoice is handled on the spine).
- The profitability view: org-scoped (a plain view inherits base-table RLS; if a
  SECURITY DEFINER set-returning function is used instead, re-apply
  `org_id = current_org_id()` or take a caller-org arg with the 3-arg guard).
- The `convert_quote_to_project` RPC (0094) is the closest precedent for a
  cross-entity SECURITY DEFINER write that reads refs from the in-org row and
  builds child rows; model approve_billing_review on it.

## App layer (mirror A6)

- **Caps** (both byte-mirror canons, byte-identical): `threepl.billing_review.create|update|approve|cancel`
  and `threepl.profitability.read`. Grant the billing_review write caps to the
  3PL commercial roles (owner/admin/ops/sales; add accounting if decision 2 says
  so); grant profitability.read to the same plus viewer/accounting as fits.
  Add to the union once and to the role arrays (replace_all on the prior phase's
  last cap line works). Plan section 6.1 lists
  `threepl.billing_review.create|approve|cancel` + `threepl.profitability.read`;
  add `update` if the review header is editable in draft.
- **Types** (both byte-mirror `threepl.ts`): `BillingReview`, `BillingReviewStatus`,
  Create/Patch, the optional line schema, and a `JobProfitabilityRow` read type
  for the view. Money fields are the wire `Cents` union; quantities numeric.
- **Edge** (`three-pl-api`, already in the deploy BUNDLES list): billing_review
  CRUD; `POST /billing-reviews/:id/approve` and `/cancel` calling the RPCs and
  mapping NOT_FOUND -> 404, STATE_CONFLICT -> 409; `GET /profitability` (and/or
  `/profitability/:jobRunId`) gated by `threepl.profitability.read` reading the
  view. `assertRefInOrg` every spine ref (job_run_id, project_id, account_id,
  invoice_id). `nextDocNumber(caller.orgId, 'billing_review')` on create.
  Idempotency-Key on every non-GET.
- **SPA** (mirror the A6 job-runs pages): `billingReviewsService`,
  `useBillingReviews`, query keys, and `pages/3pl-operations/billing-reviews/`
  List / Detail / Create. The detail hub is an FSM detail (status badge, no
  eyebrow; billing_review FSM not in STATE_STEPPER_PATHS) with the approve/cancel
  cluster and an estimate-vs-actual panel. A `pages/3pl-operations/profitability/`
  page rendering the view (quote estimate vs actual cost vs billed revenue, with
  margin). Routes `/3pl-operations/billing-reviews[/new|/:id]` and
  `/3pl-operations/profitability` (the plan reserved `/3pl-operations/profitability`
  in section 5.2). Sidebar entries "Billing Review" and "Profitability" in the
  3PL OPERATIONS group, after Job Runs, plus the sidebarModes test update
  (exact-paths array + new entry-position tests). `StatusBadge`: confirm
  `approved` / `invoiced` render (add to COLOR_MAP + LABEL_MAP if missing;
  draft/cancelled already mapped).

## Verification (same gate set as A5/A6)

Staging aborting-transaction proof: seed org + account (with a service rate) +
project + job run + a posted daily log carrying consumed/produced/labor actuals,
create a billing_review, approve it, assert a draft invoice + lines were created
with the right currency and totals and that `billing_reviews.invoice_id` is set,
and assert the profitability view returns the expected estimate/actual/revenue
row. Then: contract parity (byte-mirror caps + types), SPA typecheck, lint
(max-warnings 0), full vitest suite plus new `db-NNNN` migration tests, deno check
across all edge bundles, build, size-limit (index under 40 kB gz; keep the new
pages lazy). Update the db-0083 audit-superset pin to the new highest audit-CHECK
migration (the one that adds `billing_review`).

## Reference files to read first

- A6 as the closest precedent end to end: migrations `0098_job_runs.sql`
  (parent + FSM audit + transition RPCs), `0099_job_run_daily_logs.sql` (the
  posted actuals the profitability view reads), `0100_job_runs_numbering.sql`,
  `0101_supply_plan_fulfillment.sql`; edge `supabase/functions/three-pl-api/index.ts`
  (job_run + daily-log routes + the supply-plan fulfill route); types
  `supabase/functions/_shared/types/threepl.ts` (+ the apps/web mirror); SPA
  `apps/web/src/pages/3pl-operations/job-runs/*` and
  `apps/web/src/lib/{services/jobRunsService,hooks/useJobRuns}.ts`.
- The spine invoice draft path A7 reuses: `supabase/migrations/0018_invoicing_invoices.sql`
  (invoices + invoice_line_items shape, status CHECK incl. `draft`) and
  `supabase/functions/invoicing-api/handlers/invoices.ts` + `routes.ts` (the
  authoritative create path; mirror its totals math).
- The cross-entity RPC precedent: `0094_quote_project_template_snapshot.sql`
  (`convert_quote_to_project`, the in-org read-then-build-children pattern).
- The actuals the profitability view sums: the A6 daily-log consumed/produced
  line tables + `labor_hours` / `labor_rate_cents` on `job_run_daily_logs`.
- Numbering: `0100_job_runs_numbering.sql` (the doc_type CHECK extension + seed +
  `seed_org_numbering` redefinition; base the A7 redefinition on 0100, the latest).
- The audit-superset pin to bump: `apps/web/test/regression/db-0083-audit-entity-type-superset.test.ts`
  (currently pinned at 0099; add `billing_review` and move the pin to the A7
  migration).

## Follow-ups to fold in or carry

- F-Wave12-JOB-RUN-INVENTORY-CACHE-01 (A6): posting a daily log does not
  invalidate the SPA inventory query keys; reconcile with the A5 supply-plan
  release/cancel/fulfill hooks if cross-surface freshness matters.
- F-Wave12-JOB-RUN-POST-PAIRING-TEST-01 (A6): edge regression that posts a daily
  log with a valid same-org but wrong run id and asserts 404 with zero movements.
- F-Wave12-SUPPLY-PLAN-FULFILL-CONSUME-01 + F-Wave12-SUPPLY-PLAN-RESERVE-CONTRACT-TEST-01
  (carried from A5/A6).
- New if A7 defers it: F-Wave12-JOB-PROFITABILITY-SNAPSHOT-01 (the freeze table).

## After A7

Body A is complete. Body B (WMS add-on, Phase 1 deepening core) is the only
remaining planned work: B0 chassis (`plugins.wms` flag + `wms-api` bundle), B1
locations and bins, **B2 the additive `stock_movements.location_id` + bin_stock
rollup + sum-reconcile contract test (OPERATOR STOP-POINT: confirm before the
spine column lands)**, B3 directed putaway, B4 lots and expiration. Everything
past B4 (holds, cycle counts, waves, pick-path, pack verification, multi-carrier,
yard/dock) is named-not-promised and needs its own planning pass.

## House rules (unchanged)

- Brand voice on disk: no em dashes, no double hyphens, no emojis.
- Byte-mirror `_shared/types/*` and `apps/web/src/lib/types/*` (and the two
  capability canons) stay identical; money is BIGINT cents; capabilities gate
  every write; the server is authority; migrations forward-only and idempotent;
  RPCs surface cross-tenant as NOT_FOUND not 403; audit_log entity_type CHECK
  extensions are strict supersets.
- Stack onto one branch, push when green, operator reviews the PR before merge.
- Delivery wave is Wave 12.
