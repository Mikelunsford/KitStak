# E2E Smoke Test (2026-05-21) — 11-Bug Investigation

**Date:** 2026-05-21
**Driven by:** Operator's autonomous E2E smoke walk against `https://www.kitstak.com`. Findings filed at `C:\Users\Mike Lunsford\Desktop\KitStak v.02\Kitstak_E2E_Smoke_2026-05-21.md`.
**Status:** Investigation complete. Three operator decisions pending before any PR work begins. Next session must surface those three questions first.

## Context

Operator ran a full quote-to-cash chain on prod (Smoke Co. customer · SRM-001 + SKA-001 inventory · quote SMOKE-001 · project PRJ-20260521-EA8FA139 · manufacturing run MFG-2026-00002 · receiving SMOKE-RO-002 · shipment SMOKE-SHIP-001 · invoice INV-20260521-AD35B5D1 · payment SMOKE-PAY-001). Net stock matched spec (SRM-001 400 on hand, SKA-001 0 on hand) and trigger-driven movements all posted. 11 bugs surfaced, four high or high-UX, the rest low or cosmetic.

The operator asked for a full investigation across all 11 bugs and a PR-bundle plan before any code changes.

## Bug-by-bug root causes (with file:line)

### B1 (HIGH) — KitCost dashboard YTD revenue stuck at $0

`supabase/functions/dashboard-api/index.ts` lines 200, 219, 226 all filter `.eq('status', 'paid')`. The dashboard query is correct; the upstream invoice never reaches the `paid` state. **Strictly a consequence of B2** — no separate fix needed.

### B2 (HIGH) — Invoice status never transitions to `paid` after full payment

`supabase/migrations/0019_invoicing_payments.sql` lines 125–144. `recompute_invoice_paid(p_invoice_id)` writes `paid_cents` and `updated_at` only. The function never compares `paid_cents + credit_allocated_cents` against `total_cents` to flip `status` to `paid` / `partially_paid`, and never stamps `paid_at`. Trigger `trg_payment_allocations_recompute` (same file, lines 181-204) correctly fires the recompute on every allocation insert/update/delete but the recompute itself is incomplete. Audit trigger `audit_invoices_status` (from 0037) would automatically log the transition once `status` actually changes.

The invoice status enum (declared `supabase/migrations/0018_invoicing_invoices.sql:38-42`) includes `paid` and `partially_paid` as valid values, and `paid_at` is an existing nullable timestamptz column (`0018:58`).

### B3 (HIGH UX) — Receiving / Shipment NEW form requires raw JSON for line items

`apps/web/src/pages/3pl-operations/receiving/ReceivingOrderCreatePage.tsx` lines 162-170: `<textarea>` taking JSON array. File header comment (lines 14-16) already concedes this is a Phase 7 follow-up filed as `G-RECV-LINES-01`. Same pattern in `ShipmentCreatePage.tsx`. The working clean line editor sits at `ReceivingOrderDetailPage.tsx:46-67` (item picker · qty · unit cost · UOM · reference). Fix: lift that editor into a reusable component and use on both create pages.

### B4 (MEDIUM) — Project Budget shows $0.00 after quote→project convert

`supabase/migrations/0044_project_line_items.sql` lines 354-363. The `convert_quote_to_project` RPC INSERT into `projects` carries `org_id, number, name, customer_id, source_quote_id, state, currency_code, created_by, updated_by` and **never sets `budget_cents`**. The column defaults to 0 (declared `0016_sales_projects.sql:53`). Line items are correctly copied to `project_line_items` (lines 370-394) but never summed into the projects-table budget column. Fix: add a `recompute_project_totals(project_id)` helper (mirror `recompute_quote_totals` from `0017_sales_audit_recompute_triggers.sql:306-341`), call it at the end of `convert_quote_to_project`, and add a trigger on `project_line_items` insert/update/delete to keep it fresh.

### B5 (MEDIUM) — Activity NEW form does not honor `entity_id` URL param

`apps/web/src/pages/crm/activities/ActivityCreatePage.tsx` lines 1-22. The component never imports `useSearchParams`. It defaults `entityType` to `'customer'` and `entityId` to `''`. The smoke test's observation that `entity_type` "honored" the URL was a coincidence — the default is just `customer`, which happened to match the URL value. Neither field is actually read from the URL today. Fix: add `useSearchParams` and seed both `useState` initializers from it.

### B6 (LOW UX) — Contact create redirects away from customer page

`apps/web/src/pages/crm/contacts/ContactCreatePage.tsx` line 42: `navigate(\`/crm/contacts/${created.id}\`)` is unconditional. Fix shape: read a `?return_to=` (or `?customer_id=`) query param and redirect there if present; fall back to current behaviour when absent. Lower cost than restructuring to inline-on-customer-page optimistic update.

### B7 (LOW) — Quote workflow vocabulary: "Submit" vs "Sent"

DB enum `quotes.state` (declared `supabase/migrations/0014_sales_quotes.sql:36`) carries the literal value `'submitted'`. UI button at `apps/web/src/pages/3pl-operations/quotes/QuoteDetailPage.tsx:174` reads `Submit`. A separate `Send` button at line 186 (post-approval, `useSendQuote`) does something different — it likely emails the PDF or stamps `sent_at`. Constitution's migration rules forbid renaming an enum column except via multi-stage drop, so the cheapest correct fix is **UI labels only**: rename the pre-approval action to "Send for approval" and keep "Send to customer" post-approval. Update spec doc to match. Decision still pending — see "Pending operator decisions" below.

### B8 (LOW) — Auto-numbering: only manufacturing_run is wired

DB infrastructure is complete. `supabase/migrations/0038_collab_numbering_seed.sql` seeds `numbering_sequences` rows for `quote`, `invoice`, `receiving_order`, `shipment`, `manufacturing_run`, and more. `_shared/numbering.ts` exposes `nextDocNumber`. But grep across `supabase/functions/**` finds the function called from only one place: `manufacturing-api/index.ts`. The other create handlers (`quotes-api`, `ops-api` receiving + shipment, `invoicing-api`, and the `convert_project_to_invoice` RPC at `0045_convert_project_to_invoice.sql:95` which uses its own ad-hoc `PRJ-YYYYMMDD-<8hex>` format) rely on operator-typed numbers.

The "numbering admin only shows manufacturing_run" UI observation is **separately** suspect — the DB rows exist for all doc types; the admin-page query is likely filtered. Worth a separate read of `apps/web/src/pages/admin/**` before declaring the SPA portion fixed by this PR.

### B9 (LOW) — Receiving order `received_date` not stamped on transition to received

`supabase/functions/ops-api/index.ts` two endpoints:
- `/receiving-orders/:id/transition` (lines 268-284): generic handler. Updates only `status`, `updated_by`, `updated_at`.
- `/receiving-orders/:id/receive` (lines 286-305): dedicated handler that DOES stamp `received_date: body.received_date ?? new Date().toISOString().slice(0, 10)` at line 300.

The SPA detail page calls `useTransitionReceivingOrder` (`apps/web/src/lib/services/receivingOrdersService.ts:46-52`), which hits the generic `/transition` endpoint. The dedicated `/receive` endpoint is not wired to the detail-page state-machine button. Result: `received_date` stays null and the detail page renders the empty fallback `d.received_date ?? ''` (`ReceivingOrderDetailPage.tsx:93`).

Cheapest fix: extend the `/transition` handler to stamp `received_date` when `body.to === 'received'`. Server-authoritative, matches the constitutional pattern.

### B10 (LOW) — Manufacturing run in DRAFT shows "No history yet"

`supabase/migrations/0052_manufacturing_runs_schema.sql:441-444`: `audit_manufacturing_runs_status` fires `AFTER UPDATE OF status` only. Draft-only runs have no audit row because no transition has occurred. The receiving order and shipment audit triggers (referenced in `0037_audit_state_triggers_all_14.sql:108-110`) are the same shape. The smoke test's observation that receiving and shipment "log creation" is the receiving + shipment chain advancing through `created → in_progress / picking` quickly, which produces a row that's visually indistinguishable from "creation logged".

Fix: add INSERT firing to `audit_manufacturing_runs_status` (or for symmetry, to all 15 audit triggers) so the entity's birth state is logged as `from_state=null, to_state=<initial>, action='created'`. Lowest priority — audit coverage is complete for transitions; this is consistency polish.

### B11 (COSMETIC) — Source quote link rendered red

`apps/web/src/pages/3pl-operations/projects/ProjectDetailPage.tsx:201-210`. className is `text-ink hover:text-accent` — identical to the customer link two lines above. Most likely the operator captured the hover state, or the linked quote number didn't load and an ancestor styled the UUID fallback. Worth a DevTools sanity check before touching. Lowest priority.

## Proposed PR bundles

Six PRs, sequenced by dependency and blast radius. Constitutionally bundled: migrations stay in their own PR, one invariant per PR, SPA-only changes share where the surface area is narrow.

| # | Bundle | Bugs | Touches | Notes |
|---|---|---|---|---|
| PR-1 | Invoice `paid` transition + `paid_at` stamp | B2 → fixes B1 | New migration extending `recompute_invoice_paid` (status + paid_at logic) plus a one-shot backfill UPDATE for invoices stuck at `sent` with `balance_cents = 0`. | Touches finance triggers. Needs database-reviewer agent. |
| PR-2 | Project budget recompute | B4 | New migration adding `recompute_project_totals`; trigger on `project_line_items`; one-shot backfill call inside `convert_quote_to_project`. | Mirrors existing recompute pattern. Low risk. |
| PR-3 | Receiving `received_date` stamp on transition | B9 | One-line ops-api change. No migration. | Low risk. Server-authoritative. |
| PR-4 | Auto-number Quote / Receiving / Shipment / Invoice | B8 | Four API handler updates calling `nextDocNumber`; SPA forms drop the number input. Plus suspected admin-page query fix. | Medium scope. Splittable per-domain if smaller reviews preferred. |
| PR-5 | 3PL line-item NEW form (replace JSON textarea) | B3 | Extract working line editor from detail page into a reusable component; use on both receiving + shipment create. Delete textarea. | SPA only. Visual-regression worth running. |
| PR-6 | CRM polish + cosmetics | B5 + B6 + B11 + B7 | Activity create reads `useSearchParams`; contact create respects `return_to`; source-quote link styling check; quote button labels renamed. | SPA only. Low risk. |
| (deferred) | Manufacturing run draft audit row | B10 | New migration adding INSERT firing to `audit_manufacturing_runs_status`. | Audit completeness, not correctness. Park until next migration pass. |

Recommended sequence: PR-1 first (highest-value, closes two bugs); PR-3 in parallel; then PR-2; then PR-5; PR-4 in a quieter window; PR-6 rolling up; B10 deferred.

## Pending operator decisions (next session must surface these first)

The operator paused before any code work, asked me to persist these so the next session resumes cleanly. **Surface all three at the top of the next session.**

### Decision 1 — B2 fix scope

How should the invoice `paid` transition fire?

- **Option A (recommended):** Extend `recompute_invoice_paid` only. When `paid_cents + credit_allocated_cents >= total_cents`, set `status = 'paid'` and stamp `paid_at`. When `0 < paid_cents < total_cents`, set `status = 'partially_paid'`. Plus one-shot backfill UPDATE for historical invoices stuck at `sent` with `balance_cents = 0`. Single function update, atomic with the recompute, the audit trigger fires automatically.
- **Option B:** Add a separate trigger on `payment_allocations` that updates invoice status. Leaves `recompute_invoice_paid` alone but adds another moving part.
- **Option C:** Handle in the `invoicing-api/handlers/payments.ts` handler. Violates the constitution's "no best-effort handler writes" for state machines. **Not recommended.**

### Decision 2 — B7 vocabulary

DB enum is `'submitted'`. UI says `Submit`. Spec wants `Sent`.

- **Option A (recommended):** Rename UI labels only. Pre-approval action becomes "Send for approval"; post-approval "Send to customer". Update spec doc. No migration; constitutional.
- **Option B:** Multi-stage DB rename to `sent`. Forward migration adds the enum value, code dual-writes, second migration drops `submitted`. Two-PR sequence, full release cycle.
- **Option C:** Skip entirely. Mark as won't-fix in journal. The two different actions (internal submit vs send-to-customer) already reflect two different operations and the current naming is defensible.

### Decision 3 — B8 scope

Auto-numbering rollout for the four entities that don't have it:

- **Option A (recommended):** All four in one PR. Quote + Receiving + Shipment + Invoice convert RPC, all swapping to `nextDocNumber`. Larger diff but identical pattern repeated, single review for the new convention.
- **Option B:** Split per domain. Quote (sales), Receiving+Shipment (ops), Invoice convert (finance). Smaller reviews, three round-trips.
- **Option C:** Just Quote first, defer the rest. Smallest possible PR — quote auto-numbering was the spec-called-out one. Receiving / shipment / invoice can wait for a follow-up wave.

## Constitutional invariants verified

- **Money rules:** All affected money columns (`paid_cents`, `total_cents`, `budget_cents`, `line_total_cents`) remain BIGINT cents with the `_cents` suffix. Banker's rounding not involved (no float math in proposed fixes).
- **RLS rules:** No proposed change touches RLS policies. Filters stay as-is.
- **Migration rules:** Each proposed migration is a new forward-only file, idempotent (`drop trigger if exists` / `create or replace function`), with proper header (Wave, Phase, Closes, DOWN MIGRATION, date, alignment).
- **Audit log:** B2 fix lets `audit_invoices_status` (existing trigger from 0037) fire automatically. B10 explicitly extends an audit trigger. No best-effort handler writes proposed.
- **Capabilities:** No new caps required.

## Next session checklist

1. **Surface the three pending decisions first** (above) — do not start coding until the operator has answered.
2. Read this journal in full to recover context.
3. If decisions are made, start with PR-1 (B2 fix) — open a fresh worktree, write the migration extending `recompute_invoice_paid` plus the backfill, run database-reviewer agent, open PR.
4. PR-3 can run in parallel with PR-1 (different files, no overlap).
