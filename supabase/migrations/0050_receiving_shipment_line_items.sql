-- ============================================================================
-- Migration: 0050_receiving_shipment_line_items.sql
-- Wave: 7
-- Phase: 7 stabilization (schema normalisation)
-- Closes: F-Wave7-LINES-01 (receiving / shipment line items stored as
--   payload JSON; operator-facing line editing is painful and validation
--   is loose). PR #28 hardened the database triggers and PR #42 hardened
--   the API boundary, but the JSON-as-line-store shape is still the root
--   design. This migration normalises receiving + shipment into proper
--   child tables. Production runs stay JSON in this round (out of scope
--   for F-Wave7-LINES-01).
-- Date: 2026-05-19
-- DOWN MIGRATION: operator-only. Drop in reverse:
--   drop trigger if exists shipment_line_items_set_updated_at on public.shipment_line_items;
--   drop trigger if exists receiving_order_line_items_set_updated_at on public.receiving_order_line_items;
--   drop function if exists public.trg_shipment_line_items_set_updated_at();
--   drop function if exists public.trg_receiving_order_line_items_set_updated_at();
--   drop policy if exists shipment_line_items_write  on public.shipment_line_items;
--   drop policy if exists shipment_line_items_select on public.shipment_line_items;
--   drop policy if exists receiving_order_line_items_write  on public.receiving_order_line_items;
--   drop policy if exists receiving_order_line_items_select on public.receiving_order_line_items;
--   drop table if exists public.shipment_line_items;
--   drop table if exists public.receiving_order_line_items;
--   Not auto-run.
--
-- Constitutional alignment:
--   Money rules        unit_cost_cents stored as BIGINT cents with the
--                      _cents suffix. quantity uses numeric(18,4) so the
--                      shape matches the existing emit_movements trigger
--                      (it reads numeric out of payload.lines today) and
--                      the project_line_items convention from 0044. The
--                      math layer (_shared/money.ts) is the single
--                      authority for cents arithmetic; this migration
--                      does not add aggregates. No floats anywhere.
--   RLS rules          Pattern A on receiving_order_line_items and
--                      shipment_line_items. org_id is denormalised onto
--                      every row so RLS evaluates without a parent join,
--                      mirroring 0044's project_line_items shape. Cross
--                      tenant reads return 200 + []; cross tenant writes
--                      hit the same NOT_FOUND surface as the parent.
--                      ON DELETE CASCADE on the parent FK keeps lines and
--                      parent in sync on physical delete; today's parent
--                      handler is soft-delete via deleted_at, so cascade
--                      is defensive.
--   Audit rules        Line items DO NOT participate in their own state
--                      machine; they are pure attribute rows on a parent
--                      that has its own state machine. Per the
--                      constitution, "auto-state-transition triggers on
--                      every entity with a state machine" - line items
--                      have none, so no audit trigger is required. The
--                      parent transition audit row (0037 / 0044 family)
--                      continues to capture state changes; the line
--                      payload at terminal transition is captured via
--                      the existing payload.lines JSON copy (kept in
--                      sync by dual-write at the handler layer; see the
--                      multi-stage drop note below).
--   Migration rules    Forward-only. All DDL idempotent (CREATE TABLE IF
--                      NOT EXISTS, drop-policy-if-exists before create,
--                      CREATE INDEX IF NOT EXISTS, drop-and-create on
--                      trigger). The backfill INSERT is gated by NOT
--                      EXISTS on the destination so a re-run does not
--                      duplicate rows.
--   Multi-stage drop   This migration ONLY adds tables and backfills.
--                      payload.lines on receiving_orders and shipments
--                      is intentionally NOT dropped. The existing
--                      emit_movements triggers (0032 + 0048) still read
--                      from payload.lines on the parent's terminal
--                      transition; the handler layer dual-writes to
--                      both the new line tables AND the JSON mirror so
--                      the trigger keeps firing correctly. The next
--                      release migrates the triggers to read from the
--                      new tables, after which a follow-up migration
--                      can DROP the payload.lines field per the
--                      constitutional multi-stage drop rule.
--
-- Side-car canon coordination:
--   _shared/types/vendors_inventory_ops.ts + apps/web/src/lib/types/
--     vendors_inventory_ops.ts add ReceivingOrderLineItemSchema,
--     ReceivingOrderLineItemCreateSchema, ShipmentLineItemSchema,
--     ShipmentLineItemCreateSchema as the zod contract for these tables.
--   _shared/capabilities/vendors_inventory_ops.ts + apps/web/src/lib/
--     capabilities/vendors_inventory_ops.ts add
--     receiving.line_item.{read,create,update,delete} and
--     shipment.line_item.{read,create,update,delete} caps. The
--     singular byte-mirrored _shared/capabilities.ts is NOT touched (per
--     D-011 per-bundle shim pattern). The ops-api requireVioCap shim
--     consults the side-car canon for these caps.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- receiving_order_line_items: normalised line items on a receiving order.
-- One row per (receiving_order_id, position). org_id denormalised for
-- RLS Pattern A and cheap parent-scoped filtering.
-- ---------------------------------------------------------------------------

create table if not exists public.receiving_order_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  receiving_order_id uuid not null references public.receiving_orders(id) on delete cascade,
  item_id uuid not null references public.items(id),
  quantity numeric(18, 4) not null default 0 check (quantity >= 0),
  unit_cost_cents bigint check (unit_cost_cents is null or unit_cost_cents >= 0),
  uom text,
  reference text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists receiving_order_line_items_parent_idx
  on public.receiving_order_line_items (org_id, receiving_order_id, position);
create index if not exists receiving_order_line_items_org_idx
  on public.receiving_order_line_items (org_id);
create index if not exists receiving_order_line_items_item_idx
  on public.receiving_order_line_items (item_id);

alter table public.receiving_order_line_items enable row level security;

drop policy if exists receiving_order_line_items_select on public.receiving_order_line_items;
create policy receiving_order_line_items_select on public.receiving_order_line_items
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists receiving_order_line_items_write on public.receiving_order_line_items;
create policy receiving_order_line_items_write on public.receiving_order_line_items
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  );

-- ---------------------------------------------------------------------------
-- shipment_line_items: normalised line items on a shipment. Shape mirrors
-- receiving_order_line_items. unit_cost_cents on a shipment line carries
-- the issue cost (cost-of-goods snapshot) that the emit_movements trigger
-- records on the outbound stock_movement row.
-- ---------------------------------------------------------------------------

create table if not exists public.shipment_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  item_id uuid not null references public.items(id),
  quantity numeric(18, 4) not null default 0 check (quantity >= 0),
  unit_cost_cents bigint check (unit_cost_cents is null or unit_cost_cents >= 0),
  uom text,
  reference text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists shipment_line_items_parent_idx
  on public.shipment_line_items (org_id, shipment_id, position);
create index if not exists shipment_line_items_org_idx
  on public.shipment_line_items (org_id);
create index if not exists shipment_line_items_item_idx
  on public.shipment_line_items (item_id);

alter table public.shipment_line_items enable row level security;

drop policy if exists shipment_line_items_select on public.shipment_line_items;
create policy shipment_line_items_select on public.shipment_line_items
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists shipment_line_items_write on public.shipment_line_items;
create policy shipment_line_items_write on public.shipment_line_items
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  );

-- ---------------------------------------------------------------------------
-- updated_at stamping triggers. Plain BEFORE UPDATE; no audit. Line items
-- do not participate in an audit-emitting state machine.
-- ---------------------------------------------------------------------------

create or replace function public.trg_receiving_order_line_items_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists receiving_order_line_items_set_updated_at
  on public.receiving_order_line_items;
create trigger receiving_order_line_items_set_updated_at
  before update on public.receiving_order_line_items
  for each row execute function public.trg_receiving_order_line_items_set_updated_at();

create or replace function public.trg_shipment_line_items_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists shipment_line_items_set_updated_at
  on public.shipment_line_items;
create trigger shipment_line_items_set_updated_at
  before update on public.shipment_line_items
  for each row execute function public.trg_shipment_line_items_set_updated_at();

-- ---------------------------------------------------------------------------
-- Backfill: every existing receiving_orders.payload.lines and
-- shipments.payload.lines entry with a non-null item_id becomes a row in
-- the new table. Re-running this migration is safe: the NOT EXISTS guard
-- on the destination skips any parent that already has at least one row
-- in the new table. row_number() over (partition by ... order by line)
-- preserves the JSON array order as the canonical position.
--
-- Lines without item_id (the malformed shape that PR #28 / #42 closed)
-- are skipped here, matching the trigger's skip behaviour.
-- ---------------------------------------------------------------------------

insert into public.receiving_order_line_items (
  org_id, receiving_order_id, item_id, quantity, unit_cost_cents,
  uom, reference, position
)
select
  r.org_id,
  r.id,
  (line ->> 'item_id')::uuid,
  coalesce((line ->> 'quantity')::numeric, 0),
  case when line ? 'unit_cost_cents'
       then nullif(line ->> 'unit_cost_cents', '')::bigint
       else null end,
  nullif(line ->> 'uom', ''),
  nullif(line ->> 'reference', ''),
  (row_number() over (
     partition by r.id
     order by ordinality
   ))::int - 1
from public.receiving_orders r
cross join lateral jsonb_array_elements(
  coalesce(r.payload -> 'lines', '[]'::jsonb)
) with ordinality as t(line, ordinality)
where (line ->> 'item_id') is not null
  and (line ->> 'item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and not exists (
    select 1 from public.receiving_order_line_items existing
    where existing.receiving_order_id = r.id
  );

insert into public.shipment_line_items (
  org_id, shipment_id, item_id, quantity, unit_cost_cents,
  uom, reference, position
)
select
  s.org_id,
  s.id,
  (line ->> 'item_id')::uuid,
  coalesce((line ->> 'quantity')::numeric, 0),
  case when line ? 'unit_cost_cents'
       then nullif(line ->> 'unit_cost_cents', '')::bigint
       else null end,
  nullif(line ->> 'uom', ''),
  nullif(line ->> 'reference', ''),
  (row_number() over (
     partition by s.id
     order by ordinality
   ))::int - 1
from public.shipments s
cross join lateral jsonb_array_elements(
  coalesce(s.payload -> 'lines', '[]'::jsonb)
) with ordinality as t(line, ordinality)
where (line ->> 'item_id') is not null
  and (line ->> 'item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and not exists (
    select 1 from public.shipment_line_items existing
    where existing.shipment_id = s.id
  );

comment on table public.receiving_order_line_items is
  'Normalised receiving order line items. Companion to payload.lines on the parent; dual-written at the handler layer until a future migration drops the JSON mirror per the multi-stage drop rule.';

comment on table public.shipment_line_items is
  'Normalised shipment line items. Companion to payload.lines on the parent; dual-written at the handler layer until a future migration drops the JSON mirror per the multi-stage drop rule.';
