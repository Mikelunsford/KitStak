# ADR 0006: Estimate Engine and Job Builder

Date: 2026-06-29
Status: Proposed (pending operator sign-off)

## Context

The operator built two surfaces as standalone prototypes in Claude design and
wants them implemented in Kitstak:

- Estimate Engine. A four-step wizard (classify, price, line items, result) that
  classifies a job into a family (display, co-pack, kitting, fulfillment,
  warehousing, value-add, admin), prices it with the matching engine (time-study
  with a 2.5x labor-cost floor, touch, per-piece, menu, or flat) off an editable
  rate card, applies a 500 dollar project minimum, and produces a sendable quote.
- Job Builder. Takes an approved quote and turns it into a buildable job: bill of
  materials, a receiving order for inbound materials, labels carrying the actual
  printed data per label kind, a scope of work, a timeline checked against the
  must-arrive-by date (MABD), an approval jacket, and a generated floor task list.

Both prototypes are client-side only. Their logic is real and unit-tested
(`engine.ts`, `jobLogic.ts`) but they run on seed data (`CANONICAL_JOBS`,
`BUILD_DETAIL`, a default rate card from a `domain.ts` that was not shipped with
the drop), they compute in floating-point dollars, and they are styled against
the handoff `slate` / `brand` classes rather than the live semantic tokens.

Kitstak already has the backbone these two surfaces need:

- One quote engine (`quotes-api`) with native tiers (ADR 0004) and a recurring
  billing interval (ADR 0005). There is no second quote store, and this work does
  not add one.
- A 3PL commercial chain that already models a buildable job:
  `convert_quote_to_project` produces a `projects` row and `project_line_items`
  from the quote (tier-aware); `supply_plans` and `supply_plan_lines` resolve
  material shortages against stock; `job_runs` execute a project against a frozen
  `job_template` snapshot; `job_run_daily_logs` post actual consumed and produced
  quantities and emit `stock_movements`. `receiving_orders` and
  `receiving_order_line_items` model inbound receipts. `bom_items` model a bill of
  materials under a parent item.

So the implementation is not a green field. It is: wire two designed surfaces to
the existing engines, convert the money model to the constitution's, store the
rate card and the per-job build artifacts that have no home yet, and reconcile the
look to the shipped design system. The operator also notes the family and engine
model, though built for 3PL, generalizes to manufacturing and other pillars.

## Decision

Implement both surfaces against the real backend, in phases, with the following
architectural commitments.

1. One quote engine, still. The Estimate Engine is a producer of quotes through
   `quotes-api`. Its result converts into a real quote (tier-aware where the
   estimate carries quantity breaks). It does not persist its own quote-like
   records. This keeps the one-engine principle intact.

2. Money model. Persisted monetary values stay BIGINT cents with banker's
   rounding, per the constitution. The estimator's per-unit and per-touch rates
   are sub-cent (a labor rate of 25 dollars an hour yields a per-unit cost like
   0.1806 dollars), so rate-card rates are stored at higher precision as a scaled
   integer (`rate_micros`, millionths of a unit of currency). Every line total is
   computed as `roundHalfEven(rate_micros * quantity)` reduced to integer cents
   before it is written to a quote. No float reaches a stored money column, and
   the produced quote snapshots its currency at issuance like every other quote.

3. The rate card gets a home. A new per-org pair, `rate_cards` and
   `rate_card_lines` (RLS Pattern A from their creation migration), holds the
   editable rates the Estimate Engine prices against, with a settings surface to
   edit them. One default card is seeded so the engine works on day one.

4. The Job Builder reuses the 3PL chain and adds only what is missing. The build
   flow from an approved quote is: `convert_quote_to_project`, then a draft
   `supply_plan`, then a `job_run` against the job template, then a
   `receiving_order` created from the job bill of materials. The artifacts the
   design adds that have no column today (labels with their printed data,
   structured scope-of-work steps, the build and ship timeline dates, and the
   approval jacket) are stored as run-scoped tables hung off `job_run`, because in
   the design they belong to a specific buildable job, not to a reusable template.

5. Families and engines are data, not code. The family taxonomy, the engine that
   each family uses, and the rate-card lines a family pulls are configuration so a
   manufacturing family (or any pillar) can be added without forking the pricing
   core. The pricing core (`engine.ts`) ports essentially as written, in cents.

6. Reconcile to the shipped design system. The surfaces keep the prototype's
   layout and flow but are translated to the live semantic tokens and the flat,
   square, Bebas-headed design system, not the handoff `slate` / `brand` classes.

7. Phased delivery. Each phase is its own gated pull request. Every migration
   halts before merge for operator sign-off, per the constitution stop list and
   the large-remediation execution mode. The phased plan lives in
   `03-workspace/specs/2026-06-29-estimate-engine-and-job-builder-plan.md`.

## Consequences

- New tenant tables (`rate_cards`, `rate_card_lines`, and the run-scoped job
  build-artifact tables) carry RLS Pattern A from migration one and are probed.
- The estimator's pure core and the job logic port with their unit tests, so the
  pricing and scheduling math is covered from the first phase.
- The produced quote is a normal `quotes-api` quote: idempotent writes, the audit
  trigger, the capability gates, the currency snapshot, and tier carry-through all
  apply for free.
- The family and engine config is the single place a new pillar plugs in its own
  estimating, which is how this generalizes past 3PL.

## Alternatives considered

- Ship the prototypes as-is. Rejected: float dollars violate the money rules, the
  seed data is not wired to anything, and the handoff styling diverges from the
  shipped system.
- Give the Estimate Engine its own estimate store separate from quotes. Rejected:
  it would be a second quote engine, against the one-engine principle and ADR
  0004 / 0005.
- Hang the job build artifacts off `job_templates`. Rejected: in the design the
  bill of materials, labels, scope, timeline, and jacket describe a specific
  buildable job, not a reusable template. They are run-scoped.
