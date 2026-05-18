-- ============================================================================
-- Migration: 0026_vendors_purchase_orders.sql
-- Wave: 2
-- Phase: Vendors, POs (Agent E)
-- Closes: R-W2-VENDORS-02
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. drop triggers, then drop table po_line_items,
--   then drop table purchase_orders. Not auto-run.
--
-- Constitutional alignment:
--   RLS rules         purchase_orders Pattern A; po_line_items Pattern B.
--   Money rules       BIGINT cents on every monetary column with _cents suffix.
--                     subtotal/tax/total recomputed by trigger from line items.
--   Migration rules   Forward-only. All DDL idempotent. State machine is a
--                     text CHECK, not a pg enum.
--   Audit rules       purchase_orders.status writes audit_log via trigger.
-- ============================================================================

create table if not exists public.purchase_orders (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  po_number text,
  vendor_id uuid not null references public.vendors(id),
  warehouse_id uuid,
  status text not null default 'draft'
    check (status in (
      'draft', 'submitted', 'approved',
      'partial_received', 'received', 'closed', 'cancelled'
    )),
  currency_code text not null default 'USD',
  order_date date not null default current_date,
  expected_date date,
  received_date date,
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  shipping_cents bigint not null default 0,
  total_cents bigint not null default 0,
  notes text,
  reference text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, po_number)
);

create index if not exists purchase_orders_org_idx
  on public.purchase_orders (org_id)
  where deleted_at is null;

create index if not exists purchase_orders_org_status_idx
  on public.purchase_orders (org_id, status)
  where deleted_at is null;

create index if not exists purchase_orders_vendor_idx
  on public.purchase_orders (vendor_id)
  where deleted_at is null;

alter table public.purchase_orders enable row level security;

drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists purchase_orders_write on public.purchase_orders;
create policy purchase_orders_write on public.purchase_orders
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'accounting')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'accounting')
  );

-- ---------------------------------------------------------------------------
-- po_line_items: child rows, Pattern B (parent-join scope).
-- ---------------------------------------------------------------------------

create table if not exists public.po_line_items (
  id uuid primary key default uuid_generate_v4(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid,
  description text not null,
  quantity_ordered numeric(18,4) not null default 0,
  quantity_received numeric(18,4) not null default 0,
  unit_price_cents bigint not null default 0,
  tax_rate_bps integer not null default 0,
  line_subtotal_cents bigint not null default 0,
  line_tax_cents bigint not null default 0,
  line_total_cents bigint not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists po_line_items_po_idx
  on public.po_line_items (purchase_order_id);

alter table public.po_line_items enable row level security;

drop policy if exists po_line_items_select on public.po_line_items;
create policy po_line_items_select on public.po_line_items
  for select to authenticated
  using (
    exists (
      select 1 from public.purchase_orders po
       where po.id = po_line_items.purchase_order_id
         and po.org_id = public.current_org_id()
    )
  );

drop policy if exists po_line_items_write on public.po_line_items;
create policy po_line_items_write on public.po_line_items
  for all to authenticated
  using (
    exists (
      select 1 from public.purchase_orders po
       where po.id = po_line_items.purchase_order_id
         and po.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'accounting')
    )
  )
  with check (
    exists (
      select 1 from public.purchase_orders po
       where po.id = po_line_items.purchase_order_id
         and po.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'accounting')
    )
  );

-- ---------------------------------------------------------------------------
-- recompute_purchase_order_totals: sum line items into the parent PO.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_purchase_order_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po_id uuid;
  v_subtotal bigint;
  v_tax bigint;
  v_total bigint;
  v_shipping bigint;
begin
  v_po_id := coalesce(new.purchase_order_id, old.purchase_order_id);
  if v_po_id is null then
    return coalesce(new, old);
  end if;

  select
    coalesce(sum(line_subtotal_cents), 0),
    coalesce(sum(line_tax_cents), 0),
    coalesce(sum(line_total_cents), 0)
  into v_subtotal, v_tax, v_total
  from public.po_line_items
  where purchase_order_id = v_po_id;

  select shipping_cents into v_shipping
    from public.purchase_orders where id = v_po_id;

  update public.purchase_orders
    set subtotal_cents = v_subtotal,
        tax_cents      = v_tax,
        total_cents    = v_total + coalesce(v_shipping, 0),
        updated_at     = now()
  where id = v_po_id;

  return coalesce(new, old);
end;
$$;

revoke execute on function public.recompute_purchase_order_totals() from public, anon;

drop trigger if exists recompute_po_totals_aiud on public.po_line_items;
create trigger recompute_po_totals_aiud
  after insert or update or delete on public.po_line_items
  for each row execute function public.recompute_purchase_order_totals();

-- ---------------------------------------------------------------------------
-- Audit state-change trigger for purchase_orders.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_purchase_orders_status()
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
   order by triggered_at desc, id desc
   limit 1;

  v_payload := jsonb_build_object(
    'org_id',       new.org_id,
    'entity_type',  'purchase_order',
    'entity_id',    new.id,
    'from_state',   old.status,
    'to_state',     new.status,
    'action',       'status_change',
    'triggered_by', v_triggered_by,
    'diff_json',    jsonb_build_object(
                       'status', jsonb_build_object('from', old.status, 'to', new.status)
                    ),
    'prev_hash',    v_prev_hash
  );

  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'),
    'hex'
  );

  insert into public.audit_log (
    org_id, entity_type, entity_id,
    from_state, to_state, action,
    triggered_by, diff_json,
    prev_hash, payload_hash
  ) values (
    new.org_id, 'purchase_order', new.id,
    old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );

  return new;
end;
$$;

revoke execute on function public.trg_audit_purchase_orders_status() from public, anon;

drop trigger if exists audit_purchase_orders_status on public.purchase_orders;
create trigger audit_purchase_orders_status
  after update of status on public.purchase_orders
  for each row execute function public.trg_audit_purchase_orders_status();
