# Estimate Engine + Job Builder Program Closeout (ADR 0006)

Date: 2026-06-29
Risk IDs: R-W-BUILDER-P2B2-01, R-W-BUILDER-P2C-01, R-W-BUILDER-P3-01
ADR: `docs/adr/0006-estimate-engine-and-job-builder.md`
Plan: `03-workspace/specs/2026-06-29-estimate-engine-and-job-builder-plan.md`
Source: two operator-built Claude-design prototypes dropped at repo root
(`estimateEngine/`, `jobBuilder/`, `BuilderDashboard.tsx`).

## Scope

The operator designed two surfaces in Claude design (a pricing Estimate Engine
and a Job Builder that turns an approved quote into a buildable job) as
client-side, seed-data, float-dollar prototypes. This program rebuilt both
against the real Kitstak backend in the constitution's money model, reused the
existing 3PL chain instead of inventing a parallel one, and generalized the
family/engine model past 3PL so other pillars plug in. Delivered as eleven gated
PRs (#409 to #419) across four phases plus the ADR and plan (#408). Prod main is
at the squash of #419 with the schema through migration 0146.

## Method

Each phase shipped as its own gated PR off `main`: full local Definition of Done
(SPA typecheck and ESLint, `deno check` on touched bundles, the regression and
contract suites, the byte-parity contract when canon changed, production build),
green CI, merge on green. Every migration was validated on staging in a
rolled-back transaction before merge and held for operator sign-off, then shipped
to prod by the migrate workflow and verified on prod. The five operator decisions
the plan left open were settled with the operator as the relevant phase came up.

## Phase 1: the Estimate Engine

- P0 pricing core (PR #409, no migration). The family / engine taxonomy and the
  rate-card math ported from the prototype into a pure, unit-tested library in
  integer cents (`lib/estimate/`), plus the Job Builder logic (`lib/jobbuilder/`).
- P1a schema (PR #410, migration 0144). `rate_cards` + `rate_card_lines`
  (rate_micros, one default card seeded per org) and `estimates` (draft to
  converted or cancelled, inputs jsonb, BIGINT-cents snapshot,
  converted_to_quote_id).
- P1b backend (PR #411, no migration). `rate-cards-api` and `estimates-api` with
  the pricing core mirrored server-side as a Deno copy under a behaviour-parity
  test; convert builds a real quotes-api quote (one quote engine).
- P1c wizard and editor (PR #412, no migration). The four-step estimate wizard,
  the estimates list, and the rate-card editor, reconciled to the live design
  system; convert lands on the real quote.

## Phase 2: the Job Builder

- P2a schema (PR #413, migration 0145). Four run-scoped build artifacts hung off
  `job_run`: labels, scope-of-work steps, timeline, and the approval jacket.
- P2b-1 artifact edge + jacket start-gate (PR #414, no migration). three-pl-api
  CRUD for the artifacts plus the jacket state machine; an unapproved jacket
  hard-gates `start_job_run` (jacketless legacy runs unaffected).
- P2b-2 build-from-quote (PR #415, no migration). One three-pl-api call turns an
  approved quote into a buildable job, reusing the 3PL chain: convert to project,
  draft supply plan, job run inheriting the frozen template snapshot, a draft
  receiving order exploded from the BOM, and a seeded draft jacket + timeline so
  the run lands gated. Every step guarded for idempotent re-runs.
- P2c-1 SPA data layer (PR #416, no migration). Artifact + build-from-quote
  services, hooks, query keys, and the adapter mapping the live backend rows into
  the ported jobLogic `Job` shape so the readiness, schedule, and floor-task math
  stay one implementation.
- P2c-2 the JobBuilderPage (PR #417, no migration). The six-tab builder (BOM,
  Receiving, Labels, Scope of work, Timeline, Job jacket) with the readiness rail
  and floor task list, plus the Build job action on an approved quote.

## Phase 3: connect and generalize

- P3 dashboard + Manufacturing estimating (PR #418, no migration). The `/builder`
  launcher for both engines (showing only engines the org can reach), and
  Manufacturing as a first-class estimating pillar: a family per pricing engine
  added through the family configuration seam alone, reusing existing engines and
  the existing line vocabulary, so the pricing core stayed untouched.
- P3 manufacturing pricing primitives (PR #419, migration 0146). The one part
  that extended the pricing core: machine time and raw materials as
  rate-card-driven primitives (new engine inputs + line branches on both mirrors,
  two seeded rate codes), with raw materials billed only when materials are
  sourced.

## Operator decisions settled

- Standalone estimates: the estimate always produces a real quote (one quote
  engine); no separate quote-less estimate object.
- Jacket gating: an unapproved jacket hard-gates `start_job_run`.
- Receiving order: build-from-quote auto-creates a draft receiving order from the
  job BOM (skipped when the org has no default warehouse or the BOM is empty).
- Capabilities: reuse `settings.*` / `quotes.*` for the estimate surfaces and
  `threepl.job_run.create` for build-from-quote; no capabilities-canon change.
- Manufacturing: built in P3 (not deferred), first-class with the same engine
  breadth as 3PL; pricing primitives are rate-card-driven; raw materials gated on
  sourced materials.

## Constitutional invariants verified

- Money: rate-card rates are `rate_micros`; every line total reduces to integer
  cents by `roundHalfEven`. No float reaches a money column. Receiving costs are
  null at build; project / RO quantities are numeric, not currency.
- RLS: every new tenant-scoped table (rate_cards, rate_card_lines, estimates, the
  four job_run_* artifacts) is Pattern A with org_id and joined the nightly
  cross-tenant probe. Cross-tenant reads stay 200 + empty; cross-tenant run /
  quote ids resolve to 404; bundle-gate misses stay 404.
- Migrations: 0144, 0145, 0146 are forward-only, idempotent, fully headed with
  DOWN blocks, staging-validated in a rolled-back transaction and prod-verified.
- Idempotency: every non-GET handler is idempotency-keyed; build-from-quote rides
  the source quote id in the body and guards each step so a re-run reuses the
  existing chain.
- Audit: the jacket and estimates carry auto state-transition audit triggers; no
  handler hand-writes audit_log. The audit entity-type check was extended as a
  strict superset on 0144 and 0145.
- Zod canon: families.ts, rateCard.ts, and the estimate / jobbuilder type modules
  are byte-identical across the SPA and Deno mirrors (test:contract green); the
  two engines are behaviour-parity tested rather than byte-identical (import
  specifiers differ).

## Follow-ups and deferrals

- F-Wave-BUILDER-P1B-ESTIMATE-NUMBERING-01: estimates.number is null (no
  'estimate' doc-type seed yet; needs a migration).
- Entitlement edge: an org without plugins.three_pl can convert an estimate into
  a quote it then cannot view through the gated quotes-api. Documented at P1b;
  deferred to an entitlement story.
- Job Builder output-unit model: a Kitstak project is multi-line with no single
  output-unit count, so the adapter uses outputUnits = 1 and the generated
  floor-task "count to N output units" line is approximate for multi-line jobs.
  An explicit output-unit field is a clean follow-on.
- Manufacturing-specific extensions beyond machine time and raw materials (for
  example per-machine rates or material bills) would extend the engine further;
  out of scope here.
- PR #409 (P0 logic) and #416 (P2c-1 data layer) are internal-only (no migration,
  no surface) and are folded into adjacent CHANGELOG entries rather than carrying
  their own.

## Net result

ADR 0006 is complete end to end: two prototypes are now real, wired to the
backend, reusing the 3PL chain, generalized past 3PL through a config seam, and
live on prod through migration 0146. One quote engine; money in cents; the Job
Builder builds off the real chain.
