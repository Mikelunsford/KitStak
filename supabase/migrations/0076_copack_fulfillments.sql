-- ============================================================================
-- Migration: 0076_copack_fulfillments.sql
-- Wave: 10
-- Phase: Pillar 3 (Co-Pack and Ecom) foundation, step 4 of 4
-- Closes: builds on 0073 (orders) and 0074 (kitting). Implements section 3.6
--   of 03-workspace/specs/copack-ecom-pillar-spec.md (APPROVED 2026-05-31).
--   Decision E1: a new dedicated fulfillments table distinct from the existing
--   shipments table (0032), with a nullable shipment_id link to the carrier/
--   label shipment row.
-- Date: 2026-05-31
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop trigger if exists fulfillments_advance_order on public.fulfillments;
--   drop trigger if exists audit_fulfillments_status on public.fulfillments;
--   drop trigger if exists fulfillments_set_updated_at on public.fulfillments;
--   drop function if exists public.tg_fulfillments_advance_order();
--   drop function if exists public.trg_audit_fulfillments_status();
--   drop function if exists public.trg_fulfillments_set_updated_at();
--   drop policy if exists fulfillments_write  on public.fulfillments;
--   drop policy if exists fulfillments_select on public.fulfillments;
--   drop table if exists public.fulfillments;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0074 CHECK constraint by hand if needed).
--
-- Constitutional alignment:
--   RLS rules          Pattern A from creation. org_id denormalised. Fulfillment
--                      write policy is ('org_owner','org_admin','ops') per
--                      Decision C1.
--   Audit rules        fulfillments has the AFTER UPDATE OF status audit trigger
--                      (manufacturing pattern). The cross-entity advancement of
--                      the parent sales_order to shipped is implemented as a
--                      deterministic DB trigger (no best-effort handler write);
--                      that order transition is itself captured by the
--                      sales_orders status audit trigger from 0073.
--   Migration rules    Forward-only. All DDL idempotent. The audit_log CHECK
--                      extension re-adds the full list authoritative as of 0074
--                      plus the new fulfillment entity_type.
--   State machine      status text + CHECK. pending -> picking -> packed ->
--                      shipped; pending|picking|packed -> cancelled; shipped
--                      terminal. Transition legality enforced by the copack-api
--                      handler; the audit trigger fires only when status changes.
--   Out of scope       No carrier rate shopping, no label purchase. shipment_id
--                      is a nullable link to the existing shipments row; this
--                      migration does not modify shipments.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include the fulfillment entity.
-- Guarded drop-then-add. Re-adds the full list (through 0074) plus fulfillment.
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
    -- Pillar 3 Co-Pack and Ecom (channels/orders, 0073)
    'sales_channel',
    'sales_order',
    'sales_order_line_item',
    -- Pillar 3 Co-Pack and Ecom (kitting, 0074)
    'kitting_job',
    'kitting_job_consumed_line_item',
    'kitting_job_produced_line_item',
    -- Pillar 3 Co-Pack and Ecom (fulfillment, this migration)
    'fulfillment'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Extended in 0076 to add fulfillment.';

-- ---------------------------------------------------------------------------
-- fulfillments: the pick/pack/ship record for a sales order. Distinct from
-- shipments (0032), which remains the carrier/label row and is linked via
-- shipment_id. State machine: pending -> picking -> packed -> shipped;
-- pending|picking|packed -> cancelled; shipped terminal.
-- fulfillment_number is org-scoped, nullable, filled by the numbering chassis (FUL-).
-- ---------------------------------------------------------------------------

create table if not exists public.fulfillments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  fulfillment_number text,
  sales_order_id uuid not null references public.sales_orders(id),
  warehouse_id uuid references public.warehouses(id),
  shipment_id uuid references public.shipments(id),
  status text not null default 'pending'
    check (status in ('pending', 'picking', 'packed', 'shipped', 'cancelled')),
  picked_at timestamptz,
  packed_at timestamptz,
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

create unique index if not exists fulfillments_org_number_uniq
  on public.fulfillments (org_id, fulfillment_number)
  where fulfillment_number is not null;

create index if not exists fulfillments_org_idx
  on public.fulfillments (org_id)
  where deleted_at is null;

create index if not exists fulfillments_org_status_idx
  on public.fulfillments (org_id, status)
  where deleted_at is null;

create index if not exists fulfillments_org_order_idx
  on public.fulfillments (org_id, sales_order_id)
  where deleted_at is null;

create index if not exists fulfillments_org_warehouse_idx
  on public.fulfillments (org_id, warehouse_id)
  where warehouse_id is not null and deleted_at is null;

create index if not exists fulfillments_org_shipment_idx
  on public.fulfillments (org_id, shipment_id)
  where shipment_id is not null and deleted_at is null;

alter table public.fulfillments enable row level security;

drop policy if exists fulfillments_select on public.fulfillments;
create policy fulfillments_select on public.fulfillments
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists fulfillments_write on public.fulfillments;
create policy fulfillments_write on public.fulfillments
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
-- updated_at stamping trigger.
-- ---------------------------------------------------------------------------

create or replace function public.trg_fulfillments_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists fulfillments_set_updated_at on public.fulfillments;
create trigger fulfillments_set_updated_at
  before update on public.fulfillments
  for each row execute function public.trg_fulfillments_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: fulfillments status transitions. Manufacturing pattern.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_fulfillments_status()
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
    'entity_type', 'fulfillment',
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
    new.org_id, 'fulfillment', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

revoke execute on function public.trg_audit_fulfillments_status() from public, anon;

drop trigger if exists audit_fulfillments_status on public.fulfillments;
create trigger audit_fulfillments_status
  after update of status on public.fulfillments
  for each row execute function public.trg_audit_fulfillments_status();

-- ---------------------------------------------------------------------------
-- Cross-entity trigger: a fulfillment reaching `shipped` advances its parent
-- sales_order to `shipped` (spec 3.6). Deterministic DB trigger, not a
-- best-effort handler write. Guarded so it only advances an order that is in
-- an active, non-terminal state (confirmed / picking / packed). The order
-- transition fires the sales_orders status audit trigger from 0073, so the
-- advancement is captured on the hash chain. Fires AFTER the audit trigger
-- on fulfillments (alphabetical trigger order: audit_ before fulfillments_).
-- ---------------------------------------------------------------------------

create or replace function public.tg_fulfillments_advance_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is null
     or new.status = old.status
     or new.status <> 'shipped' then
    return new;
  end if;

  update public.sales_orders
     set status = 'shipped',
         shipped_at = coalesce(new.shipped_at, now()),
         updated_by = new.updated_by
   where id = new.sales_order_id
     and org_id = new.org_id
     and status in ('confirmed', 'picking', 'packed');

  return new;
end;
$$;

revoke execute on function public.tg_fulfillments_advance_order() from public, anon;

drop trigger if exists fulfillments_advance_order on public.fulfillments;
create trigger fulfillments_advance_order
  after update of status on public.fulfillments
  for each row execute function public.tg_fulfillments_advance_order();

-- ---------------------------------------------------------------------------
-- Table comment for operator discoverability.
-- ---------------------------------------------------------------------------

comment on table public.fulfillments is
  'Pillar 3 Co-Pack pick/pack/ship record for a sales_order. Distinct from shipments (0032), linked via nullable shipment_id (Decision E1, 2026-05-31). State machine: pending -> picking -> packed -> shipped; pending|picking|packed -> cancelled. Reaching shipped advances the parent order to shipped. fulfillment_number filled by the numbering chassis (FUL- prefix).';
