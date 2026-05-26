# 2026-05-25 - Dashboard Setup Checklist

Status: shipped via PR (pending).
Branch: `feat/0065-dashboard-setup-checklist`
Builds on: PR #143 (migration 0064 provision-org completeness).

## Why this work

Now that `provision_organization` ships a complete seed surface (PR #143 merged earlier today), the dashboard can stand on a 7-step canonical onboarding journey that matches the real prerequisite chain operators walk to get to first revenue: warehouse, customer, item, quote, receiving, invoice, payment.

The previous dashboard onboarding surface had three problems documented in the four-agent provisioning audit:

1. **Wrong steps.** The four "Get started" cards were `create_customer / add_item / create_quote / invite_teammate`, missing warehouse, receiving, invoice, and payment, and including a dead-end "invite teammate" link.
2. **No persistence.** The empty-state branch fired only when every work-card count was zero. A partially-configured org with one submitted quote but no warehouse and no payments saw the live work cards instead of the guided path forward.
3. **No progress signal.** The operator had no read on "how far am I from being set up."

This surface replaces the cards with a guided checklist that reflects real entity counts, persists until every step is complete, and gives the operator both progress and forward direction.

## What shipped

### Backend (Edge Function, no DB migration needed)

`supabase/functions/dashboard-api/index.ts` extended with a new `existsRowForOrg(client, table, orgId, applyFilters)` helper that returns a boolean from a `head: true` count query. Seven new computations land in the Promise.all pipeline:

- `setup_warehouse_added` - any warehouse where `deleted_at IS NULL`
- `setup_customer_added` - any customer where `deleted_at IS NULL`
- `setup_item_added` - any item where `deleted_at IS NULL`
- `setup_quote_created` - any quote where `deleted_at IS NULL`
- `setup_receiving_received` - any receiving_order where `status IN ('received','completed')` and `deleted_at IS NULL`
- `setup_invoice_sent` - any invoice where `sent_at IS NOT NULL` and `deleted_at IS NULL`
- `setup_payment_received` - any payment where `deleted_at IS NULL`

`setup_warehouse_added` is true from day one for any org provisioned after migration 0064 because `seed_org_default_warehouse` runs at provisioning. The SPA copy on step 1 explains the default and points the operator to Library to rename it.

### Zod canon (byte-mirror parity)

Added seven boolean fields with `.default(false)` to `DashboardSummarySchema` in both `apps/web/src/lib/types/cross_cutting.ts` and `supabase/functions/_shared/types/cross_cutting.ts`. The default lets older clients parse cleanly during deploy lag. `pnpm test:contract` confirms parity.

### SPA

- `apps/web/src/pages/dashboardChecklistSteps.ts` - pure helper exporting `buildSetupSteps`, `countCompletedSetupSteps`, `isSetupComplete`, and `SETUP_STEPS_TOTAL = 7`. No React import; testable under Vitest without a DOM renderer, matching the dashboardWorkCards.ts pattern.
- `apps/web/src/components/shell/SetupChecklist.tsx` - new component. Brand-aligned: font-display tracking-wide section header, accent progress bar with a 500ms ease-out transition, lucide CheckCircle2/Circle icons, ink-dim line-through label on complete rows, ArrowRight CTA on pending rows that slides on group hover. Each row is the full clickable area when pending; complete rows are static. ARIA: section labelled "Setup progress: X of N complete"; pending rows carry `aria-current="step"`.
- `apps/web/src/pages/DashboardPage.tsx` - replaced the prior `isAllCountsZero` empty-state branch with `isSetupComplete`. While any step is pending the dashboard renders SetupChecklist. Once every step is complete the work-card grid takes over as before.
- `apps/web/src/pages/dashboardWorkCards.test.ts` - factory extended with the 7 new boolean fields (default false) so the existing tests still typecheck cleanly.

### Tests

- 11 new pure-helper tests in `dashboardChecklistSteps.test.ts` covering step order, route correctness, copy discipline (no em dash, no double hyphen, no emoji), default-warehouse helper-copy presence, count behaviour, and `isSetupComplete` truth table.
- All 187 existing tests still pass; contract / typecheck / build / regression all green.

## Constitutional invariants verified

| Invariant | Outcome |
|---|---|
| Money rules | Untouched. No `_cents` columns or wire shapes affected. |
| RLS rules | Untouched. The Edge Function reads via service_role with explicit `eq('org_id', orgId)` scoping; no new RLS surface. |
| Audit rules | Untouched. No new mutations. |
| Migration rules | No new migration needed (dashboard summary is an Edge Function, not a SQL RPC). |
| Zod canon | Byte-mirror parity asserted by `pnpm test:contract` (exit 0). |
| Brand discipline | All copy linted: no em dash, no double hyphen, no emoji. Tests assert this regex on every label and helper string. |

## Bundle delta

- Main bundle (`index-*.js`): `30.39 kB` gzipped (was `30.36 kB`; +0.03 kB).
- DashboardPage chunk: `9.00 kB / 3.03 kB gzipped` (SetupChecklist + helper land here, lazy-loaded with the page).
- Well within the 40 kB main-bundle budget from STATUS.md.

## Design decisions worth flagging

- **Step 1 warehouse routes to `/3pl-operations/warehouses` (list)**, not `/new`. Rationale: the default warehouse already exists post-0064; the operator wants to rename it or add a peer, not create another `DEFAULT`. Helper copy says so explicitly.
- **No "invite a teammate" step.** The staff invite chassis is not yet built (F-Wave9-STAFF-INVITE-CHASSIS-01). Shipping a row that dead-ends would feel worse than its absence. Add as step 8 when that follow-up lands.
- **No persistent "I've seen the checklist" flag.** Completion is purely derived from entity counts. The operator cannot dismiss the checklist; once every entity exists, the dashboard transitions to the work-card grid. If an entity later gets soft-deleted (rolling the org back to incomplete) the checklist returns. This is the simplest correct behaviour and matches the spirit of "checklist as live signal, not as a one-time tour."
- **Step 1 is checked from day one.** A new operator sees their first checkmark already filled, with microcopy explaining why. This gives a "you're already started" feeling and answers the obvious "what is Default Warehouse?" question inline.

## Out of scope (filed as follow-ups)

| Follow-up | Why deferred |
|---|---|
| `F-Wave9-CHECKLIST-DISMISS-01` | An operator who completed setup via a path that produced soft-deleted rows could end up bouncing between work-card and checklist surfaces. Defer the dismissal flag until any operator surfaces this as a complaint. |
| `F-Wave9-CHECKLIST-CELEBRATION-01` | Brief "Setup complete" celebration banner that fades in once on the first transition to the work-card grid. Cheap dopamine, screenshots well. Defer until first marketing-screenshot pass surfaces the need. |
| `F-Wave9-STAFF-INVITE-CHASSIS-01` (carries) | Once shipped, add as step 8 (optional) on the checklist. |
| `F-Wave9-DETAIL-EMPTY-COACHING-01` | ListEmptyState pattern does not reach detail pages today. ProjectDetailPage, ManufacturingRunDetailPage, CustomerDetailPage with no children render plain `text-ink-dim` lines. Add a SetupChecklist-style coaching block per detail-page section. Screenshot wedge for the polish wave. |

## Process notes

- Audit run earlier today scoped this work to "extend DashboardSummary" rather than "create new dashboard_setup_state RPC." Saved an entire migration cycle. Worth noting: when the data signal already exists in the dashboard payload, extend the payload before reaching for new tables or RPCs.
- The Zod canon byte-mirror parity test caught zero drift on my first edit because I made the same edit to both files in the same tool turn. Pattern to keep: when adding to DashboardSummarySchema, paste the same block into both files in a single message to avoid mid-flight drift.
- The pure-helper extraction pattern (dashboardChecklistSteps.ts) lets vitest exercise the step-order and copy-discipline assertions without ever loading the React tree or the supabase singleton. Continues the pattern lifted in PR #103 (parseEntityTypeParam, applyItemSelection) and validated by the consistent "no jsdom" test posture in this repo.
