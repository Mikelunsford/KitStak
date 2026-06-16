# KitStak Audit Remediation: Orchestration Kickoff

How to use: paste the block under "PROMPT" into your orchestrating coding agent at the repo root. It is written to the agent. The notes after it are for you (the human driver).

---

## PROMPT (paste this to the orchestrator)

You are the orchestrator for a multi-agent remediation of KitStak. Your job is to turn the findings in `03-workspace/audits/` into merged, CI-green, constitution-compliant changes through repeated implement, review, and verify loops. You do not finish until the full Definition of Done passes and the work is coherent with the existing codebase and its constitution. Asking the operator to confirm a risky change is not failure.

### Phase 0: Orient before doing anything
Read, in this order, and hold them as your source of truth:
1. `CLAUDE.md` (the constitution, non-negotiable).
2. `DEFINITION-OF-DONE.md` (the gate you must pass).
3. `STATUS.md`, `PROJECT.md`, `00-canon/01-architecture.md`.
4. `03-workspace/audits/KitStak-Master-Summary-2026-06-15.md` (the consolidated backlog), then the two full reports (`...Product-Audit...` and `...Operator-Simulation...`) for detail and file citations.
5. Orient using your available implementer, code-review, and security-review agents for the implement, review, and verify loops. Do not spin up a parallel agent system.
6. `docs/api/*`, relevant `docs/adr/*`, and `supabase/functions/_shared/*` for the kernel patterns you must follow.

Produce a written remediation plan at `03-workspace/plans/2026-06-15-audit-remediation.md` before writing code, and have the operator approve it.

### Non-negotiables you must hold on every change (from CLAUDE.md)
- Money is BIGINT cents with the `_cents` suffix and roundHalfEven; `_shared/money.ts` stays byte-identical to `apps/web/src/lib/money.ts` (parity test).
- RLS on every tenant-scoped table from its creating migration; filters never throw; cross-tenant reads return 200 plus empty, cross-tenant workflow POSTs return 404, bundle-gate misses return 404, per-route flag misses return 403 FEATURE_DISABLED. A 403 where 404 is expected is a release blocker.
- Migrations are forward-only, `NNNN_snake_case.sql`, never edited after apply, idempotent DDL, multi-stage drops, and every header declares Wave, Phase, Closes, DOWN MIGRATION, date, and constitutional alignment.
- Zod canon: `_shared/types.ts` byte-identical to `apps/web/src/lib/types.ts`; `_shared/workflow.ts` mirrored in the SPA; capability policy mirrored. Drift is a release blocker.
- Every non-GET handler enforces an Idempotency-Key and uses `respondWithIdempotency`. Every state-changing handler calls `requireCap`. State machines transition via the canon plus an auto-state-transition audit trigger; handlers never write `audit_log`. Auto-JE triggers carry the EXISTS source_type+source_id+status='posted' guard. New RPCs are SECURITY DEFINER, SET search_path = public, with explicit grants.
- Banned dependencies stay banned (no antd, radix/shadcn, redux/zustand, react-hook-form/formik, dayjs/date-fns/moment, lodash, axios, uuid pkg, next/remix). New top-level deps require the constitution-review checklist plus an ADR.
- User-facing copy: no em dashes, no double hyphens, no emojis, no stock photography, no generic gradients. Index bundle stays under 40 kB gzip.

Stop and ask the operator before: any change to RLS, money helpers, idempotency, or audit_log; any new top-level dependency; anything that would write a 403 where 404 is constitutional; anything that breaks forward-only migrations; closing a wave without a journal entry.

### Source of work and how to scope it
The backlog is the prioritized P0/P1/P2 list in the Master Summary. Convert each finding into a work unit with: a risk ID (`R-W<wave>-<DOMAIN>-<seq>`), the exact files/functions cited in the reports, the constitutional invariants it touches, the DoD gates it must pass, and explicit acceptance criteria including a regression test. Group work units into waves. Sequence P0 first (do not start P1 until P0 is merged and green), then P1, then P2, respecting dependencies.

Mandatory P0 acceptance criteria to encode (from the reports):
- `tenants-api` and `admin-console-api`: authenticated routes must verify the JWT signature, not just decode it. Add a cross-tenant RLS-probe case that a forged/unsigned token is rejected.
- WMS putaway: completion must require a destination bin and post the transfer pair (transfer_out at dock, transfer_in at bin); a null-destination completion must be impossible. Add a test asserting the movement posts and `bin_stock_levels` reconciles.
- Feature flags: enabling a paid plugin must check billing entitlement. Add a test.
- Index the 101 unindexed foreign keys via a forward migration; confirm the performance advisor count drops.

### Orchestration model (the loop)
For each wave:
1. Decompose into work units. Run independent units in parallel on isolated branches or git worktrees (branch pattern `claude/<slug>`). Never let two agents edit the same files concurrently.
2. For each work unit, dispatch an implementer agent. It writes the migration/handler/SPA change plus tests, following the kernel patterns in `_shared/`.
3. After implementation, run review sweeps on that unit before integration:
   - the Review agent (correctness, N+1, edge cases, envelope, FSM),
   - the Security agent (RLS, capabilities, verify_jwt, search_path, anon execute, secret handling),
   - the canon-steward and trigger-audit scripts under `scripts/` (parity, migration headers, audit-trigger allowlist).
4. The implementer fixes every issue the reviewers raise, then re-runs the gates. Loop implement to review to fix until the unit is clean.
5. Integrate the unit, then run the full Definition of Done gate (below) on the integrated branch. If anything is red, route the failure back to the owning agent and loop. Do not advance with any red gate.
6. Repeat until every unit in the wave is merged and the full gate is green.

### The Definition of Done gate (must all be green before merge)
Run and require green: `pnpm lint` (zero warnings, banned imports caught), `pnpm typecheck` (strict), `pnpm test`, `pnpm test:contract` (types/workflow/money/capabilities parity), `pnpm test:rls` (cross-tenant probe matrix: reads 200+[], workflow POSTs 404, bundle misses 404, flag misses 403), `pnpm build` (index under 40 kB gzip), `supabase db reset` (all migrations forward-only on a fresh DB), `pnpm test:e2e` (Playwright smoke). Re-enable and pass the Lighthouse gate if you touch the dashboard. Plus the structural gates (migration headers, respondWithIdempotency, requireCap, RLS on new tables, FSM in both workflow files plus parity plus audit trigger, auto-JE idempotency guard, RPC SECURITY DEFINER + search_path + grants) and the human smell-test gates. Treat a skipped or flaky gate as red.

### Wave close and reporting
A wave closes only when: all its PRs are merged; a closeout journal exists at `03-workspace/journal/wave-<N>-<slug>.md`; every `R-W<wave>-<seq>` is closed or carried with a follow-up `F-Wave<N>-<seq>`; the README per-wave table and `CHANGELOG.md` are updated; the cross-tenant probe and bundle budget are green. Every PR description cites: risk closed, follow-up spawned, constitutional invariants verified. After each wave, post a short status to the operator (what merged, gates state, risks carried, next wave) and wait for go before the next wave.

### Output discipline
Prefer atomic RPCs over SELECT-then-UPDATE for state changes (add a `status = from` guard where you keep the UPDATE pattern). Add a regression test for every fix. Keep changes minimal and within the constitution; if a finding seems to require breaking an invariant, stop and ask rather than working around it.

---

## How to drive it (notes for you, the human)

- **Run it in waves, not one shot.** Approve the plan first, then let it execute P0 as wave 1, review at the wave boundary, then release P1, etc. The wave-close-and-wait step gives you natural checkpoints.
- **Use worktrees for parallelism.** Independent P0 items (the two auth fixes, the FK-index migration, the putaway fix, the flag-billing gate) can run as separate agents on separate branches at once; the orchestrator should fan them out and you review the PRs.
- **Let the gates be the loop's exit, not your judgment.** The DoD matrix is the stop condition. If the agent claims done with a skipped or flaky gate, send it back.
- **Protect the risky surfaces.** The stop-and-ask list (RLS, money, idempotency, audit_log, new deps, 403-vs-404) is where you want to be in the loop personally. Everything else can run more autonomously.
- **Keep the audit docs as the spec.** Point the agent back to `03-workspace/audits/` for the exact file citations and acceptance criteria rather than re-describing findings.
- **First wave to ask for:** the four P0s plus FK indexes. Smallest, highest severity, and they gate go-live. Then the data-grid/combobox/global-search workstream, then query invalidation, then verifying the 3PL execution chain.
