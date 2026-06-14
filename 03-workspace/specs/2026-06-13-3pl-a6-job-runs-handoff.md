# Handoff: 3PL A6 (Job Runs and Daily Progress) for a fresh session

Date: 2026-06-13
Wave: 12 (3PL commercial layer)
Parent plan: `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md` (section 6.1 job_runs / job_run_daily_logs; section 7 Body A: A6).
Canon: ADR `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`.
Prior phase: A5 Supply Plan, live on prod (PR #257, migrations 0094 to 0097). Closeout: `03-workspace/journal/2026-06-13-3pl-a4-a5-closeout.md`.
Start state: main at `a2feca0`, max migration `0097`, max audit-CHECK redefinition `0096`, numbering `seed_org_numbering` last redefined in `0097`. One worktree, no open PRs.

## What A6 is

The floor-execution layer that closes the 3PL product loop:

  Job Builder -> Quote -> Project (frozen recipe) -> Supply Plan (reserve) -> **Job Run -> Daily Logs** -> actuals

A `job_run` is the day-by-day execution of a project on the floor. It is created
manually (decision D7; auto-create from an accepted project can layer on later).
Each day's work is a `job_run_daily_log` that records what was consumed and
produced plus labor; posting a daily log emits spine `stock_movements` (consumed
out, produced in) exactly like the manufacturing run emit path (migration 0053).
Job Profitability and Billing Review are A7, not A6.

## Decisions (LOCKED by the operator 2026-06-13)

All five are settled. Build to these; do not re-litigate.

1. **`run_number` prefix = `JR-`.** The plan's `RUN-` collides with the spine
   `production_run` doc_type (already `RUN-` in the numbering chassis). Use `JR-`
   for the `job_run` doc_type (distinct, reads as "Job Run"). Add `job_run` ->
   `JR-` to the `numbering_sequences` doc_type CHECK, the per-org seed, and
   `seed_org_numbering` (base the redefinition on 0097, the latest), mirroring
   `0097_supply_plans_numbering.sql` one-for-one.
2. **Reuse the A4 snapshot.** `job_runs` carries `job_template_id` (nullable FK)
   plus `job_template_snapshot jsonb` (nullable), reusing the A4
   `JobTemplateSnapshotSchema` shape byte-for-byte (from `sales.ts`; do not define a
   second snapshot type). At run creation: if it comes from a project that already
   has `projects.job_template_snapshot`, copy that (frozen at convert); if from a
   live template, freeze with the 0094 `jsonb_build_object` block (org-scoped); else
   null.
3. **Child tables under the daily log.** `job_run_daily_log_consumed_line_items`
   (item_id REQUIRED, strict consumed side) and `job_run_daily_log_produced_line_items`
   (item_id NULLABLE, lenient produced side), both denormalised `org_id` for Pattern
   A RLS, mirroring the manufacturing run split (migration 0052). Posting the parent
   daily log emits the movements from these lines.
4. **Fold in the Supply Plan fulfillment link.** Add `supply_plans.job_run_id`
   (nullable FK, closes F-Wave12-SUPPLY-PLAN-JOB-RUN-LINK-01) and a
   `fulfill_supply_plan(plan, actor, caller_org)` RPC (released -> fulfilled) that
   writes `reserve_release` for the remaining held lines, mirroring
   `cancel_supply_plan` but ending in `fulfilled`. This keeps `quantity_available`
   correct: consuming reserved stock no longer leaves a stale hold once the operator
   marks the plan fulfilled. Add a dedicated `threepl.supply_plan.fulfill` capability
   (both byte-mirror canons) and a `POST /supply-plans/:id/fulfill` route, plus a
   Fulfill action on the supply-plan detail page gated to the released state. The
   finer per-consume automatic draw-down stays the follow-up
   F-Wave12-SUPPLY-PLAN-FULFILL-CONSUME-01, not A6-core.
5. **Simple now, scalable by design.** Keep the daily-log consumed/produced lines
   as actuals only for A6: no Planned / Reserved / Staging Requested / Staged
   states (those are WMS warehouse-execution concepts). Scalable means the richer
   lifecycle is purely ADDITIVE later: the WMS phase introduces the staging
   dimension and a per-line `state` column via forward migration, building on the
   A6 actuals tables without restructuring them. Do NOT pre-build staging columns
   now (YAGNI); the contract is that the design must not preclude them, and the
   consumed/produced table split does not. Concretely for scale: keep a
   `payload jsonb` on `job_runs` (header-level extension point, like the other 3PL
   parents) and keep the line tables clean; the future planned-vs-actual and
   staging model attaches as new tables plus a state column, not a rewrite.

## Schema (DB-layer slice)

Mirror the A5 migration discipline: forward-only, idempotent, validated on staging
in an aborting transaction, with `db-NNNN` static migration tests. Suggested
migration numbers (confirm contiguous at apply time): `0098` job_runs core, `0099`
daily logs + line tables + emit/post RPC, `0100` JR- numbering, plus the
`supply_plans.job_run_id` + `fulfill_supply_plan` additions (fold into 0098 or a
small `0101`).

- `job_runs` (parent, Pattern A, rich FSM). Columns: `org_id`, `run_number` (JR-),
  `project_id` -> `projects` (ON DELETE SET NULL), `account_id` -> `three_pl_accounts`
  (ON DELETE SET NULL), `job_template_id` -> `job_templates` (ON DELETE SET NULL),
  `job_template_snapshot jsonb` (frozen at creation, decision 2), `warehouse_id` ->
  `warehouses`, `status` CHECK (planned / in_progress / completed / closed /
  cancelled), paired `<state>_at` timestamps, `notes`, `payload jsonb`, the standard
  `created_*` / `updated_*` / `deleted_at`. FSM:
  `planned -> in_progress -> completed -> closed`; `planned|in_progress -> cancelled`;
  `closed` terminal. Auto-state-transition audit trigger (entity_type `job_run`,
  from_state -> to_state), mirroring `trg_audit_supply_plans` (0096). RLS Pattern A,
  write gated to the 3PL commercial roles `('org_owner','org_admin','ops','sales')`
  (matches the A5 final decision; keep caps and RLS aligned).
- `job_run_daily_logs` (child of job_runs, denormalised `org_id`, Pattern A).
  Columns: `job_run_id` (ON DELETE CASCADE), `log_date date`, `labor_hours numeric(18,4)`,
  `labor_rate_cents bigint` (nullable, `_cents` BIGINT, banker's rounding if ever
  multiplied), `kitforce_time_entry_id uuid` (nullable forward link, D8; NO FK or a
  soft FK to `time_entries` validated in-org), `status` CHECK (draft / posted),
  `posted_at`, `notes`, standard audit columns. Audit entity_type `job_run_daily_log`
  (created / updated / posted action verbs). Posting is the stock-affecting action.
- `job_run_daily_log_consumed_line_items` and `job_run_daily_log_produced_line_items`
  (children of the daily log, denormalised `org_id`, Pattern A). Mirror the 0052
  manufacturing consumed/produced shape: `item_id` (required on consumed, nullable
  on produced), `quantity numeric(18,4)`, `unit_cost_cents bigint`, `uom`, `position`.

## DB logic

- **Post a daily log** (`post_job_run_daily_log(log_id, actor, caller_org)` SECURITY
  DEFINER, 3-arg cross-tenant guard, NOT_FOUND not 403): draft -> posted. When the
  parent run has a `warehouse_id`, insert `production_consumed` movements (negative
  on_hand) for each consumed line and `production_produced` movements (positive
  on_hand) for each produced line, `source_entity_type = 'job_run_daily_log'`,
  `source_entity_id = log_id`. This REUSES the existing `production_consumed` /
  `production_produced` movement types from 0030; no new ledger types are needed
  (unlike A5, which added `reserve`). Idempotent on an already-posted log. Mirrors
  migration 0053.
- **Supply Plan fulfillment** (decision 4): `fulfill_supply_plan` releases the
  remaining holds and ends in `fulfilled`. Add `supply_plans.job_run_id` so a plan
  references its run.
- The run header `complete` / `close` transitions are status-only (no stock
  effect); `cancel` is status-only in A6 (it does not auto-reverse posted
  movements; reversing is an explicit adjustment, out of A6 scope).

## App layer (second slice, mirror A5)

- **Caps** (both byte-mirror canons, `apps/web/src/lib/capabilities.ts` and
  `supabase/functions/_shared/capabilities.ts`, byte-identical): `threepl.job_run.create|update|start|complete|close|cancel`
  and `threepl.job_run.daily_log.create|update|post`. Grant to the 3PL commercial
  roles (owner/admin/ops/sales), matching the RLS. Add to the type union once and
  the four role arrays (replace_all on the prior phase's last cap line works).
- **Types** (both byte-mirror `threepl.ts`): `JobRun`, `JobRunStatus`,
  `JobRunDailyLog`, the consumed/produced line schemas, plus Create/Patch. Reuse
  the A4 `JobTemplateSnapshotSchema` from `sales.ts` for the run snapshot field.
- **Edge** (`three-pl-api`, already in the deploy BUNDLES list): job_run CRUD;
  start/complete/close/cancel status routes (each `requireCap` the matching cap);
  daily_log CRUD under `/job-runs/:id/daily-logs`; line CRUD under the daily log;
  a `POST /job-runs/:id/daily-logs/:lid/post` that calls `post_job_run_daily_log`
  and maps NOT_FOUND -> 404, STATE_CONFLICT -> 409. `assertRefInOrg` every spine ref
  (project_id, account_id, job_template_id, warehouse_id, item_id). `nextDocNumber(caller.orgId, 'job_run')`
  on create. Idempotency-Key on every non-GET.
- **SPA** (mirror the A5 supply-plans pages): `jobRunsService`, `useJobRuns`,
  query keys, and `pages/3pl-operations/job-runs/` List / Detail / Create. The
  detail hub is an FSM detail (status badge, no eyebrow; the job_run FSM is not in
  STATE_STEPPER_PATHS unless you register it) with the transition cluster and a
  DAILY LOGS section (each log expandable to its consumed/produced lines, with a
  Post action gated to draft + cap). Routes `/3pl-operations/job-runs[/new|/:id]`
  (/new before /:id). Sidebar "Job Runs" entry (fourth in 3PL OPERATIONS, after
  Supply Plans) plus the sidebarModes test update (exact-paths array + a new
  entry-position test). `StatusBadge`: add `in_progress` (already mapped),
  `planned` (already mapped), `closed` (already mapped); confirm all five run
  states render (likely only need to verify, not add).

## Verification (same gate set as A5)

Staging aborting-transaction proof of the post path (seed org + warehouse + items
+ run + daily log with consumed/produced lines, post, assert on_hand moved and a
posted log cannot re-post). Then: contract parity (byte-mirror caps + types),
SPA typecheck, lint (max-warnings 0), full vitest suite plus new `db-NNNN` migration
tests, deno check across all edge bundles, build, size-limit (index under 40 kB gz;
keep the job-run pages lazy). Update the `db-0083` audit-superset pin to the new
highest audit-CHECK migration. Stack on one branch; push when green; operator
reviews the PR before merge.

## Reference files to read first

- A5 as the closest precedent end to end: migrations `0096_supply_plans.sql`
  (tables + FSM audit + RPCs), `0097_supply_plans_numbering.sql`; edge
  `supabase/functions/three-pl-api/index.ts` (supply_plan routes + RPC calls);
  types `supabase/functions/_shared/types/threepl.ts` (+ the apps/web mirror);
  SPA `apps/web/src/pages/3pl-operations/supply-plans/*` and
  `apps/web/src/lib/{services/supplyPlansService,hooks/useSupplyPlans}.ts`.
- The emit-movements pattern A6 mirrors: `0052_manufacturing_runs_schema.sql`
  (consumed/produced line tables + FSM audit trigger) and
  `0053_manufacturing_runs_emit_movements.sql` (the post-time movement emission).
- The snapshot to reuse: `0094_quote_project_template_snapshot.sql` (the
  `jsonb_build_object` template-freeze block) and `JobTemplateSnapshotSchema` in
  `apps/web/src/lib/types/sales.ts`.
- Numbering: `0097_supply_plans_numbering.sql` (the doc_type CHECK extension + seed
  + `seed_org_numbering` redefinition; base the A6 redefinition on 0097, the latest).
- The ledger: `docs/api/inventory.md` and `0095_stock_movements_reserve_type.sql`
  (reserve mechanism, in case the per-consume draw-down refinement is taken).

## Follow-ups to fold in or carry

- F-Wave12-SUPPLY-PLAN-JOB-RUN-LINK-01: `supply_plans.job_run_id` (fold into A6).
- F-Wave12-SUPPLY-PLAN-FULFILL-CONSUME-01: automatic per-consume reservation
  draw-down (richer; can stay a follow-up after the `fulfill_supply_plan` decoupled
  approach ships).
- F-Wave12-SUPPLY-PLAN-RESERVE-CONTRACT-TEST-01: sum-reconcile contract test
  (`quantity_reserved` equals the sum of open line `reserved_qty` per warehouse and
  item); good to land alongside the A6 fulfillment work.

## After A6

A7. Billing Review and Profitability: `billing_reviews` (estimate vs actual,
approve creates a spine invoice draft) and Job Profitability (a SQL view plus a
page: quote estimate vs job-run actuals vs billed revenue). Then WMS Body B (B0 to
B4) behind the B2 `stock_movements` `location_id` operator stop-point.

## House rules (unchanged)

- Brand voice on disk: no em dashes, no double hyphens, no emojis.
- Byte-mirror `_shared/types/*` and `apps/web/src/lib/types/*` (and the two
  capability canons) stay identical; money is BIGINT cents; capabilities gate every
  write; the server is authority; migrations forward-only and idempotent.
- Stack onto one branch, push when green, operator reviews the PR before merge.
- Delivery wave is Wave 12.
