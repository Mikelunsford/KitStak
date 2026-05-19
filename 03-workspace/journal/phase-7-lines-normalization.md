# Phase 7: receiving / shipment line item normalisation (F-Wave7-LINES-01)

Date: 2026-05-19
Branch: phase-7/inventory/line-normalization
Migration: 0050_receiving_shipment_line_items.sql (renumbered from 0049 to avoid collision with the CRM-SCHEMA-01 migration that landed first as 0049_customers_default_payment_terms_days.sql)

## Motivation

`receiving_orders.payload.lines` and `shipments.payload.lines` were a JSON
freeform array. Two prior PRs had hardened the surface: PR #28 (migration
0048) taught the emit_movements triggers to skip malformed line entries
instead of NOT NULL-violating; PR #42 added strict Zod validation at the
API boundary. Both leave the underlying shape as JSON. The operator-facing
experience was a hand-edited JSON blob with no Add Line / Edit Line / Delete
Line affordance, no FK referential integrity on item_id, and no audit trail
on individual line edits.

The constitution does not mandate normalisation for either entity. This
follow-up exists because the 6.5 audit flagged operational ergonomics as
the pain point. F-Wave7-LINES-01 normalises receiving + shipment into
proper child tables. Production runs are intentionally out of scope this
round (their `consumed` / `produced` shapes are more involved and aren't
named in the follow-up).

## Schema choice

Two new tables, both following the project_line_items shape from
migration 0044 (Pattern A RLS, org_id denormalised, ON DELETE CASCADE on
the parent FK):

* `receiving_order_line_items (id, org_id, receiving_order_id, item_id,
  quantity numeric(18,4), unit_cost_cents bigint nullable, uom, reference,
  position, created_at, created_by, updated_at, updated_by)`
* `shipment_line_items` with `shipment_id` in place of `receiving_order_id`
  but otherwise identical.

`quantity` is `numeric(18,4)`, not the integer-milli-units `quantity_e3`
shape used by quote_line_items, because the emit_movements triggers
(0032 / 0048) already read `(v_line ->> 'quantity')::numeric` from the
JSON. The new tables match what the triggers expect when the next
release migrates them off the JSON read. `unit_cost_cents` is nullable
because the existing JSON shape treats it as optional (the trigger
coalesces a missing value to 0); we surface the optionality in the
column rather than defaulting at insert time.

`item_id` is `not null references items(id)`. This is stricter than the
JSON shape (where item_id could be absent and the trigger would skip the
row) and matches the constitutional intent: lines without an item_id are
malformed at the API boundary already, the new table simply enforces it
at the schema layer.

RLS Pattern A on both tables. The role gate is the same set the parent
tables use: org_owner, org_admin, ops. Select is open to authenticated
within the org. Cross-tenant reads return `200 + []`; cross-tenant POSTs
return `404` because the handler's parent-load guard runs first.

## Backfill

The migration's INSERT ... SELECT scans every existing
`receiving_orders.payload.lines` and `shipments.payload.lines` JSON array,
filters on a non-null item_id that also matches a UUID regex, preserves
the array order via `row_number() over (... order by ordinality)`, and
guards the destination with NOT EXISTS so a re-run does not duplicate.

Malformed historical lines (missing or non-UUID item_id) are skipped, the
same posture the runtime triggers adopted in 0048. They remain visible in
the parent's `payload.lines` JSON until a future migration cleans them up
in the same multi-stage step that drops the field.

## Handler dual-write

Until a future migration moves the emit_movements triggers off the JSON
read, the handler MUST keep `payload.lines` on the parent in sync with
the rows in the new table. The chosen approach:

1. Every line-item POST / PATCH / DELETE inside ops-api ends with a call
   to `syncReceivingPayloadLines(...)` or `syncShipmentPayloadLines(...)`
   that re-reads the new table and overwrites `payload.lines` on the
   parent with the canonical projection.
2. The receive RPC (`POST /receiving-orders/:id/receive`) and ship RPC
   (`POST /shipments/:id/ship`) still accept a `lines` body for backward
   compatibility. Operators using only the new endpoints can pass an
   empty array there; the parent's `payload.lines` already reflects the
   line-item table.

Why dual-write at the handler layer rather than a DB trigger: a DB
trigger that rewrote `payload.lines` on every line-item INSERT / UPDATE
/ DELETE would run inside the same transaction as the parent UPDATE
that fires emit_movements, which could surface as inconsistent
intermediate state if the order of trigger firings shifted. Dual-writing
at the handler keeps the contract explicit and the failure mode loud.

## Multi-stage drop plan for `payload.lines`

Per the constitutional multi-stage drop rule:

1. **This release (0049)**: add new tables, backfill from JSON, handler
   dual-writes to both. Triggers still read from JSON.
2. **Next release**: migrate `tg_receiving_orders_emit_movements` and
   `tg_shipments_emit_movements` to read from
   `receiving_order_line_items` / `shipment_line_items` instead of
   `payload -> 'lines'`. The handler's dual-write remains because the
   field is still present and audit consumers may still read it.
3. **Release after**: drop the dual-write from the handler; deploy the
   handler with the new contract.
4. **Release after that**: forward migration drops `payload.lines` from
   the parent (the parent's `payload` jsonb stays for other extension
   fields). The receive / ship RPCs drop their `lines` body parameter
   in the same release.

This is logged here so a future agent doesn't forget the steps.

## Capabilities added

Per the D-011 per-bundle shim pattern, the new caps live in the
vendors_inventory_ops side-car only (and its byte-identical SPA mirror).
The singular `_shared/capabilities.ts` is NOT touched.

* `receiving.line_item.{read,create,update,delete}`
* `shipment.line_item.{read,create,update,delete}`

Role assignments:
* `org_owner` / `org_admin`: all four actions on both resources.
* `ops`: all four actions on both resources.
* `accounting` / `viewer`: read only on both.
* `sales` / `customer_user` / `vendor_user`: not granted.

## RLS probe matrix posture

The new tables use Pattern A unchanged from the project_line_items
precedent (0044). The 48-probe matrix in `02-canon` covers Pattern A
parent-scoped tables; the new tables follow that posture exactly, so
the existing probe count is not invalidated. A follow-up could add four
new probe rows (select + insert for both tables) for explicit
coverage; that's a follow-up rather than a release-blocking gap because
Pattern A is the canon.

## Gates

* `pnpm typecheck`: clean.
* `pnpm lint`: clean.
* `pnpm test`: 5 / 5 files, 19 passed + 2 skipped.
* `pnpm test:contract`: 26 / 26.
* `pnpm build`: clean.
* `pnpm bundle-budget`: 29.71 / 40 kB gzipped (well under).
* `scripts/canon-steward-check.mjs`: exit 0.
* `scripts/trigger-audit-check.mjs`: exit 0.

## Backfill counts

Not run against a live DB in this worktree; the SPA / Edge gates are
exercised but the migration is queued for the Supabase Preview branch
the PR creates. The backfill is idempotent (NOT EXISTS guard on the
destination), so re-applying the migration after Preview merges has no
effect on count.

## Files touched

* `supabase/migrations/0050_receiving_shipment_line_items.sql` (new)
* `supabase/functions/_shared/types/vendors_inventory_ops.ts` (extended)
* `supabase/functions/_shared/capabilities/vendors_inventory_ops.ts` (extended)
* `apps/web/src/lib/types/vendors_inventory_ops.ts` (byte-mirror)
* `apps/web/src/lib/capabilities/vendors_inventory_ops.ts` (byte-mirror)
* `supabase/functions/ops-api/index.ts` (8 new routes + dual-write helpers)
* `apps/web/src/lib/services/receivingOrderLineItemsService.ts` (new)
* `apps/web/src/lib/services/shipmentLineItemsService.ts` (new)
* `apps/web/src/lib/hooks/useOps.ts` (6 new hooks)
* `apps/web/src/pages/3pl-operations/receiving/ReceivingOrderDetailPage.tsx` (Add / Remove Line UI)
* `apps/web/src/pages/3pl-operations/shipments/ShipmentDetailPage.tsx` (Add / Remove Line UI)
* `STATUS.md` (closed-this-session entry)
* `03-workspace/journal/phase-7-lines-normalization.md` (this file)
