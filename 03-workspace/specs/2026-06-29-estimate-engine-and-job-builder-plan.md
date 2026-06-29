# Estimate Engine and Job Builder: implementation plan

Date: 2026-06-29
Companion to: ADR 0006 (Estimate Engine and Job Builder)
Status: Proposed (pending operator sign-off)

This plan implements two surfaces the operator designed in Claude design
(`estimateEngine/`, `jobBuilder/`, `BuilderDashboard.tsx`, dropped at repo root)
against the real Kitstak backend. The prototypes are client-side, seed-data,
float-dollar, handoff-styled. The four operator decisions that frame the work:
rebuild the domain layer against real data, give the rate card a real per-org
table plus editor, reconcile the UI to the live system, and write this plan and
ADR 0006 before any production code.

Each phase is its own gated pull request. Every migration halts before merge for
operator sign-off.

## Reuse versus net-new (from the schema recon)

Reused as-is: `quotes-api` and the quote model (tiers, billing interval),
`convert_quote_to_project`, `projects` and `project_line_items` (carry
`source_quote_id` / `source_quote_line_item_id`), `supply_plans` /
`supply_plan_lines` (project-linked, shortage resolution), `job_runs` and the
daily-log chain (project-linked, template snapshot, stock-affecting on post),
`receiving_orders` / `receiving_order_line_items`, `bom_items`.

Net-new: `rate_cards` / `rate_card_lines` (Estimate Engine pricing source), and a
small set of run-scoped job build-artifact tables (job labels with printed data,
structured scope-of-work steps, build/ship timeline dates, approval jacket) that
have no column today and belong to a specific buildable job (the `job_run`), not
a reusable template.

## Money model (applies to every phase that touches price)

- Persisted money stays BIGINT cents, banker's rounding, currency snapshot at
  issuance. No float in a stored money column.
- Rate-card rates are sub-cent, so `rate_card_lines.rate_micros` is a BIGINT in
  millionths of a currency unit (25 dollars an hour is `25_000_000`; 0.0025
  dollars a piece is `2_500`).
- Line total: `cents = roundHalfEven(rate_micros * quantity / 10_000)` (micros to
  cents is divide by 10_000), computed server-side, never in the SPA. The pure
  core ports from `engine.ts` with this substitution and keeps its unit tests.
- The Estimate Engine's result maps to `quote_line_items` in cents through
  `quotes-api`. Tiered estimates map to `quote_tiers` plus tier-scoped lines.

## Phase 0: foundation (no migration, SPA-only)

Goal: land the pure logic and the family/engine config so later phases compose.

- Port `engine.ts` (pricing core) into `apps/web/src/lib/estimate/` converted to
  the cents/micros model, with `engine.test.ts` adapted and passing.
- Port `jobLogic.ts` (BOM rollups, ETA and MABD checks, timeline scale, readiness,
  floor task list) into `apps/web/src/lib/jobbuilder/` with `jobLogic.test.ts`.
- Define the family/engine taxonomy as config (`families.ts`): family to engine,
  default rate-card line keys, facets. This is the seam pillars extend.
- No backend, no routes yet. Verifies the math is correct and covered before any
  wiring.

## Phase 1: Estimate Engine plus rate cards

Migration (HALT before merge):

- `rate_cards` (id, org_id, name, currency_code, is_default, status, audit cols).
  RLS Pattern A.
- `rate_card_lines` (id, org_id, rate_card_id, code, group, label, rate_micros,
  uom, position, audit cols). RLS Pattern A. Unique `(rate_card_id, code)`.
- Seed one default card from the prototype's default rates (converted to micros).
- Audit: `rate_cards` carries a created/updated audit trigger; lines use the
  action-verb audit like other line tables.

Edge:

- `rate-cards-api` (or routes on `settings-api`): list, get, create, patch a card;
  CRUD lines; gated on a new `pricing.rate_card.read` / `.write` capability or an
  existing settings capability. Idempotent non-GET handlers.
- Extend `quotes-api` only if needed for batch line creation; otherwise the
  Estimate Engine convert calls existing quote and line endpoints.

SPA:

- `EstimateEnginePage` and its steps (classify, pricing, line items, result),
  reconciled to the live design system. Reads the org's active rate card. The
  rate-card panel edits lines through `rate-cards-api`.
- Convert: the result builds a real quote via `quotes-api` (header plus lines in
  cents; tiers where the estimate carries quantity breaks), then navigates to the
  new quote detail. Money computed server-side from `rate_micros`.
- A rate-card settings surface under Settings.
- Contract: any new shared type (rate card shapes) added byte-identical to both
  `_shared/types` and `apps/web` mirrors; `pnpm test:contract` gates parity.

## Phase 2: Job Builder plus receiving order

Migration (HALT before merge): run-scoped build artifacts, each RLS Pattern A,
each hung off `job_run` (org_id denormalized):

- `job_run_labels` (label kind, size, printed data jsonb, qty). The design's
  per-kind printed fields (UPC code, ship-to and address, compliance statement,
  lot and date, custom) live in the data jsonb.
- `job_run_sow_steps` (step number, title, detail, optional duration, position).
- `job_run_timeline` (one per run: materials ETA, build start, build end, ship
  date; actuals filled as work progresses). Unique `(job_run_id)`.
- `job_run_jacket` (approval state, approved_by, approved_at, snapshot jsonb).
  A state-machine table, so it carries the auto-state-transition audit trigger.
- Audit-log entity_type CHECK extended as a strict superset for any of these that
  transition state.

Edge (`three-pl-api`, or a focused `job-builder-api`):

- Build-from-quote: given an approved quote, run `convert_quote_to_project`, open
  a draft `supply_plan`, create a `job_run` against the resolved `job_template`,
  and create a `receiving_order` plus `receiving_order_line_items` from the job
  bill of materials (the design's Receiving tab). All idempotency-keyed; cross
  tenant guarded; capability-gated.
- CRUD for the build artifacts (BOM view derived from `bom_items` plus
  `project_line_items`, labels, SOW, timeline, jacket).
- Jacket approve / reject transitions (mirrors the quote-approvals pattern).

SPA:

- `JobBuilderPage` with its tabs (BOM, Receiving, Labels, Scope of work, Timeline,
  Job jacket, Readiness rail), reconciled to the live system. The readiness rail
  and floor task list come from the ported `jobLogic.ts`.

## Phase 3: connect and generalize

- `BuilderDashboard` at `/builder`, launching the two engines. Reconciled UI.
- The hand-off: an approved quote surfaces a Build job action that lands in the
  Job Builder build-from-quote flow. The Estimate Engine result offers Send and
  Build next steps.
- Generalize: add a manufacturing family and its engine through the Phase 0
  config seam, proving a second pillar plugs in without touching the pricing core.

## Per-phase gates

For every phase: SPA typecheck and full ESLint, `deno check` on touched bundles,
the regression suite plus any new tests, `pnpm test:contract` when canon changes,
RLS for new tables, the nightly-probe matrix updated for new tenant tables, and a
green CI run. Migrations validated on staging in a rolled-back transaction before
merge, then shipped to prod by the migrate workflow after operator sign-off.

## Open decisions for the operator

1. Standalone estimates. Should an estimate always create a quote, or also support
   saving a draft estimate that has not yet become a quote? (Affects whether
   Phase 1 needs any estimate persistence of its own, or stays a pure producer.)
2. Jacket gating. Does an unapproved job jacket block `start_job_run`, or is the
   jacket advisory? (Affects whether Phase 2 adds a start guard.)
3. Receiving order creation. Auto-create the RO from the BOM at build time (the
   design's Receiving tab implies this), or leave it operator-initiated and only
   pre-fill? Default in this plan: create a draft RO at build, operator confirms.
4. Rate-card capability. New `pricing.rate_card.*` capabilities (cleaner) versus
   reusing an existing settings capability (no capabilities-canon change).
5. Family generalization timing. Manufacturing family in Phase 3, or deferred to a
   follow-on once 3PL is proven end to end.
