# Pillar 3: Co-Pack and Ecom. Domain spec (draft for approval)

Status: APPROVED. Operator resolved all open decisions 2026-05-31. Ready for
implementation. Co-Pack ships before KitForce.
Date: 2026-05-31
Author: build agent
Feature flag: `plugins.copack_ecom` (already defined in `apps/web/src/lib/constants.ts` and `_shared/constants.ts`).

This spec describes the smallest coherent Co-Pack and Ecom surface that ships
value to the first operator. It follows the established chassis exactly: Pattern
A RLS from table creation, BIGINT `_cents` money, `numeric(18,4)` quantities,
status text plus CHECK constraint state machines, append-only audit triggers, a
bundle-gated edge function that returns 404 when the pillar flag is off, and a
lazy-loaded SPA pillar mirror. Nothing here introduces a new architectural
pattern. Where a real design decision exists, it is called out under Open
decisions rather than resolved unilaterally.

## 1. What this pillar is for

The operator runs co-packing and ecommerce fulfillment: orders arrive from one
or more sales channels, kits or assemblies are built to fill them, and the
finished goods are picked, packed, and shipped. Pillar 3 gives the operator a
single place to land an order, turn it into a kitting job, and track it through
to shipment.

## 2. Scope

In scope for Phase 1:

- A channel registry so orders can be attributed to a source.
- Sales orders and their line items.
- Kitting jobs that consume components and produce finished kits.
- A pick, pack, ship status flow on the order, reusing the existing `shipments`
  table from migration 0032 where possible.

Deferred (not in Phase 1, listed so the boundary is explicit):

- Live channel integrations (Shopify, Amazon, ShipStation APIs). Phase 1 channels
  are records, not connectors. Orders are entered or imported manually.
- Carrier rate shopping and live label purchase.
- Inventory allocation and oversell prevention beyond what existing
  `stock_movements` already records.
- Returns and RMA.

## 3. Entities and state machines

All tables are org-scoped with denormalized `org_id` for Pattern A RLS, carry the
standard `created_at / created_by / updated_at / updated_by` columns, and (for
parents) `deleted_at` for soft delete. Quantities are `numeric(18,4)`. Money is
BIGINT `_cents`.

### 3.1 `sales_channels` (library)

A per-org registry of where orders come from. No state machine.

- `id`, `org_id`
- `name` text not null (e.g. "Shopify storefront", "Amazon US", "Manual")
- `kind` text not null check in (`manual`, `shopify`, `amazon`, `other`)
- `is_active` boolean not null default true
- standard audit columns

### 3.2 `sales_orders` (parent, state machine)

- `id`, `org_id`
- `order_number` text, nullable, org-scoped partial unique index (mirrors
  `manufacturing_runs.run_number`), filled by the numbering chassis
  (`nextDocNumber`).
- `channel_id` uuid references `sales_channels(id)`, nullable
- `customer_id` uuid references `customers(id)`, nullable
- `project_id` uuid references `projects(id)`, nullable (lets an order roll up to
  a 3PL/co-pack project)
- `status` text not null default `draft` check in
  (`draft`, `confirmed`, `picking`, `packed`, `shipped`, `cancelled`)
- `currency_code` text (snapshotted at confirmation, per the money rules)
- `ordered_at`, `confirmed_at`, `shipped_at`, `cancelled_at` timestamptz,
  handler-set
- `notes`, `payload jsonb default '{}'`
- standard audit columns

State machine:

```
draft     -> confirmed
confirmed -> picking
picking   -> packed
packed    -> shipped
draft|confirmed|picking|packed -> cancelled
shipped   -> (terminal)
```

### 3.3 `sales_order_line_items`

Mirrors `manufacturing_run_consumed_line_items` shape with the parent FK swapped.
`item_id` is REQUIRED (an order line names what was ordered).

- `id`, `org_id`, `sales_order_id` (FK, on delete cascade)
- `item_id` uuid not null references `items(id)`
- `quantity numeric(18,4)` not null default 0 check >= 0
- `unit_price_cents bigint` check null or >= 0
- `uom`, `reference`, `position int`
- standard audit columns

### 3.4 `kitting_jobs` (parent, state machine)

The co-pack build. DECIDED (K1): a new `kitting_jobs` table, distinct from
`manufacturing_runs`, so the two pillars can diverge later. It mirrors the
manufacturing run shape one-for-one.

- `id`, `org_id`
- `job_number` text nullable, org-scoped partial unique index
- `sales_order_id` uuid references `sales_orders(id)`, nullable (build to order or
  build to stock)
- `warehouse_id` uuid references `warehouses(id)`, nullable
- `status` text not null default `draft` check in
  (`draft`, `started`, `completed`, `cancelled`)
- `planned_start_at`, `planned_complete_at`, `started_at`, `completed_at`,
  `cancelled_at` timestamptz
- `notes`, `payload jsonb`
- standard audit columns

State machine identical to `manufacturing_runs`:

```
draft   -> started
started -> completed
draft|started -> cancelled
completed -> (terminal)
```

### 3.5 `kitting_job_consumed_line_items` and `kitting_job_produced_line_items`

Byte-for-byte the manufacturing line-item shape. Consumed `item_id` REQUIRED,
produced `item_id` NULLABLE (lenient produced side, same rationale as
F-Wave7-LINEFORM-VALIDATE-01). On `started -> completed`, a DB trigger emits
`stock_movements` (consumed out, produced in) when `warehouse_id` is non-null,
mirroring migration 0053 exactly.

### 3.6 `fulfillments` (parent, state machine)

DECIDED (E1): a new dedicated `fulfillments` table, distinct from the existing
`shipments` table (0032), so co-pack pick/pack/ship semantics stay separate. The
`fulfillments` table owns the pick/pack/ship workflow for an order; the existing
`shipments` row remains the carrier/label record and is linked, not replaced.

- `id`, `org_id`
- `fulfillment_number` text nullable, org-scoped partial unique index, filled by the
  numbering chassis (`nextDocNumber`)
- `sales_order_id` uuid not null references `sales_orders(id)`
- `warehouse_id` uuid references `warehouses(id)`, nullable
- `shipment_id` uuid references `shipments(id)`, nullable (links to the carrier/label
  shipment row once one exists)
- `status` text not null default `pending` check in
  (`pending`, `picking`, `packed`, `shipped`, `cancelled`)
- `picked_at`, `packed_at`, `shipped_at`, `cancelled_at` timestamptz, handler-set
- `notes`, `payload jsonb default '{}'`
- standard audit columns

State machine:

```
pending -> picking
picking -> packed
packed  -> shipped
pending|picking|packed -> cancelled
shipped -> (terminal)
```

The `sales_orders.status` flow (`picking`, `packed`, `shipped`) reflects the order's
active fulfillment; the fulfillment row is the authoritative pick/pack/ship record. A
fulfillment reaching `shipped` is the trigger that advances the order to `shipped`.

## 4. Audit log

New `entity_type` values, added by the same guarded drop-then-add CHECK extension
used in migration 0052: `sales_channel`, `sales_order`, `sales_order_line_item`,
`kitting_job`, `kitting_job_consumed_line_item`, `kitting_job_produced_line_item`,
`fulfillment`.

State-machine parents (`sales_orders`, `kitting_jobs`, `fulfillments`) get an
AFTER UPDATE OF status audit trigger (the `trg_audit_manufacturing_runs_status`
pattern). Line items and the channel library get the
`audit_append_state_change` INSERT/UPDATE/DELETE trigger with an action verb in
`to_state`.

## 5. Capabilities

Naming follows `<domain>.<resource>.<action>`. Proposed set, registered in both
`apps/web/src/lib/capabilities.ts` and `_shared/capabilities/`:

```
copack.channel.read
copack.channel.write
copack.order.read
copack.order.create
copack.order.update
copack.order.confirm
copack.order.cancel
copack.order.line_item.create
copack.order.line_item.update
copack.order.line_item.delete
copack.kitting_job.create
copack.kitting_job.update
copack.kitting_job.delete
copack.kitting_job.start
copack.kitting_job.complete
copack.kitting_job.cancel
copack.kitting_job.line_item.create
copack.kitting_job.line_item.update
copack.kitting_job.line_item.delete
copack.fulfillment.pick
copack.fulfillment.pack
copack.fulfillment.ship
```

RLS write policies use `current_user_role() in ('org_owner','org_admin','ops','sales')`
for orders and channels, and `('org_owner','org_admin','ops')` for kitting jobs
and fulfillment. Confirm role mapping under Open decision C1.

## 6. Edge function bundle

New bundle `copack-api`, sibling to `manufacturing-api`, gated on
`plugins.copack_ecom` via `serveBundleWithGate`. Gate off returns the 404
NOT_FOUND envelope for every path. Each state-changing route calls `requireCap`,
enforces `Idempotency-Key` through `respondWithIdempotency`, and rejects illegal
FSM transitions with `STATE_CONFLICT` 409 before the DB call.

Routes:

```
GET    /sales-channels                         list
POST   /sales-channels                         create
PATCH  /sales-channels/:id                     update
GET    /sales-orders                           list
POST   /sales-orders                           create
GET    /sales-orders/:id                       read
PATCH  /sales-orders/:id                       update (draft only)
DELETE /sales-orders/:id                        soft-delete
POST   /sales-orders/:id/confirm               draft -> confirmed
POST   /sales-orders/:id/cancel                -> cancelled
GET    /sales-orders/:id/lines                 list line items
POST   /sales-orders/:id/lines                 add line
PATCH  /sales-orders/:id/lines/:lineId         update
DELETE /sales-orders/:id/lines/:lineId         delete
GET    /kitting-jobs                            list
POST   /kitting-jobs                            create
GET    /kitting-jobs/:id                        read
PATCH  /kitting-jobs/:id                        update (draft only)
DELETE /kitting-jobs/:id                        soft-delete
POST   /kitting-jobs/:id/start                  draft -> started
POST   /kitting-jobs/:id/complete               started -> completed
POST   /kitting-jobs/:id/cancel                 -> cancelled
GET    /kitting-jobs/:id/consumed               list / add / update / delete
GET    /kitting-jobs/:id/produced               list / add / update / delete
GET    /fulfillments                            list (filterable by order, status)
POST   /fulfillments                            create (for a sales order)
GET    /fulfillments/:id                        read
POST   /fulfillments/:id/pick                   pending -> picking
POST   /fulfillments/:id/pack                   picking -> packed
POST   /fulfillments/:id/ship                   packed -> shipped (advances the order)
POST   /fulfillments/:id/cancel                 -> cancelled
```

## 7. Zod canon

New entity schemas land byte-identical in `_shared/types/` and the SPA
`apps/web/src/lib/types/` mirror, asserted by `pnpm test:contract`. Money fields
use the existing `BigIntCentsSchema`. A drift is a release blocker, same as today.

## 8. SPA wiring

- Pages under `apps/web/src/pages/copack/`: `CoPackHomePage`,
  `SalesOrdersListPage`, `SalesOrderDetailPage`, `SalesOrderCreatePage`,
  `KittingJobsListPage`, `KittingJobDetailPage`, `KittingJobCreatePage`,
  `ChannelsListPage`, `FulfillmentsListPage`, `FulfillmentDetailPage`.
- Hooks in `apps/web/src/lib/hooks/useCoPack.ts` (TanStack Query, `staleTime
  30_000`, `refetchOnWindowFocus: false`, `retry: 1`; mutations invalidate the
  entity key plus `auditLogKeys.byEntity`).
- Routes added to the flat `ROUTES` table under `/copack/*`. Because
  `inferPluginForPath` maps the `/copack` URL space, every route auto-gates on
  `plugins.copack_ecom` and returns NotFoundPage when off. `/new` and
  `/from-order` paths must precede `/:id`.
- Job-mode sidebar: the existing SELL / MAKE / SHIP groups already fit. Order
  entry lands under SELL, kitting under MAKE, fulfillment under SHIP. No new
  pillar-landing sidebar link (the sidebar is workflow-grouped by design).

## 9. Migration plan

Forward-only, numbered from the next free id (0073+ at time of writing; confirm
against `supabase/migrations/` at implementation time). Suggested split, one
concern per file:

1. `NNNN_copack_channels_orders.sql` (channels, orders, order line items, RLS,
   audit triggers, audit_log CHECK extension).
2. `NNNN_copack_kitting_jobs.sql` (kitting jobs and line items, RLS, audit
   triggers, CHECK extension for the three kitting entity types).
3. `NNNN_copack_kitting_emit_movements.sql` (the `started -> completed` stock
   movement trigger).
4. `NNNN_copack_fulfillments.sql` (new `fulfillments` table with nullable
   `shipment_id` link to the existing `shipments` row, RLS, status audit trigger,
   CHECK extension for `fulfillment`).

Agents apply to STAGING only via Supabase MCP; the post-merge workflow ships to
prod via file-based push.

## 10. Decisions (resolved 2026-05-31)

- **K1. Kitting jobs: new table or reuse `manufacturing_runs`?** RESOLVED: new
  `kitting_jobs` table, distinct from `manufacturing_runs`. Keeps co-pack semantics
  separate and lets the two pillars diverge later.
- **E1. Fulfillment storage: extend `shipments` or new `fulfillments` table?**
  RESOLVED: new `fulfillments` table (section 3.6), with a nullable `shipment_id`
  link to the existing `shipments` carrier/label row.
- **C1. Write-role mapping.** RESOLVED: `sales` may create and confirm orders;
  `ops` owns kitting and fulfillment. Orders and channels write policy is
  `('org_owner','org_admin','ops','sales')`; kitting and fulfillment write policy is
  `('org_owner','org_admin','ops')`.
- **N1. Order numbering prefix.** RESOLVED: `SO-` for sales orders, `KIT-` for
  kitting jobs, via the existing numbering chassis. Fulfillments use `FUL-`.

## 11. Out of scope confirmations

No change to RLS helpers, money helpers, idempotency, or audit_log hash chain.
No new top-level dependency. No floats. No 403 where 404 is constitutional.
