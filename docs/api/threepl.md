# three-pl-api

Bundle for the 3PL commercial and operational planning layer (Wave 12): Accounts (A1), Job Builders (A2), Supply Plans (A5), Job Runs (A6), Billing Review (A7), and Job Profitability (A7). Plugin-gated on `plugins.three_pl`; a gate miss returns `404 NOT_FOUND` on every route. Every non-GET handler enforces the `Idempotency-Key` header and `requireCap` before any DB write; the server is authority. Cross-tenant or soft-deleted parents resolve to `404 NOT_FOUND`. Document numbers come from the org-scoped numbering chassis (`nextDocNumber`).

## Accounts (Phase A1)

`three_pl_accounts` is the service-relationship layer over a CRM customer (status active / inactive flag, not a rich FSM); `account_service_definitions` is the per-account Rate Card overlay. `account_number` prefix ACC-.

- `GET /three-pl-api/accounts?status=` cap `threepl.account.create` is not required for read (RLS-scoped)
- `POST /three-pl-api/accounts` cap `threepl.account.create`
- `GET /three-pl-api/accounts/:id`
- `PATCH /three-pl-api/accounts/:id` cap `threepl.account.update`
- `DELETE /three-pl-api/accounts/:id` cap `threepl.account.update` (soft-delete)
- `POST /three-pl-api/accounts/:id/deactivate` and `/reactivate` cap `threepl.account.deactivate`
- `GET /three-pl-api/accounts/:id/services`
- `POST /three-pl-api/accounts/:id/services` cap `threepl.account.service_definition.create`
- `PATCH /three-pl-api/accounts/:id/services/:sid` cap `threepl.account.service_definition.update`
- `DELETE /three-pl-api/accounts/:id/services/:sid` cap `threepl.account.service_definition.delete`

## Job Builders (Phase A2)

`job_templates` is the reusable job engine (variant kit / sidekick / repack / labeling / inspection / custom; status active / inactive flag). `job_template_lines` are the builder definition: component (`item_id`), service (`vas_id`), and step lines. `default_bom_item_id` references `items(id)` (BOMs are item-keyed, no standalone table). `rate_cents` is BIGINT cents. `template_number` prefix JB-.

- `GET /three-pl-api/job-templates?status=&variant=`
- `POST /three-pl-api/job-templates` cap `threepl.job_template.create`
- `GET /three-pl-api/job-templates/:id`
- `PATCH /three-pl-api/job-templates/:id` cap `threepl.job_template.update`
- `DELETE /three-pl-api/job-templates/:id` cap `threepl.job_template.update` (soft-delete)
- `POST /three-pl-api/job-templates/:id/deactivate` and `/reactivate` cap `threepl.job_template.deactivate`
- `GET /three-pl-api/job-templates/:id/lines`
- `POST /three-pl-api/job-templates/:id/lines` cap `threepl.job_template.line.create`
- `PATCH /three-pl-api/job-templates/:id/lines/:lid` cap `threepl.job_template.line.update`
- `DELETE /three-pl-api/job-templates/:id/lines/:lid` cap `threepl.job_template.line.delete`

A Job Builder template can be applied to a draft quote (SPA-thin expansion over the quote-line CRUD), and `convert_quote_to_project` records the template on the resulting project and freezes a snapshot. See `docs/api/sales.md`.

## Supply Plans (Phase A5)

`supply_plans` resolve a project's material demand against on-hand stock; `supply_plan_lines` carry per-item required / available / reserved / shortage quantities and a `resolution` in (reserve, inbound, purchase, replenish). FSM: draft / released / fulfilled / cancelled. `warehouse_id` is where reservations draw from (defaults to the org default at release); `project_id` is the demand source. `plan_number` prefix SUP-.

- `GET /three-pl-api/supply-plans?status=&project_id=`
- `POST /three-pl-api/supply-plans` cap `threepl.supply_plan.create`
- `GET /three-pl-api/supply-plans/:id`
- `PATCH /three-pl-api/supply-plans/:id` cap `threepl.supply_plan.create` (header edits reuse the create cap; status moves via release / cancel)
- `DELETE /three-pl-api/supply-plans/:id` cap `threepl.supply_plan.create` (soft-delete)
- `POST /three-pl-api/supply-plans/:id/release` cap `threepl.supply_plan.release`
- `POST /three-pl-api/supply-plans/:id/cancel` cap `threepl.supply_plan.cancel`
- `GET /three-pl-api/supply-plans/:id/lines`
- `POST /three-pl-api/supply-plans/:id/lines` cap `threepl.supply_plan.line.create`
- `PATCH /three-pl-api/supply-plans/:id/lines/:lid` cap `threepl.supply_plan.line.update`
- `DELETE /three-pl-api/supply-plans/:id/lines/:lid` cap `threepl.supply_plan.line.delete`

`release` calls the SECURITY DEFINER RPC `release_supply_plan`: for each reserve-resolution line it reserves `min(required, available)` by writing a `reserve` stock movement (so the spine `quantity_reserved` reflects the hold) and records the shortage. `cancel` calls `cancel_supply_plan`, which writes `reserve_release` movements to restore the spine reserved. Both surface a missing or cross-tenant plan as `404 NOT_FOUND`, a non-draft release as `409 STATE_CONFLICT`, and a release with no resolvable warehouse as `422 VALIDATION_ERROR`. See `docs/api/inventory.md` for the reserve mechanism.

Phase A6 adds the fulfillment link (0101): `supply_plans.job_run_id` (FK `job_runs`, ON DELETE SET NULL) records the run whose floor execution consumes the plan's reserved stock, and `fulfill_supply_plan` (released to fulfilled) releases the remaining holds by writing `reserve_release` movements and zeroing each line `reserved_qty`, so the spine `quantity_reserved` is restored once the run has consumed the stock. Unlike `cancel` it does NOT restore `shortage_qty` (the demand was met).

- `POST /three-pl-api/supply-plans/:id/fulfill` cap `threepl.supply_plan.fulfill`

## Job Runs (Phase A6)

`job_runs` (0098) is the day-by-day floor execution of a project. Rich FSM `planned` / `in_progress` / `completed` / `closed` (`closed` terminal); `planned` or `in_progress` move to `cancelled`. Paired `<state>_at` timestamps. `job_template_snapshot` jsonb freezes the source template at creation (the A4 shape). `project_id`, `account_id`, `job_template_id`, `warehouse_id` are all nullable (a run can open before every link is known). `run_number` prefix JR- (0100; distinct from the spine `production_run` RUN-). The four FSM transitions run through SECURITY DEFINER RPCs (`start_job_run`, `complete_job_run`, `close_job_run`, `cancel_job_run`), each status-only with no stock effect.

`job_run_daily_logs` (0099) is the stock-affecting layer: one day's work on a run. Small FSM `draft` / `posted`. `labor_hours` and `labor_rate_cents` are the per-day labor actuals; `kitforce_time_entry_id` is a nullable soft link (no FK, validated in-org by the handler). Two child line tables carry the actuals: `job_run_daily_log_consumed_line_items` (item_id REQUIRED) and `job_run_daily_log_produced_line_items` (item_id NULLABLE; descriptive-only lines without an item are skipped on post). Posting calls `post_job_run_daily_log` (draft to posted): when the parent run has a `warehouse_id` it emits `production_consumed` movements for the consumed lines and `production_produced` for produced lines that carry an item, with `source_entity_type = 'job_run_daily_log'`, reusing the existing movement types (no new ledger type), mirroring the manufacturing emit path.

- `GET /three-pl-api/job-runs?status=`
- `POST /three-pl-api/job-runs` cap `threepl.job_run.create`
- `GET /three-pl-api/job-runs/:id`
- `PATCH /three-pl-api/job-runs/:id` cap `threepl.job_run.update`
- `DELETE /three-pl-api/job-runs/:id` cap `threepl.job_run.update` (soft-delete)
- `POST /three-pl-api/job-runs/:id/start` cap `threepl.job_run.start`
- `POST /three-pl-api/job-runs/:id/complete` cap `threepl.job_run.complete`
- `POST /three-pl-api/job-runs/:id/close` cap `threepl.job_run.close`
- `POST /three-pl-api/job-runs/:id/cancel` cap `threepl.job_run.cancel`
- `GET /three-pl-api/job-runs/:id/daily-logs`
- `POST /three-pl-api/job-runs/:id/daily-logs` cap `threepl.job_run.daily_log.create`
- `GET /three-pl-api/job-runs/:id/daily-logs/:lid`
- `PATCH /three-pl-api/job-runs/:id/daily-logs/:lid` cap `threepl.job_run.daily_log.update`
- `DELETE /three-pl-api/job-runs/:id/daily-logs/:lid` cap `threepl.job_run.daily_log.update`
- `POST /three-pl-api/job-runs/:id/daily-logs/:lid/post` cap `threepl.job_run.daily_log.post`
- `GET /three-pl-api/job-runs/:id/daily-logs/:lid/consumed-lines`
- `POST /three-pl-api/job-runs/:id/daily-logs/:lid/consumed-lines` cap `threepl.job_run.daily_log.update`
- `PATCH /three-pl-api/job-runs/:id/daily-logs/:lid/consumed-lines/:cid` cap `threepl.job_run.daily_log.update`
- `DELETE /three-pl-api/job-runs/:id/daily-logs/:lid/consumed-lines/:cid` cap `threepl.job_run.daily_log.update`
- `GET /three-pl-api/job-runs/:id/daily-logs/:lid/produced-lines`
- `POST /three-pl-api/job-runs/:id/daily-logs/:lid/produced-lines` cap `threepl.job_run.daily_log.update`
- `PATCH /three-pl-api/job-runs/:id/daily-logs/:lid/produced-lines/:pid` cap `threepl.job_run.daily_log.update`
- `DELETE /three-pl-api/job-runs/:id/daily-logs/:lid/produced-lines/:pid` cap `threepl.job_run.daily_log.update`

## Billing Review (Phase A7)

`billing_reviews` (0102) is an estimate-versus-actual check before invoicing. Rich FSM `draft` / `approved` / `invoiced` / `cancelled`. The primary grain is the `job_run`; `project_id`, `account_id`, `invoice_id` refs are nullable. `estimate_total_cents`, `actual_total_cents`, `currency_code` are snapshotted at approve. `review_number` prefix BILL- (0103). Write is gated to the 3PL roles PLUS `accounting` (billing is the finance surface).

`approve_billing_review` (draft to approved) creates a spine DRAFT invoice with one line per active `account_service_definition` for the review's account (quantity 1, unit price the rate, no tax / discount), reuses `recompute_invoice_totals` for the totals, snapshots the estimate (the project budget) and the actual (the run's posted daily-log labor plus consumed material cost) onto the review, and sets `invoice_id`. It acquires the invoice number via the chassis `next_doc_number` (override accepted). `invoiced` is reserved for when the spine invoice is later sent. `cancel_billing_review` (draft or approved to cancelled) is status-only and does NOT delete a created draft invoice (the spine owns it). Both RPCs surface a missing or cross-tenant review as `404 NOT_FOUND`.

- `GET /three-pl-api/billing-reviews?status=`
- `POST /three-pl-api/billing-reviews` cap `threepl.billing_review.create`
- `GET /three-pl-api/billing-reviews/:id`
- `PATCH /three-pl-api/billing-reviews/:id` cap `threepl.billing_review.update`
- `DELETE /three-pl-api/billing-reviews/:id` cap `threepl.billing_review.update` (soft-delete)
- `POST /three-pl-api/billing-reviews/:id/approve` cap `threepl.billing_review.approve`
- `POST /three-pl-api/billing-reviews/:id/cancel` cap `threepl.billing_review.cancel`

## Job Profitability (Phase A7)

`view_job_profitability` (0104) is a read-only SQL view, not a write table. One row per non-deleted `job_run`: `estimate_total_cents` (the project budget) versus `actual_labor_cents` plus `actual_material_cents` = `actual_total_cents` (the run's posted daily-log labor plus consumed material cost) versus `billed_revenue_cents` (the project's non-cancelled, non-deleted invoices), with `margin_cents = revenue - actual` (may be negative). Created `security_invoker = true` so base-table RLS scopes each caller to their own org; the edge route is cap-gated. Revenue and the per-day actuals are correlated scalar subqueries so the daily-log and consumed-line fan-out never multiply each other.

- `GET /three-pl-api/profitability` cap `threepl.profitability.read`
- `GET /three-pl-api/profitability/:jobRunId` cap `threepl.profitability.read`

## Capabilities

All `threepl.*` capabilities are granted to the 3PL commercial roles: `org_owner`, `org_admin`, `ops`, `sales`. The SPA mirrors the role policy to hide buttons only; the edge `requireCap` is the authority.
