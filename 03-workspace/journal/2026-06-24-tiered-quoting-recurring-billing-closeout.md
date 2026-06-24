# Closeout: native tiered quoting (ADR 0004) and recurring billing (ADR 0005)

Date: 2026-06-24. Continues the 2026-06-23 quote-flow and P2 handoff
(`2026-06-23-quote-flow-and-p2-handoff.md`). This wave took the two accepted P2
ADRs from foundation to end-to-end and closed the deferred security follow-up.

## Scope

- ADR 0004 native tiered quoting (Option A): a quote becomes many quantity-break
  tiers under one document and one number; only the accepted tier becomes the
  project on convert.
- ADR 0005 recurring billing (line-level): a `billing_interval` flows quote ->
  project -> invoice, and a generator drafts recurring invoices from monthly
  lines.
- The deferred 0133 RPC-grant security hardening from the prior session.

## Deliverables (PRs and migrations)

Eleven PRs. Migrations 0133 to 0138.

| PR | Unit | Migration | Status |
|----|------|-----------|--------|
| #376 | Security: revoke authenticated EXECUTE on duplicate_quote + seed_org_default_job_types | 0133 | merged, prod verified |
| #377 | ADR 0004 tier-grain recompute_quote_totals | 0134 | merged, prod verified |
| #378 | ADR 0004 tier CRUD (quotes-api endpoints + tier_id on line requests) | none | merged |
| #379 | ADR 0004 duplicate_quote clones tiers (+ fixed a latent billing_interval drop) | 0135 | merged, prod verified |
| #380 | ADR 0004 convert accepted-tier + ADR 0005 Phase 1b project billing_interval | 0136 | merged, prod verified |
| #381 | ADR 0005 Phase 1b project -> invoice billing_interval | 0137 | merged, prod verified |
| #382 | ADR 0005 Phase 1a.2 detail-page interval toggle | none | merged |
| #383 | ADR 0004 tier-building SPA (QuoteTiersPanel) | none | merged (autonomous, SPA-only) |
| #384 | ADR 0004 multi-tier quote PDF | none | merged (autonomous, worker + SPA) |
| #385 | ADR 0005 Phase 2 recurring-invoice generator + recurring_schedules | 0138 | OPEN, CI green, awaiting operator merge |

Also merged: the 2026-06-23 handoff doc (#375).

## Risks closed

- ADR 0004 is complete end to end: data-model foundation (0132, prior session),
  tier-grain recompute (0134), tier CRUD edge (#378), duplicate tier-awareness
  (0135), convert accepted-tier (0136), the tier-building SPA (#383), and the
  multi-tier PDF (#384).
- ADR 0005 is complete: Phase 1a (0131, prior session) + Phase 1a.2 detail toggle
  (#382), Phase 1b carry-through quote -> project -> invoice (0136 + 0137), and
  Phase 2 the recurring-invoice generator (0138, #385 pending merge).
- The post-quote-flow security advisor finding (authenticated-executable
  SECURITY DEFINER duplicate_quote / seed_org_default_job_types) is revoked (0133,
  prod verified both functions authenticated_exec = false).
- A latent bug found in passing: duplicate_quote (0129) predated billing_interval
  (0131) and silently reset a monthly line to one_time on every duplicate; 0135
  fixed it.

## Risks carried (follow-ups)

- Schedule-CRUD for recurring_schedules: an edge endpoint + SPA to create / pause
  / list schedules from a project. The 0138 table RLS already gates the finance
  write path; the generator no-ops until a schedule exists, so prod is safe with
  the cron live and no schedules yet. This operationalises Phase 2.
- Per-tier inline line-field editor: in the tier-building SPA, field edits reuse
  the existing EDIT LINE form and tier moves use the panel's per-line select; a
  dedicated per-tier inline editor is a polish follow-up.
- F-Wave9-AUDIT-CREATED-SYMMETRY-01 (pre-existing, app-wide): quotes / tiers /
  the generated invoices write no created-audit row on insert (the state-machine
  triggers audit transitions, not creates). Unchanged by this wave.

## Constitutional invariants verified

- Money: all monetary math stays BIGINT cents with banker's rounding
  (round_half_even). The tier-grain recompute only sums per-line cents; convert
  and the recurring generator reuse the identical invoice-line rounding. The
  tiered-quote header is zeroed (per-tier totals are the source of truth). No
  float, no SPA-side authority.
- Zod canon: every canon touch is byte-identical across `_shared/types/*.ts` and
  the `apps/web` mirrors. `pnpm test:contract` is 47/47 on every PR (tier request
  schemas + tier_id on line requests in sales.ts; billing_interval on
  ProjectLineItem in sales.ts and InvoiceLineItem in finance.ts).
- RLS: quote_tiers is Pattern B (parent-join on quotes.org_id, prior session);
  recurring_schedules is Pattern A (org_id, finance-role write). The cross-quote
  tier guard on line writes returns 404, never a leak.
- Idempotency: every non-GET edge handler keeps its Idempotency-Key. The recurring
  generator is idempotent per period (next_run_on advances in the draft's
  transaction).
- Migrations: 0133 to 0138 are forward-only, idempotent (IF EXISTS / IF NOT
  EXISTS / CREATE OR REPLACE / cron.schedule upsert), each carrying the canonical
  header (the migration-header-format-guard passes). The convert signature change
  (0136) drops the 4-arg form and re-locks the 5-arg form to service_role.
- Grants: every SECURITY DEFINER function added or redefined is service_role only;
  no redefine re-opened the authenticated surface 0111 / 0117 / 0133 closed.
- Validation: every migration was validated on staging
  (`dnkgaufydcnedgkuoyml`) in an aborting transaction with real fixtures, leaving
  zero trace, and verified directly on prod (`zmnvwhqjahwidprnjxrq`) after the
  migrate workflow applied it. Edge units were deno-checked across all 30 bundles
  and exercised through the Supabase mock handler harness.

## Gates

Every PR: typecheck, lint (0 warnings), unit + regression (growing to 995
passing / 2 skipped), contract parity (47), and CI green on the first run
including RLS + e2e against staging, build, and the prod deploy. The SPA / worker
PRs (#378, #382, #383, #384) carry no constitution stop-list item and were merged
on green; the migration PRs (#376, #377, #379, #380, #381) were held for operator
sign-off and merged by the operator; #385 is the one item still open.

## Prod state at closeout

Prod at migration 0137 (0138 lands on #385 merge). Open PRs: #385 only. The
tiered-quoting and recurring-billing features are usable end to end from the UI;
the recurring generator goes live (no-op until a schedule exists) on the #385
merge.
