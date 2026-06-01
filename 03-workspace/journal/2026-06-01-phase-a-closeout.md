# Phase A closeout (full-DoD plan) 2026-06-01

Phase A of the full-DoD-green plan. Scope: broken-wire quick wins, the constitutional and structural gates, the Staging reset, and the stale STATUS.md bucket. Baseline 98d8383 on prod main. Three PRs merged, zero migrations, DoD gate #7 proven.

## Shipped

### PR #188 broken-wire quick wins (WS6)
- search-api emitted dead hrefs for all four global-search entity groups. Corrected to the real SPA routes: customer `/crm/customers/:id`, quote `/3pl-operations/quotes/:id`, invoice `/invoicing/invoices/:id`, project `/3pl-operations/projects/:id`. A new regression test (`apps/web/test/regression/search-api-href-routes.test.ts`) reads both the handler and `routes.ts` as text and pins every href prefix to a declared route, so a future drift back to a dead prefix fails CI.
- MembersPage deactivate (`MembersPage.tsx:279`) was the one call site PR #185 did not migrate off native `window.confirm`. Swapped to the `destructiveConfirm` modal, matching the `MemberDetailPage` consumer pattern. The stale comment was removed.

### PR #189 manufacturing_run FSM into the workflow canon (WS2)
- Added `MANUFACTURING_RUN_FSM` (draft to started to completed; draft or started to cancelled; completed and cancelled terminal) to both byte-mirrored copies of `workflow.ts` and registered it in `FSMS`. The transitions match migration 0052 and the handler exactly.
- Refactored `assertManufacturingTransition` in manufacturing-api to delegate to `canTransition(MANUFACTURING_RUN_FSM, ...)`, removing the duplicated local allowed-map so the canon is the single source of truth. Behavior preserved: same STATE_CONFLICT 409 envelope and message.
- Added an FSM unit test (exhaustive legal and illegal transition assertions) and `copack-api-basic.test.ts` mirroring the manufacturing exemplar (cross-tenant list 200 plus empty, gate-off 404, illegal transition 409, create no 4xx, numbering chassis call).
- Byte parity held (`pnpm test:contract` green).

### PR #190 crm-api and sales-config-api bundle gate (WS2)
- Closed the deferred F-Wave9-SALES-CONFIG-3PL-GATE-01 (Cowork SMOKE-06 class): both bundles were ungated and reachable regardless of pillar plugins.
- Extended `bundleGate.ts` with an `flagKeys` OR predicate: the gate passes when any listed flag is enabled and returns 404 only when all are off. Single-flag callers unchanged (back-compat). Misconfiguration (both, neither, or empty array) fails closed to 404 so a mistake never exposes a bundle. OPTIONS bypass and org-less fall-through preserved.
- Gated crm-api and sales-config-api on `three_pl OR manufacturing OR copack_ecom`, the three commerce pillars that consume these surfaces (evidence: a consumption grep of the SPA showed CRM and sales-config reached via CustomerPicker and ItemPicker from 3PL, Manufacturing, and Co-Pack; kitforce and kitcost do not consume them). The operator confirmed this predicate. The plan named "invoicing" but there is no `plugins.invoicing` flag, so that intent maps to copack_ecom plus the three_pl-owned finance routes.
- SPA-side OR guard for the crm and sales-config routes is deferred as F-Wave10-CRM-SALESCONFIG-SPA-GATE-01 (RequirePlugin takes a single flag today; server remains authority).

## DoD gate #7 proven

The operator approved resetting the non-default Staging preview-branch to replay 0001 through 0084 and prove forward-only application on a fresh DB. `reset_branch` returned success but was a no-op: the Staging branch has no git tie, so it only re-applies its own recorded ledger (0001 to 0070, including the phantom 0069 and 0070), not the repo migrations. Confirmed by the branch record `updated_at` never moving and a post-reset ledger probe still showing max 0070.

Gate #7 was instead proven locally (operator-chosen path): a postgres-only `supabase start` on a remapped db port (54522, to avoid colliding with the operator's two other running local stacks) followed by `supabase db reset`. All 82 migration files (0001 through 0084, with numbering gaps at 0005 and 0006) replayed forward-only on a fresh database, exit 0, ledger at 0084, every pillar table present (manufacturing_runs, sales_orders, kitting_jobs, fulfillments, shifts), and every idempotent drop-if-exists guard firing as a NOTICE rather than an error. The temporary config port edit was reverted and the local stack stopped after.

Remaining: the live Staging branch is still frozen at 0070. Reconciling it (rebase_branch on prod after cleaning the phantom 0069 and 0070 rows, or establishing a git tie) is a dedicated infra task. Recorded in memory `staging_audit_log_drift_2026_05_31.md`.

## Follow-ups filed
- F-Wave10-CRM-SALESCONFIG-SPA-GATE-01: SPA-side OR RequirePlugin mirror for crm and sales-config routes.
- Live Staging branch reconciliation (dedicated infra slice).

## Constitutional invariants verified
- Bundle gates return 404 NOT_FOUND, never 403; the OR gate fails closed on misconfiguration.
- Money rules, RLS policies, idempotency, and audit_log untouched by all three PRs.
- Byte-mirror parity green (`pnpm test:contract`, 22) including the workflow canon pair after the FSM addition.
- Migrations untouched; forward-only proven on a fresh DB.
- Brand voice held on disk across all files, commits, and PRs.

## Process notes
- Three workstreams ran as parallel worktree agents (one sonnet for the trivial quick wins, two opus for the constitution-sensitive gates), each opening its own PR off main. File sets were disjoint, so no merge conflicts.
- The bundle-gate PR was held until the operator confirmed the flag predicate, then merged after a diff review.
- Each merge produced the known cosmetic `gh pr merge --delete-branch` failure because the branch was checked out in an agent worktree; the server-side merges succeeded (verified via PR state).
