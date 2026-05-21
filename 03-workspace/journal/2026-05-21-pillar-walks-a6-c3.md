# Close Path A6 + Path C3 — Manufacturing and KitCost pillars lit

**Date:** 2026-05-21
**Decision:** Both pillars open for the operator. Path B (customer portal + Resend + Stripe) cleared to dispatch per `pillar-wiring-sequence` memory.
**Driven by:** Operator action, this session.

## Context

Path A1 through A5 (Manufacturing pillar wiring) and Path C / C1+C2 (KitCost dashboard) merged in the preceding 24 hours under PRs #77 through #82. Both paths landed with explicit "operator action required" gates:

- **Path A6** — flip `plugins.manufacturing` in `org_feature_flags` for the operator's prod org, smoke-walk `/manufacturing/runs`.
- **Path C3** — flip `plugins.kitcost`, smoke-walk `/kitcost/dashboard`.

No code work expected this session. Pure pillar-light-up plus a small documentation closeout.

## What ran

### Path A6 — Manufacturing smoke walk

1. `plugins.manufacturing` flipped to `is_enabled = true` via `/admin/flags` on `https://www.kitstak.com`.
2. After the edge-function 5-minute cache window, `manufacturing-api` started accepting requests.
3. Operator walked the full state machine on `/manufacturing/runs`:
   - Created a `draft` run with warehouse selected.
   - Added at least one Consumed line (item_id required, qty + unit_cost_cents posted).
   - Added at least one Produced line (item_id nullable per schema).
   - Transitioned `draft` → `started`.
   - Transitioned `started` → `completed` through the `window.confirm` gate.
4. Verified downstream effects:
   - `stock_movements` rows posted for the consumed and produced lines (via `/3pl-operations/stock/movements`).
   - `AuditTimeline` on the run detail page populated with the full lifecycle (`run.draft → run.start → run.complete`).

Result: green. Pillar 2 surface is live.

### Path C3 — KitCost smoke walk

1. `plugins.kitcost` flipped to `is_enabled = true` via the same admin page.
2. `/kitcost/dashboard` rendered with:
   - 4 KPI cards (Total Revenue YTD, Invoiced This Month, Active Projects, Inventory Value).
   - 3 charts in brand palette (revenue trend line, top customers horizontal bar, project margins grouped bar).
3. Honest data signal from the operator's test workspace:
   - **Total Revenue YTD: $0.00** — correct, counts only invoices with status `paid`.
   - **Invoiced This Month: $505.00** — correct, counts invoices by `issue_date` regardless of status. The test invoice exists, but never transitioned to `paid`.
   - **Active Projects: 1** — correct, matches the test project in `ready_to_build` / `in_production` / `ready_to_ship` state.
   - **Inventory Value: $0.00** — correct, no stock-on-hand with non-null `unit_cost_cents` yet.
   - **Top Customers: "No paid invoices yet"** — correct empty state.
   - **Revenue Trend chart** — 12 zero-points across `2025-06` through `2026-05`. The Y-axis tick labels all show `$0` because the formatter has no non-zero datapoint to scale against. Acceptable empty-state shape.

Result: green. Dashboard does what it claims to do.

### Data observation worth noting (not a bug)

The operator's $505 test invoice did not surface in Top Customers even after a paid-payment flow ran on it. Root cause: the invoice was created without a `customer_id` (the operator notes "It didn't have one to tie to at the time of receiving payment"). The KitCost backend joins `invoices.customer_id` to `customers.display_name`; a null `customer_id` means no top-customer row. This is the right shape (no synthetic "Unknown customer" bucket), but it's a **first-operator-onboarding signal**: when we light up Path B (customer portal + Stripe), the invoice-creation flow should either require `customer_id` at the create step OR surface a "no customer attached" warning on the detail page. Filed below.

## F-Wave6-NAV-02 (Manufacturing + KitCost portion) — closeout-only

No code change needed. Verified that `apps/web/src/components/shell/Sidebar.tsx` already includes:

- `MANUFACTURING` section gated on `FEATURE_FLAGS.PLUGINS_MANUFACTURING`, child `/manufacturing/runs` "Production runs". Pre-wired at PR #15 / #16 (Wave 6 chassis hotfixes).
- `KITCOST` section gated on `FEATURE_FLAGS.PLUGINS_KITCOST`, child `/kitcost/dashboard` "Cost dashboard". Same pre-wire.

Both paths match the routes that lit up today. Section keys (`manufacturing`, `kitcost`) match the `findActiveSection` lookup, so deep-link active-state highlighting works.

Remaining `F-Wave6-NAV-02` scope (Co-Pack and Ecom, KitForce) stays open. Revisit trigger: those pillars lighting up.

## Constitutional invariants verified

| Invariant | Status |
|---|---|
| No code change — pure operator action + closeout doc | Confirmed |
| `plugins.<pillar>` bundle gate honored (cross-tenant 404, not 403) | Server log inspection: pre-flip GET `/manufacturing/runs` returned 404; post-flip returned 200 with rows |
| RLS Pattern A on `manufacturing_runs` and KitCost aggregates | Operator only saw their own org's data |
| Banker's rounding / BIGINT cents end-to-end | KPI cards rendered via `formatCents`; KitCost wire uses string-encoded cents |
| Forward-only migrations | None touched |
| Mirror parity | None touched |
| Audit log integrity (hash chain, append-only) | Manufacturing run lifecycle events posted as expected |

## Closes

- **`Path A6`** — Manufacturing pillar live for the operator's prod org. Pillar 2 dispatchable now.
- **`Path C3`** — KitCost dashboard live for the operator's prod org. Pillar 5 dispatchable now.
- **`F-Wave6-NAV-02`** (Manufacturing + KitCost portion only) — Sidebar verified matching routes.

## Spawns

- **`F-Wave9-INVOICE-CUSTOMER-REQUIRED-01`**: when the operator surfaces a real customer-portal request OR Path B's first invoice-creation flow lands, decide whether `invoices.customer_id` should be `NOT NULL` at the schema, required at the API handler, or required at the SPA create form. The current chassis allows null; that's defensible for the "issue an invoice to a one-off contact you haven't onboarded yet" case, but it does mean KitCost top-customers silently undercounts revenue. Today's observation is the first real-world signal of the trade-off. Pure deferral, no SQL today.

## Next dispatch

Per `pillar-wiring-sequence` memory: Path B opens. Smallest first piece is **Resend HTTP wiring** (~50 lines per the plan), to be picked up in the next session under operator direction. No code starts until the operator confirms scope.
