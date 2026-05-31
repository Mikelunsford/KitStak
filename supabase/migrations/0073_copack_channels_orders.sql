-- ============================================================================
-- Migration: 0073_copack_channels_orders.sql
-- Wave: 10
-- Phase: Pillar 3 (Co-Pack and Ecom) foundation, step 1 of 4
-- Closes: prerequisite for 0074 (kitting jobs), 0075 (kitting emit_movements),
--   0076 (fulfillments), plus the copack-api edge bundle, copack capabilities,
--   the Zod canon side-car, and the SPA pillar mirror. Implements sections 3.1,
--   3.2, 3.3, and the channels/orders portion of section 4 of
--   03-workspace/specs/copack-ecom-pillar-spec.md (APPROVED 2026-05-31).
-- Date: 2026-05-31
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop trigger if exists audit_sales_order_line_items on public.sales_order_line_items;
--   drop trigger if exists audit_sales_orders_status on public.sales_orders;
--   drop trigger if exists audit_sales_channels on public.sales_channels;
--   drop trigger if exists sales_order_line_items_set_updated_at on public.sales_order_line_items;
--   drop trigger if exists sales_orders_set_updated_at on public.sales_orders;
--   drop trigger if exists sales_channels_set_updated_at on public.sales_channels;
--   drop function if exists public.trg_audit_sales_order_line_items();
--   drop function if exists public.trg_audit_sales_orders_status();
--   drop function if exists public.trg_audit_sales_channels();
--   drop function if exists public.trg_sales_order_line_items_set_updated_at();
--   drop function if exists public.trg_sales_orders_set_updated_at();
--   drop function if exists public.trg_sales_channels_set_updated_at();
--   drop policy if exists sales_order_line_items_write  on public.sales_order_line_items;
--   drop policy if exists sales_order_line_items_select on public.sales_order_line_items;
--   drop policy if exists sales_orders_write  on public.sales_orders;
--   drop policy if exists sales_orders_select on public.sales_orders;
--   drop policy if exists sales_channels_write  on public.sales_channels;
--   drop policy if exists sales_channels_select on public.sales_channels;
--   drop table if exists public.sales_order_line_items;
--   drop table if exists public.sales_orders;
--   drop table if exists public.sales_channels;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0067 CHECK constraint by hand if needed).
--
-- Constitutional alignment:
--   Money rules        unit_price_cents stored as BIGINT cents with the _cents
--                      suffix. quantity uses numeric(18,4) mirroring the
--                      manufacturing line-item shape from 0052. currency_code
--                      is snapshotted on the order at confirmation by the
--                      handler. No floats anywhere.
--   RLS rules          Pattern A on every new table from creation. org_id is
--                      denormalised onto the child table so RLS evaluates
--                      without a parent join, mirroring 0052 exactly. ON
--                      DELETE CASCADE on the parent FK keeps child rows in
--                      sync on physical delete. Orders and channels write
--                      policy is ('org_owner','org_admin','ops','sales') per
--                      Decision C1; selects are org-scoped only. Cross-tenant
--                      reads return 200 + []; cross-tenant writes hit the same
--                      NOT_FOUND surface as the parent.
--   Audit rules        sales_orders has an auto-state-transition audit trigger
--                      that fires AFTER UPDATE OF status, identical pattern to
--                      trg_audit_manufacturing_runs_status from 0052. The
--                      channel library and the line-item table use the central
--                      audit_append_state_change helper on INSERT / UPDATE /
--                      DELETE with an action verb (created / updated / deleted)
--                      as to_state so the NOT NULL contract on audit_log.to_state
--                      holds.
--   Migration rules    Forward-only. All DDL idempotent. The audit_log
--                      entity_type CHECK extension uses a guarded
--                      DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT pair and
--                      re-adds the full authoritative list (through 0067) plus
--                      the three new channels/orders entity_types.
--   State machine      status text + CHECK constraint, not pg enum. Allowed
--                      transitions enforced by the copack-api handler layer;
--                      the audit trigger fires only when status changes.
--                      Timestamps ordered_at / confirmed_at / shipped_at /
--                      cancelled_at are handler-set.
--   Out of scope       kitting_jobs (0074), the kitting emit_movements trigger
--                      (0075), and fulfillments (0076) are separate files.
--                      No stock_movements writes here. No handler code, no SPA,
--                      no Zod canon, no capabilities side-car in this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include the channels/orders entities.
-- Guarded drop-then-add. Re-adds every value authoritative as of 0067 plus
-- sales_channel, sales_order, sales_order_line_item.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.audit_log'::regclass
       and conname  = 'audit_log_entity_type_check'
  ) then
    alter table public.audit_log
      drop constraint audit_log_entity_type_check;
  end if;
end$$;

alter table public.audit_log
  add constraint audit_log_entity_type_check
  check (entity_type in (
    -- Wave 1 identity
    'organization',
    'org_membership',
    -- Sales / CRM
    'customer',
    'contact',
    'activity',
    'lead',
    'opportunity',
    -- Catalog
    'item',
    -- Sales chassis
    'quote',
    'quote_line_item',
    'project',
    'project_phase',
    'project_line_item',
    -- Billing / GL
    'invoice',
    'invoice_line_item',
    'payment',
    'credit_note',
    'journal_entry',
    'period_close',
    -- Procurement / Ops
    'vendor',
    'purchase_order',
    'po_line_item',
    'vendor_bill',
    'expense',
    'warehouse',
    'stock_movement',
    'receiving_order',
    'production_run',
    'shipment',
    -- Cross-cutting collab
    'attachment',
    'comment',
    'notification',
    -- Pillar 2 Manufacturing
    'manufacturing_run',
    'manufacturing_run_consumed_line_item',
    'manufacturing_run_produced_line_item',
    -- Pillar 3 Co-Pack and Ecom (this migration)
    'sales_channel',
    'sales_order',
    'sales_order_line_item'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Extended in 0073 to add sales_channel, sales_order, sales_order_line_item.';

-- ---------------------------------------------------------------------------
-- sales_channels: per-org registry of where orders come from. Library table,
-- no state machine. Audited on INSERT / UPDATE / DELETE via the central helper.
-- ---------------------------------------------------------------------------

create table if not exists public.sales_channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null default 'manual'
    check (kind in ('manual', 'shopify', 'amazon', 'other')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create index if not exists sales_channels_org_idx
  on public.sales_channels (org_id)
  where deleted_at is null;

create index if not exists sales_channels_org_active_idx
  on public.sales_channels (org_id, is_active)
  where deleted_at is null;

alter table public.sales_channels enable row level security;

drop policy if exists sales_channels_select on public.sales_channels;
create policy sales_channels_select on public.sales_channels
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists sales_channels_write on public.sales_channels;
create policy sales_channels_write on public.sales_channels
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'sales')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'sales')
  );

-- ---------------------------------------------------------------------------
-- sales_orders: parent table for the Co-Pack order flow.
-- State machine: draft -> confirmed -> picking -> packed -> shipped;
-- draft|confirmed|picking|packed -> cancelled; shipped terminal.
-- order_number is org-scoped, nullable, filled by the numbering chassis.
-- ---------------------------------------------------------------------------

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_number text,
  channel_id uuid references public.sales_channels(id),
  customer_id uuid references public.customers(id),
  project_id uuid references public.projects(id),
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'picking', 'packed', 'shipped', 'cancelled')),
  currency_code text,
  ordered_at timestamptz,
  confirmed_at timestamptz,
  shipped_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create unique index if not exists sales_orders_org_order_number_uniq
  on public.sales_orders (org_id, order_number)
  where order_number is not null;

create index if not exists sales_orders_org_idx
  on public.sales_orders (org_id)
  where deleted_at is null;

create index if not exists sales_orders_org_status_idx
  on public.sales_orders (org_id, status)
  where deleted_at is null;

create index if not exists sales_orders_org_channel_idx
  on public.sales_orders (org_id, channel_id)
  where channel_id is not null and deleted_at is null;

create index if not exists sales_orders_org_customer_idx
  on public.sales_orders (org_id, customer_id)
  where customer_id is not null and deleted_at is null;

create index if not exists sales_orders_org_project_idx
  on public.sales_orders (org_id, project_id)
  where project_id is not null and deleted_at is null;

alter table public.sales_orders enable row level security;

drop policy if exists sales_orders_select on public.sales_orders;
create policy sales_orders_select on public.sales_orders
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists sales_orders_write on public.sales_orders;
create policy sales_orders_write on public.sales_orders
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'sales')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'sales')
  );

-- ---------------------------------------------------------------------------
-- sales_order_line_items: what was ordered. Mirrors the consumed line-item
-- shape from 0052 with the parent FK swapped and a price (not cost) column.
-- item_id is REQUIRED: an order line names what was ordered.
-- ---------------------------------------------------------------------------

create table if not exists public.sales_order_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  item_id uuid not null references public.items(id),
  quantity numeric(18, 4) not null default 0 check (quantity >= 0),
  unit_price_cents bigint check (unit_price_cents is null or unit_price_cents >= 0),
  uom text,
  reference text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists sales_order_line_items_parent_idx
  on public.sales_order_line_items (org_id, sales_order_id, position);
create index if not exists sales_order_line_items_org_idx
  on public.sales_order_line_items (org_id);
create index if not exists sales_order_line_items_item_idx
  on public.sales_order_line_items (item_id);

alter table public.sales_order_line_items enable row level security;

drop policy if exists sales_order_line_items_select on public.sales_order_line_items;
create policy sales_order_line_items_select on public.sales_order_line_items
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists sales_order_line_items_write on public.sales_order_line_items;
create policy sales_order_line_items_write on public.sales_order_line_items
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'sales')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'sales')
  );

-- ---------------------------------------------------------------------------
-- updated_at stamping triggers. Plain BEFORE UPDATE; no audit side effect.
-- ---------------------------------------------------------------------------

create or replace function public.trg_sales_channels_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sales_channels_set_updated_at on public.sales_channels;
create trigger sales_channels_set_updated_at
  before update on public.sales_channels
  for each row execute function public.trg_sales_channels_set_updated_at();

create or replace function public.trg_sales_orders_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sales_orders_set_updated_at on public.sales_orders;
create trigger sales_orders_set_updated_at
  before update on public.sales_orders
  for each row execute function public.trg_sales_orders_set_updated_at();

create or replace function public.trg_sales_order_line_items_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sales_order_line_items_set_updated_at
  on public.sales_order_line_items;
create trigger sales_order_line_items_set_updated_at
  before update on public.sales_order_line_items
  for each row execute function public.trg_sales_order_line_items_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: sales_channels library. Fires on INSERT / UPDATE / DELETE
-- via the central audit_append_state_change helper. Action verb in to_state.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_sales_channels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
  v_entity_id uuid;
  v_action text;
  v_to_state text;
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    v_org_id := new.org_id;
    v_entity_id := new.id;
    v_action := 'insert';
    v_to_state := 'created';
    begin
      v_actor := coalesce(auth.uid(), new.created_by);
    exception when others then
      v_actor := new.created_by;
    end;
    v_diff := jsonb_build_object(
      'name', new.name,
      'kind', new.kind,
      'is_active', new.is_active
    );
  elsif tg_op = 'UPDATE' then
    v_org_id := new.org_id;
    v_entity_id := new.id;
    v_action := 'update';
    v_to_state := 'updated';
    begin
      v_actor := coalesce(auth.uid(), new.updated_by);
    exception when others then
      v_actor := new.updated_by;
    end;
    v_diff := jsonb_build_object(
      'name', jsonb_build_object('from', old.name, 'to', new.name),
      'kind', jsonb_build_object('from', old.kind, 'to', new.kind),
      'is_active', jsonb_build_object('from', old.is_active, 'to', new.is_active)
    );
  else -- DELETE
    v_org_id := old.org_id;
    v_entity_id := old.id;
    v_action := 'delete';
    v_to_state := 'deleted';
    begin
      v_actor := coalesce(auth.uid(), old.updated_by);
    exception when others then
      v_actor := old.updated_by;
    end;
    v_diff := jsonb_build_object(
      'name', old.name,
      'kind', old.kind
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'sales_channel',
    v_entity_id,
    null,
    v_to_state,
    v_action,
    v_actor,
    v_diff
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_sales_channels() from public, anon;

drop trigger if exists audit_sales_channels on public.sales_channels;
create trigger audit_sales_channels
  after insert or update or delete on public.sales_channels
  for each row execute function public.trg_audit_sales_channels();

-- ---------------------------------------------------------------------------
-- Audit trigger: sales_orders status transitions. Identical pattern to
-- trg_audit_manufacturing_runs_status from 0052. State-machine entity, so
-- to_state carries the new status string.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_sales_orders_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  select payload_hash into v_prev_hash
    from public.audit_log
   where org_id = new.org_id
   order by triggered_at desc, id desc limit 1;
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'sales_order',
    'entity_id', new.id,
    'from_state', old.status,
    'to_state', new.status,
    'action', 'status_change',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, prev_hash, payload_hash
  ) values (
    new.org_id, 'sales_order', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

revoke execute on function public.trg_audit_sales_orders_status() from public, anon;

drop trigger if exists audit_sales_orders_status on public.sales_orders;
create trigger audit_sales_orders_status
  after update of status on public.sales_orders
  for each row execute function public.trg_audit_sales_orders_status();

-- ---------------------------------------------------------------------------
-- Audit trigger: sales_order_line_items. INSERT / UPDATE / DELETE via the
-- central helper with an action verb as to_state.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_sales_order_line_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
  v_entity_id uuid;
  v_action text;
  v_to_state text;
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    v_org_id := new.org_id;
    v_entity_id := new.id;
    v_action := 'insert';
    v_to_state := 'created';
    begin
      v_actor := coalesce(auth.uid(), new.created_by);
    exception when others then
      v_actor := new.created_by;
    end;
    v_diff := jsonb_build_object(
      'sales_order_id', new.sales_order_id,
      'item_id', new.item_id,
      'quantity', new.quantity,
      'unit_price_cents', new.unit_price_cents,
      'uom', new.uom,
      'reference', new.reference,
      'position', new.position
    );
  elsif tg_op = 'UPDATE' then
    v_org_id := new.org_id;
    v_entity_id := new.id;
    v_action := 'update';
    v_to_state := 'updated';
    begin
      v_actor := coalesce(auth.uid(), new.updated_by);
    exception when others then
      v_actor := new.updated_by;
    end;
    v_diff := jsonb_build_object(
      'sales_order_id', new.sales_order_id,
      'item_id', jsonb_build_object('from', old.item_id, 'to', new.item_id),
      'quantity', jsonb_build_object('from', old.quantity, 'to', new.quantity),
      'unit_price_cents', jsonb_build_object('from', old.unit_price_cents, 'to', new.unit_price_cents),
      'position', jsonb_build_object('from', old.position, 'to', new.position)
    );
  else -- DELETE
    v_org_id := old.org_id;
    v_entity_id := old.id;
    v_action := 'delete';
    v_to_state := 'deleted';
    begin
      v_actor := coalesce(auth.uid(), old.updated_by);
    exception when others then
      v_actor := old.updated_by;
    end;
    v_diff := jsonb_build_object(
      'sales_order_id', old.sales_order_id,
      'item_id', old.item_id,
      'quantity', old.quantity,
      'unit_price_cents', old.unit_price_cents
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'sales_order_line_item',
    v_entity_id,
    null,
    v_to_state,
    v_action,
    v_actor,
    v_diff
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_sales_order_line_items() from public, anon;

drop trigger if exists audit_sales_order_line_items
  on public.sales_order_line_items;
create trigger audit_sales_order_line_items
  after insert or update or delete on public.sales_order_line_items
  for each row execute function public.trg_audit_sales_order_line_items();

-- ---------------------------------------------------------------------------
-- Table comments for operator discoverability.
-- ---------------------------------------------------------------------------

comment on table public.sales_channels is
  'Pillar 3 Co-Pack: per-org registry of order sources (manual, shopify, amazon, other). Library table, no state machine. Pattern A RLS via denormalised org_id.';

comment on table public.sales_orders is
  'Pillar 3 Co-Pack sales order. State machine: draft -> confirmed -> picking -> packed -> shipped; draft|confirmed|picking|packed -> cancelled. order_number filled by the numbering chassis (SO- prefix).';

comment on table public.sales_order_line_items is
  'Lines on a sales_order. item_id REQUIRED (an order line names what was ordered). unit_price_cents is BIGINT cents. Pattern A RLS via denormalised org_id.';
