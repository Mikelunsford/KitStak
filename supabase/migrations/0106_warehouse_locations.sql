-- ============================================================================
-- Migration: 0106_warehouse_locations.sql
-- Wave: 12
-- Phase: WMS Body B, Phase B1 (Locations and bins). The warehouse_locations
--   parent table: bins, shelves, racks, docks, and staging areas inside a
--   warehouse. A config table (no rich FSM); active is a boolean flag, not a
--   registered state machine.
-- Closes: F-Wave12-WMS-B1-01. Implements the B1 DB layer from
--   03-workspace/specs/2026-06-14-wms-bodyb-phase1-handoff.md (section
--   "B1. Locations and bins") and the parent plan
--   03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md
--   (WMS deepens the spine; ADR 0002, add-on six). The caps, byte-mirror types,
--   wms-api routes, and the SPA /wms/locations surface are the B1 app layer.
-- Date: 2026-06-15
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop trigger if exists audit_warehouse_locations on public.warehouse_locations;
--   drop trigger if exists warehouse_locations_set_updated_at on public.warehouse_locations;
--   drop function if exists public.trg_audit_warehouse_locations();
--   drop function if exists public.trg_warehouse_locations_set_updated_at();
--   drop policy if exists warehouse_locations_write  on public.warehouse_locations;
--   drop policy if exists warehouse_locations_select on public.warehouse_locations;
--   drop table if exists public.warehouse_locations;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0102 CHECK constraint by hand if needed).
--
-- Constitutional alignment:
--   RLS rules          Pattern A on creation. org_id is denormalised onto the
--                      row (references organizations ON DELETE CASCADE) so RLS
--                      evaluates without a parent join, mirroring 0089. Selects
--                      are org-scoped only; the write policy is the INVENTORY
--                      3-role set ('org_owner','org_admin','ops'), matching
--                      warehouses (0030). WMS is warehouse execution, not the
--                      3PL commercial layer, so it does NOT carry sales.
--                      Cross-tenant reads return 200 + []; cross-tenant writes
--                      hit the NOT_FOUND surface.
--   Money rules        No money columns. attributes jsonb carries operational
--                      flags (pickable, putaway-eligible, capacity); no _cents.
--   Audit rules        warehouse_locations is a config table (active boolean,
--                      not a registered FSM) so its trigger records the action
--                      verb (created / updated / deleted) as to_state with a
--                      null from_state, via the central audit_append_state_change
--                      helper, identical to the three_pl_accounts pattern (0089).
--                      The audit_log entity_type CHECK is extended via a guarded
--                      drop-then-add that re-adds the full authoritative list
--                      (through 0102) plus warehouse_location. Strict superset;
--                      never a subset of any prior enumeration.
--   Migration rules    Forward-only. All DDL idempotent (IF EXISTS / IF NOT
--                      EXISTS, guarded constraint drop-then-add, CREATE OR
--                      REPLACE). Does not edit any numbered file.
--   State machine      warehouse_locations has no FSM. active is a simple
--                      boolean. The location_type CHECK fixes the kind
--                      (bin / shelf / rack / dock / staging). parent_location_id
--                      is a nullable self-ref (ON DELETE SET NULL), allowing an
--                      arbitrary-depth hierarchy with no enforced depth limit
--                      (handoff decision (a)).
--   Spine references   warehouse_id references warehouses (the spine owns the
--                      warehouse; WMS deepens it to bin level). parent_location_id
--                      self-references warehouse_locations ON DELETE SET NULL
--                      (precedent 0021 chart_of_accounts.parent_account_id).
--   Out of scope       The stock_movements bin dimension and bin_stock_levels
--                      rollup are B2 (the operator stop-point). No caps, no
--                      handler code, no SPA, no Zod canon in this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include warehouse_location. Guarded
-- drop-then-add. Re-adds every value authoritative as of 0102 (the latest
-- carrier, which added billing_review on top of the 0099 list) plus
-- warehouse_location. Strict superset.
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
    'organization', 'org_membership',
    'customer', 'contact', 'activity', 'lead', 'opportunity',
    'item',
    'quote', 'quote_line_item', 'project', 'project_phase', 'project_line_item',
    'invoice', 'invoice_line_item', 'payment', 'credit_note',
    'journal_entry', 'period_close',
    'vendor', 'purchase_order', 'po_line_item', 'vendor_bill', 'expense',
    'warehouse', 'stock_movement', 'receiving_order', 'production_run', 'shipment',
    'attachment', 'comment', 'notification',
    'manufacturing_run',
    'manufacturing_run_consumed_line_item', 'manufacturing_run_produced_line_item',
    'sales_channel', 'sales_order', 'sales_order_line_item',
    'kitting_job', 'kitting_job_consumed_line_item', 'kitting_job_produced_line_item',
    'fulfillment',
    'workforce_member', 'workforce_team', 'workforce_team_member',
    'shift', 'work_assignment', 'time_entry',
    'three_pl_account', 'account_service_definition',
    'job_template', 'job_template_line',
    'supply_plan', 'supply_plan_line',
    'job_run',
    'job_run_daily_log',
    'job_run_daily_log_consumed_line_item', 'job_run_daily_log_produced_line_item',
    'billing_review',
    -- WMS Body B Locations (this migration, 0106)
    'warehouse_location'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Authoritative full list as of 0106, which adds the WMS warehouse_location type on top of the 0102 list. Update via forward migration when a new auditable entity ships, and never subset the prior list.';

-- ---------------------------------------------------------------------------
-- warehouse_locations: a bin / shelf / rack / dock / staging area inside a
-- warehouse. Config table (active flag, not a registered FSM). org_id is
-- denormalised for Pattern A RLS. code is org-and-warehouse-scoped unique.
-- parent_location_id is a nullable self-ref (arbitrary depth, no depth limit,
-- ON DELETE SET NULL). attributes jsonb carries pickable / putaway-eligible /
-- capacity. The B2 stock-movement bin dimension references this table.
-- ---------------------------------------------------------------------------

create table if not exists public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id),
  code text not null,
  location_type text not null
    check (location_type in ('bin', 'shelf', 'rack', 'dock', 'staging')),
  parent_location_id uuid references public.warehouse_locations(id) on delete set null,
  attributes jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

-- code is unique per (org, warehouse) among live rows; a soft-deleted code can
-- be reused.
create unique index if not exists warehouse_locations_org_warehouse_code_uniq
  on public.warehouse_locations (org_id, warehouse_id, code)
  where deleted_at is null;

create index if not exists warehouse_locations_org_idx
  on public.warehouse_locations (org_id)
  where deleted_at is null;

create index if not exists warehouse_locations_org_warehouse_idx
  on public.warehouse_locations (org_id, warehouse_id)
  where deleted_at is null;

create index if not exists warehouse_locations_org_parent_idx
  on public.warehouse_locations (org_id, parent_location_id)
  where deleted_at is null;

alter table public.warehouse_locations enable row level security;

drop policy if exists warehouse_locations_select on public.warehouse_locations;
create policy warehouse_locations_select on public.warehouse_locations
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists warehouse_locations_write on public.warehouse_locations;
create policy warehouse_locations_write on public.warehouse_locations
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
-- updated_at stamping trigger. Plain BEFORE UPDATE; no audit side effect.
-- ---------------------------------------------------------------------------

create or replace function public.trg_warehouse_locations_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists warehouse_locations_set_updated_at on public.warehouse_locations;
create trigger warehouse_locations_set_updated_at
  before update on public.warehouse_locations
  for each row execute function public.trg_warehouse_locations_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: warehouse_locations. Config-table shape (no FSM): the action
-- verb (created / updated / deleted) is the to_state, from_state is null,
-- routed through the central audit_append_state_change helper. Mirrors
-- trg_audit_three_pl_accounts (0089). INSERT / UPDATE / DELETE.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_warehouse_locations()
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
      'warehouse_id', new.warehouse_id,
      'code', new.code,
      'location_type', new.location_type,
      'parent_location_id', new.parent_location_id,
      'active', new.active
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
      'code', jsonb_build_object('from', old.code, 'to', new.code),
      'location_type', jsonb_build_object('from', old.location_type, 'to', new.location_type),
      'parent_location_id', jsonb_build_object('from', old.parent_location_id, 'to', new.parent_location_id),
      'active', jsonb_build_object('from', old.active, 'to', new.active),
      'deleted_at', jsonb_build_object('from', old.deleted_at, 'to', new.deleted_at)
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
      'warehouse_id', old.warehouse_id,
      'code', old.code,
      'location_type', old.location_type,
      'active', old.active
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'warehouse_location',
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

revoke execute on function public.trg_audit_warehouse_locations() from public, anon;

drop trigger if exists audit_warehouse_locations on public.warehouse_locations;
create trigger audit_warehouse_locations
  after insert or update or delete on public.warehouse_locations
  for each row execute function public.trg_audit_warehouse_locations();

-- ---------------------------------------------------------------------------
-- Table comment for operator discoverability.
-- ---------------------------------------------------------------------------

comment on table public.warehouse_locations is
  'WMS Body B Locations (add-on six, warehouse execution; Wave 12 / B1): a bin / shelf / rack / dock / staging area inside a warehouse. Config table (active boolean, not a registered FSM). code is unique per (org, warehouse) among live rows. parent_location_id is a nullable self-ref (arbitrary depth, ON DELETE SET NULL). attributes jsonb carries pickable / putaway-eligible / capacity. Pattern A RLS via denormalised org_id, write gated to the inventory 3-role set (org_owner / org_admin / ops). The B2 stock-movement bin dimension references this table.';
