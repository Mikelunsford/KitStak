# Closeout: 3PL A6 (Job Runs and Daily Progress)

Date: 2026-06-14
Wave: 12 (3PL commercial layer)
Parent plan: `03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md` (section 6.1, section 7 Body A: A6).
Handoff built to: `03-workspace/specs/2026-06-13-3pl-a6-job-runs-handoff.md` (five operator-locked decisions).
Canon: ADR `docs/adr/0002-spine-plus-addons-and-wms-sixth-addon.md`.
Start state: main at `a42bb55`, max migration `0097`. End state: A6 adds migrations `0098` to `0101` (prod catches up via the post-merge migrate workflow).

## What shipped

The floor-execution layer that closes the 3PL product loop:

    Job Builder -> Quote -> Project (frozen recipe) -> Supply Plan (reserve) -> Job Run -> Daily Logs -> actuals

A `job_run` is the day-by-day execution of a project. Each day's work is a
`job_run_daily_log`; posting a draft daily log emits spine `stock_movements`
(consumed out, produced in) exactly like the manufacturing run emit path,
reusing the existing 0030 `production_consumed` / `production_produced` movement
types. No new ledger type.

### DB layer (migrations 0098 to 0101)

- `0098_job_runs.sql`: `job_runs` parent (Pattern A RLS, rich FSM planned /
  in_progress / completed / closed / cancelled, paired `<state>_at` timestamps,
  `job_template_snapshot jsonb`, spine refs project / account / job_template /
  warehouse all ON DELETE SET NULL). Auto-state-transition audit trigger
  (entity_type `job_run`). Four SECURITY DEFINER transition RPCs
  (start / complete / close / cancel), each the 3-arg cross-tenant pattern
  (NOT_FOUND, never 403), idempotent on its target state, with the FSM guard.
  Extends the audit_log entity_type CHECK with `job_run` (strict superset).
- `0099_job_run_daily_logs.sql`: `job_run_daily_logs` (FSM draft / posted) plus
  the consumed (item_id REQUIRED) and produced (item_id NULLABLE) child line
  tables, all denormalised `org_id` for Pattern A RLS. `post_job_run_daily_log`
  emit RPC: draft -> posted, emits the consumed / produced movements when the run
  has a warehouse, idempotent on an already-posted log, 3-arg guard, parent join
  org-pinned (defense in depth). Extends the audit_log CHECK with the three
  daily-log entity_types (strict superset). The audit-superset pin moves to 0099.
- `0100_job_runs_numbering.sql`: `JR-` numbering. Decision 1: `RUN-` collides
  with the spine production_run doc_type, so the job_run doc_type uses `JR-`.
  Doc_type CHECK + per-org seed + `seed_org_numbering` rebased on 0097.
- `0101_supply_plan_fulfillment.sql`: folds in the Supply Plan fulfillment link
  (decision 4, closes F-Wave12-SUPPLY-PLAN-JOB-RUN-LINK-01). Adds
  `supply_plans.job_run_id` (nullable FK ON DELETE SET NULL) and the
  `fulfill_supply_plan` RPC (released -> fulfilled, writes reserve_release for the
  remaining holds and zeroes reserved_qty so the spine quantity_reserved is not
  left stale; does not restore shortage_qty since the demand was met).

### App layer

- Capabilities (both byte-mirror canons): `threepl.supply_plan.fulfill` plus the
  nine `threepl.job_run.*` caps (create / update / start / complete / close /
  cancel and daily_log.create / update / post), granted to the 3PL commercial
  roles owner / admin / ops / sales.
- Types (both byte-mirror canons): JobRun, JobRunStatus, JobRunDailyLog, the
  consumed / produced line schemas, Create / Patch. `job_template_snapshot` is
  typed as opaque jsonb (the A4 shape, frozen by the handler) so threepl.ts stays
  self-contained (no cross-file import, Deno-safe). `supply_plans.job_run_id`
  added to the read schema (nullable + optional for the deploy window) and the
  create / patch schema.
- Edge (`three-pl-api`): job_run CRUD; start / complete / close / cancel status
  routes; daily-log CRUD; consumed / produced line CRUD; the post route; and the
  supply-plan fulfill route plus job_run_id on supply-plan create / patch. Every
  non-GET requires the matching cap, validates spine refs with `assertRefInOrg`,
  and is wrapped in `respondWithIdempotency`. The snapshot is frozen at run
  creation (build from a live template, or inherit the project's frozen snapshot).
  Line writes and the daily-log delete are gated to a draft parent log so posted
  actuals cannot be mutated after the movements emitted. The post route validates
  the (run, log) pairing before the stock-affecting RPC.
- SPA: `jobRunsService`, `useJobRuns`, query keys, and the
  `pages/3pl-operations/job-runs/` List / Detail / Create pages. The detail hub
  is an FSM detail (StatusBadge, no eyebrow) with the transition cluster and a
  DAILY LOGS section (each log expandable to its consumed / produced lines, with
  a Post action gated to draft plus cap). Routes `/3pl-operations/job-runs[/new|/:id]`
  (/new before /:id). Sidebar "Job Runs" entry, fourth in 3PL OPERATIONS. A
  Fulfill action added to the supply-plan detail page, gated to released.

## Verification

Full gate set green: SPA typecheck, lint (max-warnings 0), contract byte-parity
(caps + types canons identical), 761 unit tests, 30 db regression tests (the new
db-0098 to db-0101 plus the db-0083 audit-superset pin moved to 0099), deno check
across all 20 edge bundles, production build, and size-limit (SPA index 39.76 kB
of the 40 kB budget; the three job-run pages stay lazy).

Staging aborting-transaction proof (seed org + warehouse + items + run + daily
log with consumed / produced lines): the post path moved on_hand by -10 (consumed)
and +4 (produced, the null-item produced line correctly skipped), a re-post did
not double-emit (idempotent), the start / complete / close FSM ran in order, a
cross-tenant call surfaced NOT_FOUND, the numbering yielded JR-2026-00001, and the
supply-plan fulfill released the hold (reserved_qty 0, one reserve_release
movement, status fulfilled) with job_run_id persisting. Re-proven after the review
fixes. Nothing persisted on staging (rolled back); staging remains at 0097.

## Review

Adversarial multi-lens review (constitution / RLS / cross-tenant, DB logic, edge
logic, contract / types, SPA) over the diff, each finding independently verified.
Seven findings, three confirmed real (all LOW), all fixed:

1. `post_job_run_daily_log` parent join is now org-pinned (`and jr.org_id =
   dl.org_id`) so the run warehouse can never be sourced across an unpinned join.
2. `supply_plans.job_run_id` is now wired end to end (read schema + create / patch
   handler + `assertRefInOrg('job_runs', ...)`), not a dead breadcrumb.
3. The post route validates the (run, log) pairing before the emit RPC, so a
   mismatched run id resolves to 404 with no movements written.

The four dismissed findings were intentional patterns (matching the A5 / A4
precedent) or doc-only; the `usePostJobRunDailyLog` comment was corrected.

## Constitutional invariants verified

Money BIGINT `_cents` (labor_rate_cents, unit_cost_cents; no float math). RLS
Pattern A on every new tenant-scoped table from its creating migration, write
gated to the 3PL commercial roles. RPCs surface cross-tenant as NOT_FOUND, never
403. Migrations forward-only and idempotent. Zod and capability canons
byte-identical. Every non-GET handler enforces requireCap plus Idempotency-Key.
audit_log auto-state-transition triggers on every new FSM entity; the entity_type
CHECK extensions are strict supersets. Brand voice on disk: no em dashes, no
double-hyphen prose, no emojis.

## Notes and follow-ups

- A6 ships nine `threepl.job_run.*` capabilities (the handoff prose said six,
  which counted only the create / update / four-transition set and omitted the
  three daily_log caps). The canon comment and the edge routes are the authority.
- Carried: F-Wave12-SUPPLY-PLAN-FULFILL-CONSUME-01 (automatic per-consume
  reservation draw-down; the decoupled `fulfill_supply_plan` ships now, the finer
  draw-down stays a follow-up). F-Wave12-SUPPLY-PLAN-RESERVE-CONTRACT-TEST-01
  (sum-reconcile contract test) remains open.
- New follow-up F-Wave12-JOB-RUN-INVENTORY-CACHE-01: posting a daily log moves
  stock but does not invalidate the SPA inventory query keys (stale for the 30s
  staleTime). This matches the accepted A5 supply-plan release / cancel / fulfill
  pattern; reconcile both together if cross-surface freshness becomes a need.
- New follow-up F-Wave12-JOB-RUN-POST-PAIRING-TEST-01: add an edge regression
  that posts a daily log with a valid same-org but wrong run id and asserts 404
  with zero movements (the guard is in place; the test is not yet authored).

## After A6

A7. Billing Review and Profitability: `billing_reviews` (estimate vs actual,
approve creates a spine invoice draft) and Job Profitability (a SQL view plus a
page: quote estimate vs job-run actuals vs billed revenue). Then WMS Body B
(B0 to B4) behind the B2 `stock_movements` `location_id` operator stop-point.
