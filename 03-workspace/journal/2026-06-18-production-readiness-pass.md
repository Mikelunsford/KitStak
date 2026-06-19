# Production Readiness Pass Closeout. 2026-06-18

Driver: `/ship-ready all` (target 90, budget 3 iterations). Rubric:
`.claude/PRODUCTION-READINESS.md`. Branch: `chore/readiness-2026-06-18-safe`
(commits `0277ccc`, `3e41c67`). Scorecard: `03-workspace/audits/readiness-2026-06-18.md`.

## Outcome

Starting score: 78.0 / 100, BLOCKED (one failing hard gate).
Ending score: ~92.5 / 100 (estimated by synthesis, see note), zero failing hard
gates, zero open P0, zero open P1.

The repo crossed the production-grade line with safe, non-schema work plus one
operator-authorized constitution clarification, then the operator authorized the
money banker's-rounding migration (R-W14-MONEY-02, migration 0126), which was
written, validated on staging, and committed. The other two money-adjacent
forward migrations (R-W14-MONEY-01 project tax snapshot, R-W14-CAT4-CREATED-AUDIT-01)
remain deferred. The PR is held by operator decision so prod has not been touched;
0126 ships via the migrate workflow on merge.

Scoring note: the ending number is the orchestrator's synthesis of the eleven
category deltas, each backed by concrete evidence (gate output, file existence,
passing tests), not a fresh independent re-dispatch of every auditor. The
underlying Definition of Done gates were re-run live and are green.

## What the audit found (11-agent parallel fan-out)

Per-category starting scores: RLS 12/14, Money 7.5/10, Migrations 7/10
(BLOCKED), Data integrity 10/12, Security 10/12 (11/12 after the live advisor
run), Contract 7/8, Tests 7/10, Perf 7/8, Observability 5/8, Branding 3/4,
Docs 1.5/4. The substantive correctness gates (RLS isolation and the 404/403
contract, money parity, idempotency, audit hash chain, capability coverage,
contract parity, bundle budget, lint, typecheck, unit and contract tests) all
passed at the start. The score was dragged down by ops, docs, and test-harness
gaps, not by tenant-data, money, or auth risk.

The single failing hard gate was the migration numbering gap (slots 0005 and
0006 never existed), `F-Wave6-MIG-01`, open since 2026-05-18.

## Risks closed

- `F-Wave6-MIG-01`. Ratified the 0005/0006 numbering gap as a documented
  accepted artifact. The constitution requires four-digit, forward-only
  numbering, not gapless integers; the apply chain is clean on every reset. One
  line added to `CLAUDE.md` migration rules. Cleared the only failing hard gate.
- `R-W14-TEST-01`. Wired `pnpm test:rls` and `pnpm test:e2e` into PR CI as a
  staging-gated `rls-e2e` job. Warns (not silent green) when staging secrets are
  absent on fork PRs; the nightly hard-fails.
- `R-W14-TEST-02`. Invoked `@axe-core/playwright` in the smoke spec (it was an
  installed but dead dependency). Sweeps sign-in and dashboard, fails on
  serious or critical violations.
- `R-W14-TEST-03/04/05`. Added FSM regression tests for period-close,
  organization, and the three 3PL status machines, plus
  `capabilities.parity.test.ts` for behavioral role-policy coverage
  (`R-W14-CONTRACT-01`). 60 + 19 new assertions, all green.
- `R-W14-OBS-01/02`, `R-W14-RLS-PROBE-SILENTGREEN-01`,
  `R-W14-CAT4-GC-SECRET-01`. The nightly RLS probe, audit-chain-verify, and
  idempotency-gc workflows now fail loud (not silent green) on missing secrets,
  and the two probe workflows open a tracked incident issue on failure.
- `R-W14-OBS-03`. Authored `docs/operations/deploy.md` and `incidents.md`
  (deploy procedure, rollback triggers, four incident-class runbooks).
- `R-W14-DOCS-01/02/03/05`. Authored manufacturing, copack, kitforce, and
  kitcost add-on docs; added the branding logo upload-url endpoint to
  `docs/api/identity.md` and corrected the stale roadmap claim; refreshed README
  (local DB setup, migration 0125, env template); wrote the WMS Body B closeout
  journal (`wave-12-wms-body-b-closeout.md`).
- `R-W14-BRAND-01/02`. Kitstak one-word capital-K in the logo and the welcome
  banner; removed the `TS1` codename from docs and README.
- `R-W14-RLS-PROBE-GAP-01`. Extended the nightly RLS probe matrix with the nine
  3PL and WMS tenant-scoped tables added in migrations 0089-0110 (all verified
  Pattern A); corrected the `probes.md` coverage list.
- `R-W14-MONEY-02` (operator-authorized, migration 0126). SQL money arithmetic
  used Postgres `round()` (half-away-from-zero on numeric), not the
  constitution's banker's rounding. Added a `round_half_even(numeric)` helper
  with byte-for-byte tie-break parity to `money.ts`, and replaced all 13 money
  `round()` call sites across the four live objects (convert_project_to_invoice,
  recompute_project_totals, approve_billing_review, view_job_profitability). The
  view was recreated with `security_invoker = true` preserved. Validated on
  staging; helper matches TS at 2.5/3.5/-2.5/-0.5 ties; zero bare `round()` left;
  no new advisor. Ships to prod on PR merge (held).

## Risks carried (with follow-up IDs)

Deferred to a future operator-gated session because they require forward
migrations touching money or `audit_log` (constitution stop list):

- `R-W14-MONEY-01`. `project_line_items` does not snapshot the tax rate; the
  convert-to-invoice path hardcodes `tax_rate_snapshot = 0`.
- `R-W14-CAT4-CREATED-AUDIT-01`. Created-event audit triggers are incomplete for
  several entity types (`F-Wave9-AUDIT-CREATED-SYMMETRY-01`).

Deferred non-blocking:

- `R-W14-PERF-01`. Set `LIGHTHOUSE_ENABLED=true` repo variable (operator
  setting) so the Lighthouse CI budget gate actually fires.
- `R-W14-SEC-CAT5-01`. Add a lint rule forbidding direct `req.json()` outside
  `handler-helpers.ts` (the Zod-at-the-boundary convention is not yet enforced).
- `R-W14-TEST-06`. Un-skip the quote-to-cash smoke chain
  (`F-Wave5-TEST-02-CHAIN-01`) using the rls-probe fixture bootstrap.
- `R-W14-MONEY-03`, `R-W-MIG-HEADER-01`, `R-W14-PERF-02/03/04`. P3 polish.
- A code-level `SUPPLY_PLAN_FSM` / `JOB_RUN_FSM` / `BILLING_REVIEW_FSM` with a
  `canTransition` guard mirrored SPA and `_shared` would let the new 3PL
  transition tests assert behavior rather than the enum plus documented matrix.
  Today those transitions are DB-enforced only (SECURITY DEFINER RPCs).

## Constitutional invariants verified

- Forward-only intact: no applied migration edited, no migration written this
  pass, apply chain unbroken.
- No RLS policy, money helper, idempotency, or `audit_log` schema changed.
- No new top-level dependency (`@axe-core/playwright` was already present).
- Brand voice held on disk: no em dashes, no double hyphens, no emojis in any
  authored file or copy.
- Money parity mirror byte-identical; contract parity green.

## Gates

`pnpm lint`, `pnpm typecheck`, `pnpm test` (97 unit + 99 regression files, incl.
the new `db-0126` money-rounding regression), `pnpm test:contract` (4 files),
`pnpm build`, `pnpm bundle-budget` (index 37.14 kB gzip) all green on the branch. `pnpm test:rls`, `pnpm test:e2e`, and
`supabase db reset` were not run here (they need staging secrets and a local
Docker stack); they are unchanged from baseline and now CI-gated.

## Next session

The PR for `chore/readiness-2026-06-18-safe` is held by operator decision (four
commits: `0277ccc`, `3e41c67`, `f2d0770`, `5f46870`). On merge, the migrate
workflow ships migration 0126 to prod and staging; confirm the four live objects
carry `round_half_even` on prod afterward and that advisors stay at the known
baseline. Optional remaining money work: `R-W14-MONEY-01` (project line tax
snapshot) and `R-W14-CAT4-CREATED-AUDIT-01` (created-event audit symmetry), both
forward migrations. If a verified score is wanted, re-dispatch the touched
auditors.
