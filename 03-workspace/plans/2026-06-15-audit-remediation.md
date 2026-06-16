# Wave 13: Audit Remediation Plan

**Status:** Draft for operator approval. Created 2026-06-15.
**Source of work:** `03-workspace/audits/KitStak-Master-Summary-2026-06-15.md` plus the two full reports.
**Guardrail:** `CLAUDE.md` (constitution) and `DEFINITION-OF-DONE.md`. Nothing in this plan overrides them; where a fix appears to require breaking an invariant, stop and ask the operator.

## How this plan is executed

1. **Re-verify before implementing.** The audit is a snapshot from 2026-06-15. For every work unit, first confirm the finding still holds against current code and update the cited file paths if they moved. If a unit is already fixed, mark it Closed-NoOp with a one-line note and move on. Do not re-fix.
2. **Waves and phases.** Work is grouped into Wave 13 with three phases: A (P0, gates go-live), B (P1, high impact), C (P2, correctness and polish). Do not start phase B until phase A is merged and the full Definition of Done is green. Same for B to C.
3. **One agent per work unit, isolated branch.** Branch pattern `claude/<slug>`, or a git worktree per unit. Never let two agents edit the same files concurrently. Independent units in a phase run in parallel.
4. **The loop per unit:** re-verify, implement with tests, self-review, then Review + Security agent sweeps plus the `scripts/` canon-steward and trigger-audit checks, fix everything raised, re-run gates, repeat until clean, then integrate.
5. **The gate:** the full DoD smoke matrix plus structural and smell gates (see end). A skipped or flaky gate counts as red.

## Conventions

- **Risk IDs:** `R-W13-<DOMAIN>-<seq>`. **Follow-ups** spawned during the wave: `F-Wave13-<seq>`.
- **Every PR cites:** risk closed, follow-up spawned, constitutional invariants verified.
- **Migrations:** forward-only, `NNNN_snake_case.sql` continuing after 0111, idempotent DDL, multi-stage drops, full header (Wave, Phase, Closes, DOWN MIGRATION, date, constitutional alignment).
- **Wave close:** closeout journal at `03-workspace/journal/wave-13-audit-remediation.md`, all risks closed or carried with a follow-up ID, README per-wave table and `CHANGELOG.md` updated, cross-tenant probe and bundle budget green.

---

## Phase 13.A: P0 (must merge and pass before go-live)

### R-W13-SEC-01: Verify JWT signature on authenticated routes (tenants-api, admin-console-api)
- **Severity:** P0. Critical (cross-tenant data leak live; latent admin takeover).
- **Invariants touched:** RLS / tenant isolation, capabilities. STOP-AND-ASK surface (auth). Confirm with operator before merge.
- **Cited files (re-verify):** `supabase/functions/tenants-api/index.ts` (public `GET /tenants/resolve-host`; authenticated `GET /branding`, `GET /tenants/me`), `supabase/functions/admin-console-api/index.ts`, `supabase/functions/_shared/tenant.ts` (`readCallerContext`/`requireCaller`, decode-only), `supabase/functions/_shared/mfa.ts` (validates claimed user, not caller), `supabase/config.toml` (verify_jwt:false entries).
- **Implement:** keep the genuinely public route on a `verify_jwt:false` function, but for every authenticated route either move it under a `verify_jwt:true` function or verify the JWT signature in-handler (validate against the Supabase JWT secret) before trusting `kitstak_org_id`/`sub`. Make the MFA gate validate that the caller possesses the factor, not that the claimed user has one.
- **Acceptance / tests:** add `pnpm test:rls` cases asserting a forged or unsigned token is rejected (not 200) on `/branding`, `/tenants/me`, and any admin route; existing public host-resolve still works pre-auth. Cross-tenant probe stays green.
- **Dependencies:** none. Do first.

### R-W13-WMS-01: Putaway completion must move stock (no null-destination no-op)
- **Severity:** P0. The directed putaway completes to Done while posting no movement (DB-verified).
- **Invariants touched:** append-only stock ledger, FSM via RPC, audit trigger. STOP-AND-ASK if the fix touches RLS or the ledger trigger.
- **Cited files (re-verify):** `supabase/functions/wms-api/index.ts` (putaway start/complete handlers and stock RPCs), the putaway-complete RPC and bin-recompute trigger (migrations ~0105 to 0111, B3 directed putaway, 0107 bin recompute), SPA putaway detail page under `apps/web/src/pages/wms/`.
- **Implement:** make destination bin required to complete; expose a destination-bin selector on the in-progress task (it is only on create today). On complete, post the transfer pair (transfer_out at the dock, transfer_in at the destination bin, existing 0030 types, unit_cost_cents 0) inside the atomic RPC so the warehouse total stays flat and the bin recompute shifts stock. Reject completion when destination is null with a STATE error.
- **Acceptance / tests:** test that completing posts two movements and `bin_stock_levels` decrements the dock and increments the destination, reconciling to the warehouse total; test that completion with null destination returns an error and changes nothing. e2e: receive to dock, putaway to bin, assert bin stock.
- **Dependencies:** none.

### R-W13-BILL-01: Gate paid-plugin enablement behind billing entitlement
- **Severity:** P0. Revenue leak: paid add-ons (for example `plugins.wms`) are self-enablable from Admin > Feature Flags.
- **Invariants touched:** capabilities, feature-flag gating. STOP-AND-ASK if it changes flag-miss response codes (must stay 404 for bundle gates).
- **Cited files (re-verify):** SPA admin flags page under `apps/web/src/pages/admin/`, the flag-write handler (likely `settings-api` or `admin`/`tenants-api`), `org_feature_flags` table, billing state on `organizations` and `billing-api`/`stripe-webhook`.
- **Implement:** when enabling a flag that maps to a paid plugin, require an active billing entitlement; deny with a clear error otherwise. Keep operator/owner override only if intended, and audit it.
- **Acceptance / tests:** test that enabling a paid plugin without entitlement is denied and with entitlement succeeds; bundle-gate-miss still returns 404.
- **Dependencies:** none.

### R-W13-PERF-01: Index the unindexed foreign keys
- **Severity:** P0 for go-live. 101 unindexed FKs flagged by the performance advisor.
- **Invariants touched:** migrations (forward-only, idempotent, header).
- **Cited files (re-verify):** run the Supabase performance advisor to get the current list; add one forward migration after 0111.
- **Implement:** `CREATE INDEX IF NOT EXISTS` covering each flagged FK, prioritizing line-item-to-parent and org_id-denormalized children. Full migration header.
- **Acceptance / tests:** `supabase db reset` applies forward-only; re-run the advisor and confirm the unindexed-FK count drops to near zero; no bundle or RLS regressions.
- **Dependencies:** none. Can run in parallel with the others.

### R-W13-SEC-02: Security hardening sweep (search_path, anon execute, leaked password)
- **Severity:** P1 by impact but cohesive with the P0 security work; do it in phase A.
- **Invariants touched:** RPC rules (SECURITY DEFINER, SET search_path = public, explicit grants). STOP-AND-ASK (touches function grants).
- **Cited files (re-verify):** run the Supabase security advisor; the 37 "Function Search Path Mutable" functions, the 11 "Public Can Execute SECURITY DEFINER", the leaked-password setting in Supabase Auth.
- **Implement:** forward migration setting `search_path = public` on the flagged functions and revoking `EXECUTE` from `anon`/`public` where not intended (mirror the 0111 pattern that revoked authenticated EXECUTE on FSM RPCs). Enable leaked-password protection in Auth config.
- **Acceptance / tests:** re-run the security advisor and confirm the three counts drop; `test:rls` green; no function that should be callable becomes uncallable.
- **Dependencies:** coordinate ordering with R-W13-PERF-01 if both touch migrations (sequential migration numbers).

---

## Phase 13.B: P1 (high impact)

### R-W13-UX-01: Invalidate queries after state transitions (fix stale UI)
- **Invariants touched:** none structural (SPA only).
- **Cited files (re-verify):** the mutation hooks for quotes, invoices, receiving, putaway under `apps/web/src/pages/` and the TanStack Query setup; `apps/web/src/lib/apiClient.ts`.
- **Implement:** on every state-transition mutation success, invalidate the entity query so the stepper, action buttons, and totals update without a reload.
- **Acceptance / tests:** e2e asserts that after a transition the stepper and primary action update without navigation. Add to the quote-to-cash Playwright flow.
- **Dependencies:** pairs well with the combobox/e2e work; can run alone.

### R-W13-3PL-01: Verify and instrument the 3PL execution chain
- **Invariants touched:** stock ledger, auto-JE guard, audit triggers. STOP-AND-ASK if ledger or JE triggers change.
- **Cited files (re-verify):** `supabase/functions/three-pl-api/index.ts` (job-run, daily-log, billing-review handlers), the daily-log emit and billing-review-to-invoice migrations (~0099 to 0104).
- **Implement:** run the chain in staging with seeded data (Supply Plan to Job Run to a posted daily log to Billing Review to draft invoice). Confirm the daily-log post emits consumed/produced movements and the billing-review approve drafts a spine invoice. Fix any gap found. Add product analytics events for these transitions.
- **Acceptance / tests:** tests asserting a posted daily log emits movements and a billing-review approve creates a draft invoice with one line per active account rate; cross-tenant probe green.
- **Dependencies:** none, but high effort; size it generously.

### R-W13-AUTH-01: MFA and SSO UI plus leaked-password (if not closed in A)
- **Invariants touched:** auth. STOP-AND-ASK.
- **Cited files (re-verify):** `apps/web/src/pages/auth/`, `auth-api`, `_shared/mfa.ts`, `sso_connections`/`saml_configs` tables.
- **Implement:** surface TOTP enrollment/verification and the SSO/SAML path that the capabilities and tables already imply.
- **Acceptance / tests:** e2e enroll-and-verify TOTP; SSO connection round-trip if in scope.
- **Dependencies:** after R-W13-SEC-01 (shared MFA logic).

### R-W13-SRCH-01: Global command-bar search
- **Cited files (re-verify):** `supabase/functions/search-api/index.ts`, the app shell `apps/web/src/components/shell/AppShell.tsx`.
- **Implement:** a persistent Cmd/Ctrl-K command bar over the existing search-api spanning customers, quotes, projects, invoices, items, and job numbers. Hand-rolled per the constitution (no new combobox dep).
- **Acceptance / tests:** e2e opens the bar, searches, and navigates to a record; a11y keyboard nav.
- **Dependencies:** shares the combobox primitive with R-W13-CAT-01 and the picker refactor; build the primitive once.

### R-W13-3PL-02: Auto-create draft Supply Plan on project conversion
- **Cited files (re-verify):** `projects-api` conversion handler, `three-pl-api` supply-plan create, `supply_plans` table.
- **Implement:** on conversion, create a draft Supply Plan (or prompt) using the project materials and the org default warehouse.
- **Acceptance / tests:** test that converting a quote yields a draft supply plan linked to the project.
- **Dependencies:** none.

### R-W13-CAT-01: Extend the item master
- **Cited files (re-verify):** `items` table, the catalog item create/edit form `apps/web/src/pages/3pl-operations/items/`.
- **Implement:** add unit of measure, cost (distinct from price), reorder point, and barcode/UPC to the model (forward migration) and the form. Reorder point unblocks later low-stock automation.
- **Acceptance / tests:** create/edit round-trip test for the new fields; migration forward-only.
- **Dependencies:** none.

### R-W13-OBS-01: Instrument the newer pillars in analytics
- **Cited files (re-verify):** `apps/web/src/lib/analytics.ts`.
- **Implement:** emit product events for 3PL job runs, WMS receiving/putaway, manufacturing runs, and KitForce labor, matching the spine funnel style.
- **Acceptance / tests:** unit test that the events fire with the expected properties; no PII in payloads.
- **Dependencies:** light; do alongside R-W13-3PL-01.

### R-W13-IA-01: Fix breadcrumb taxonomy and stale design doc
- **Cited files (re-verify):** the breadcrumb component, `docs/design/ui-wireframes.md`.
- **Implement:** align breadcrumbs to the pillar IA (CRM, QUOTES, FINANCE) instead of SELL/MAKE/LIBRARY/GET PAID; update the design doc.
- **Acceptance / tests:** snapshot or e2e check that breadcrumbs match the sidebar group on representative pages.
- **Dependencies:** none.

---

## Phase 13.C: P2 (correctness and polish)

### R-W13-FIN-01: Add status-equals-from guard to SELECT-then-UPDATE transitions
- **Cited files (re-verify):** `supabase/functions/invoicing-api/handlers/invoices.ts` (~307 to 327), plus the ops-api and manufacturing-api in-handler transitions.
- **Implement:** add `.eq('status', from)` to the transition UPDATE and treat a 0-row result as `STATE_CONFLICT`, matching the atomic-RPC pattern used by three-pl/wms/finance.
- **Acceptance / tests:** concurrency test that two transitions from the same state yield one success and one STATE_CONFLICT.

### R-W13-DB-01: Drop the JSON line mirrors (multi-stage)
- **Cited files (re-verify):** migration 0050 and the receiving/shipment handlers dual-writing `payload.lines`; production_runs JSON storage.
- **Implement:** follow the multi-stage drop rule (stop writing the JSON mirror, redeploy, drop the column a release later). One source of truth for lines.
- **Acceptance / tests:** reads still return lines from the normalized tables; `supabase db reset` forward-only.

### R-W13-PERF-02: Collapse multiple-permissive RLS policies and wrap init-plan auth calls
- **Cited files (re-verify):** run the performance advisor for the 88 multiple-permissive-policy tables and the 7 init-plan policies.
- **Implement:** consolidate same-role/action policies into single policies with OR; wrap `current_org_id()`/`auth.*()` as `(select ...)` so they evaluate once per query. STOP-AND-ASK (RLS).
- **Acceptance / tests:** advisor counts drop; `test:rls` matrix unchanged (still 200+[], 404, 403).

### R-W13-UX-02: Single-screen create-with-lines
- **Cited files (re-verify):** quote/invoice/receiving/BOM create pages.
- **Implement:** allow adding lines on the create screen rather than header-first then a second screen. Optional but high daily value.
- **Acceptance / tests:** e2e creates an entity with lines in one screen.

### R-W13-UX-03: Transient-fetch retry and field-level form errors
- **Cited files (re-verify):** `apps/web/src/lib/apiClient.ts` (retry), form components mapping Zod issues.
- **Implement:** idempotent auto-retry on transient fetch failures reusing the same Idempotency-Key; map Zod issues to the per-field `error` prop instead of one banner string.
- **Acceptance / tests:** unit test that a transient failure retries once and does not duplicate; form test that a field error renders on the field.

### R-W13-DX-01: CI and observability hygiene
- **Cited files (re-verify):** `.github/workflows/lighthouse.yml` (LIGHTHOUSE_ENABLED), `apps/web/.size-limit.cjs`, `_shared/sentry`, `three-pl-api/index.ts` (1,935 lines).
- **Implement:** configure the Vercel Protection Bypass secret and re-enable the Lighthouse gate; add size-limit budgets to the sentry/posthog/supabase lazy chunks; land edge-function Sentry capture (`F-Wave5-CO-01-EDGE-01`); split `three-pl-api` into a `handlers/` layout like crm/finance.
- **Acceptance / tests:** Lighthouse gate runs and passes on the dashboard; lazy-chunk budgets enforced; no behavior change from the split (tests green).

### R-W13-COPACK-01: Co-Pack channels and CSV import
- **Cited files (re-verify):** copack-api channel registry; imports-api CSV mapping (CHANGELOG flags it broken for most entities).
- **Implement:** fix CSV import column mapping for the broken entities (needed to onboard a real operator); decide whether to build one real channel connector or relabel channels as manual-only until then.
- **Acceptance / tests:** import round-trip test for each fixed entity.

---

## Sequencing and dependencies

- **Phase A first, fully merged and green, before B.** Within A, all five units are independent except migration ordering between R-W13-PERF-01 and R-W13-SEC-02 (assign sequential migration numbers). Run them in parallel on worktrees.
- **Build shared primitives once.** The searchable combobox/command-bar primitive is shared by R-W13-SRCH-01, the picker refactor, and R-W13-CAT-01. Build it as the first task in phase B and have the others depend on it.
- **R-W13-AUTH-01 depends on R-W13-SEC-01** (shared MFA logic).
- **R-W13-OBS-01 rides with R-W13-3PL-01.**

## Definition of Done gate (reference, must all be green per phase)
`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:contract`, `pnpm test:rls`, `pnpm build` (index under 40 kB gzip), `supabase db reset`, `pnpm test:e2e`, Lighthouse (if dashboard touched), deploy-gate. Plus structural gates (migration headers, respondWithIdempotency, requireCap, RLS on new tables, FSM in both workflow files plus parity plus audit trigger, auto-JE idempotency guard, RPC SECURITY DEFINER + search_path + grants) and the human smell-test gates.

## Wave close checklist
Closeout journal at `03-workspace/journal/wave-13-audit-remediation.md`; every `R-W13-*` closed or carried with an `F-Wave13-*`; README per-wave table and `CHANGELOG.md` updated; cross-tenant probe and bundle budget green; operator sign-off before declaring the wave done.
