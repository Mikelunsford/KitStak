-- ============================================================================
-- Migration: 0096_supply_plans.sql
-- Wave: 12
-- Phase: 3PL commercial pivot, Phase A5 (Supply Plan), step 2 of 3 (tables and
--   reservation RPCs).
-- Closes: the Supply Plan engine from
--   03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md
--   (section 6.1: supply_plans parent Pattern A, supply_plan_lines child;
--   "On release (D6), compute shortages and create reservations for available
--   stock"; "the reserve action writes a reserved stock_movement so the spine
--   quantity_reserved reflects it"). Builds on the 0095 ledger reserve
--   activation. Two tables plus two SECURITY DEFINER RPCs (release, cancel).
-- Date: 2026-06-13
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop function if exists public.cancel_supply_plan(uuid, uuid, uuid);
--   drop function if exists public.release_supply_plan(uuid, uuid, uuid);
--   drop trigger if exists audit_supply_plan_lines on public.supply_plan_lines;
--   drop trigger if exists audit_supply_plans on public.supply_plans;
--   drop trigger if exists supply_plan_lines_set_updated_at on public.supply_plan_lines;
--   drop trigger if exists supply_plans_set_updated_at on public.supply_plans;
--   drop function if exists public.trg_audit_supply_plan_lines();
--   drop function if exists public.trg_audit_supply_plans();
--   drop function if exists public.trg_supply_plan_lines_set_updated_at();
--   drop function if exists public.trg_supply_plans_set_updated_at();
--   drop policy if exists supply_plan_lines_write  on public.supply_plan_lines;
--   drop policy if exists supply_plan_lines_select on public.supply_plan_lines;
--   drop policy if exists supply_plans_write  on public.supply_plans;
--   drop policy if exists supply_plans_select on public.supply_plans;
--   drop table if exists public.supply_plan_lines;
--   drop table if exists public.supply_plans;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0091 CHECK by hand if needed).
--
-- Constitutional alignment:
--   Money rules        No _cents column. Quantities are numeric(18,4) per the
--                      stock chassis (0030). No monetary math; the reserve RPC
--                      moves quantity, not cost.
--   RLS rules          Pattern A on both tables from creation. org_id is
--                      denormalised onto the child so RLS evaluates without a
--                      parent join, mirroring 0091. ON DELETE CASCADE on the
--                      parent FK. Write gated to the 3PL commercial layer roles
--                      ('org_owner','org_admin','ops','sales'), matching the
--                      accounts and job_template surfaces. Cross-tenant reads
--                      return 200 + []; the RPCs surface cross-tenant as
--                      NOT_FOUND (never 403).
--   Audit rules        supply_plans is a rich FSM (draft / released / fulfilled /
--                      cancelled) so its trigger records from_state -> to_state on
--                      every status change plus created / deleted, via the central
--                      audit_append_state_change helper. supply_plan_lines uses
--                      the created / updated / deleted action-verb pattern from
--                      0091. The audit_log entity_type CHECK is extended via a
--                      guarded drop-then-add that re-adds the full 0091 list plus
--                      supply_plan and supply_plan_line. Strict superset.
--   Migration rules    Forward-only. All DDL idempotent (IF EXISTS / IF NOT
--                      EXISTS, guarded constraint drop-then-add, CREATE OR
--                      REPLACE). Does not edit 0091.
--   State machine       supply_plans.status text + CHECK. Transitions are driven
--                      by the release / cancel RPCs (and a handler-set fulfilled).
--                      Paired <state>_at timestamps.
--   Reservation         release writes 'reserve' movements (0095) for the
--                      reservable portion of each reserve-resolution line; cancel
--                      of a released plan writes 'reserve_release' to undo the
--                      holds. The spine quantity_reserved (and the generated
--                      quantity_available) auto-derive via the 0095 recompute. The
--                      RPCs never write stock_levels directly.
--   Spine references    project_id -> projects (the demand source, ON DELETE SET
--                      NULL); warehouse_id -> warehouses (reservations are per
--                      warehouse, like manufacturing_runs); supply_plan_lines
--                      .item_id -> items; resolved_po_id -> purchase_orders and
--                      resolved_receiving_order_id -> receiving_orders are the
--                      nullable manual shortage links (no auto-created orders).
--   Out of scope        job_run_id (A6 job_runs has no table yet) is a later
--                      forward column. SUP- numbering is 0097. Caps, three-pl-api
--                      routes, byte-mirror types, and the SPA are the A5 app
--                      layer (next slice).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include the Supply Plan entities.
-- Guarded drop-then-add. Re-adds every value authoritative as of 0091 plus
-- supply_plan, supply_plan_line. Strict superset.
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
    -- 3PL commercial layer Supply Plan (this migration, 0096)
    'supply_plan', 'supply_plan_line'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Authoritative full list as of 0096, which adds supply_plan and supply_plan_line on top of the 0091 list. Update via forward migration; never subset.';

-- ---------------------------------------------------------------------------
-- supply_plans: shortage-resolution header. Pattern A. plan_number SUP- (0097).
-- References the demand project and the warehouse reservations draw from. Rich
-- FSM draft / released / fulfilled / cancelled with paired timestamps.
-- ---------------------------------------------------------------------------

create table if not exists public.supply_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  plan_number text,
  project_id uuid references public.projects(id) on delete set null,
  warehouse_id uuid references public.warehouses(id),
  status text not null default 'draft'
    check (status in ('draft', 'released', 'fulfilled', 'cancelled')),
  released_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create unique index if not exists supply_plans_org_plan_number_uniq
  on public.supply_plans (org_id, plan_number)
  where plan_number is not null;
create index if not exists supply_plans_org_idx
  on public.supply_plans (org_id) where deleted_at is null;
create index if not exists supply_plans_org_status_idx
  on public.supply_plans (org_id, status) where deleted_at is null;
create index if not exists supply_plans_project_idx
  on public.supply_plans (project_id) where project_id is not null;
create index if not exists supply_plans_warehouse_idx
  on public.supply_plans (warehouse_id) where warehouse_id is not null;

alter table public.supply_plans enable row level security;

drop policy if exists supply_plans_select on public.supply_plans;
create policy supply_plans_select on public.supply_plans
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists supply_plans_write on public.supply_plans;
create policy supply_plans_write on public.supply_plans
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
-- supply_plan_lines: per-item demand resolution. Child of supply_plans,
-- denormalised org_id for Pattern A RLS. required / available / reserved /
-- shortage quantities are numeric(18,4). resolution partitions how the operator
-- covers the line; reserve is the active path. resolved_po_id and
-- resolved_receiving_order_id are nullable manual links (no auto-created orders).
-- ---------------------------------------------------------------------------

create table if not exists public.supply_plan_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  supply_plan_id uuid not null references public.supply_plans(id) on delete cascade,
  item_id uuid not null references public.items(id),
  required_qty numeric(18,4) not null default 0 check (required_qty >= 0),
  available_qty numeric(18,4) not null default 0,
  reserved_qty numeric(18,4) not null default 0 check (reserved_qty >= 0),
  shortage_qty numeric(18,4) not null default 0 check (shortage_qty >= 0),
  resolution text not null default 'reserve'
    check (resolution in ('reserve', 'inbound', 'purchase', 'replenish')),
  resolved_po_id uuid references public.purchase_orders(id) on delete set null,
  resolved_receiving_order_id uuid references public.receiving_orders(id) on delete set null,
  notes text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists supply_plan_lines_parent_idx
  on public.supply_plan_lines (org_id, supply_plan_id, position);
create index if not exists supply_plan_lines_org_idx
  on public.supply_plan_lines (org_id);
create index if not exists supply_plan_lines_item_idx
  on public.supply_plan_lines (item_id);

alter table public.supply_plan_lines enable row level security;

drop policy if exists supply_plan_lines_select on public.supply_plan_lines;
create policy supply_plan_lines_select on public.supply_plan_lines
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists supply_plan_lines_write on public.supply_plan_lines;
create policy supply_plan_lines_write on public.supply_plan_lines
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

create or replace function public.trg_supply_plans_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists supply_plans_set_updated_at on public.supply_plans;
create trigger supply_plans_set_updated_at
  before update on public.supply_plans
  for each row execute function public.trg_supply_plans_set_updated_at();

create or replace function public.trg_supply_plan_lines_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists supply_plan_lines_set_updated_at on public.supply_plan_lines;
create trigger supply_plan_lines_set_updated_at
  before update on public.supply_plan_lines
  for each row execute function public.trg_supply_plan_lines_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: supply_plans. Rich FSM, so to_state carries the status and
-- from_state carries the prior status on transitions. INSERT records created;
-- DELETE records deleted.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_supply_plans()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
  v_entity_id uuid;
  v_from text;
  v_to text;
  v_action text;
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    v_org_id := new.org_id; v_entity_id := new.id;
    v_from := null; v_to := new.status; v_action := 'insert';
    begin v_actor := coalesce(auth.uid(), new.created_by);
    exception when others then v_actor := new.created_by; end;
    v_diff := jsonb_build_object('status', new.status, 'project_id', new.project_id);
  elsif tg_op = 'UPDATE' then
    v_org_id := new.org_id; v_entity_id := new.id;
    v_from := old.status; v_to := new.status; v_action := 'update';
    begin v_actor := coalesce(auth.uid(), new.updated_by);
    exception when others then v_actor := new.updated_by; end;
    v_diff := jsonb_build_object(
      'status', jsonb_build_object('from', old.status, 'to', new.status));
  else
    v_org_id := old.org_id; v_entity_id := old.id;
    v_from := old.status; v_to := 'deleted'; v_action := 'delete';
    begin v_actor := coalesce(auth.uid(), old.updated_by);
    exception when others then v_actor := old.updated_by; end;
    v_diff := jsonb_build_object('status', old.status);
  end if;

  perform public.audit_append_state_change(
    v_org_id, 'supply_plan', v_entity_id, v_from, v_to, v_action, v_actor, v_diff);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_supply_plans() from public, anon;

drop trigger if exists audit_supply_plans on public.supply_plans;
create trigger audit_supply_plans
  after insert or update or delete on public.supply_plans
  for each row execute function public.trg_audit_supply_plans();

-- ---------------------------------------------------------------------------
-- Audit trigger: supply_plan_lines. created / updated / deleted action verbs
-- in to_state, mirroring 0091 job_template_lines.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_supply_plan_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
  v_entity_id uuid;
  v_to text;
  v_action text;
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    v_org_id := new.org_id; v_entity_id := new.id; v_to := 'created'; v_action := 'insert';
    begin v_actor := coalesce(auth.uid(), new.created_by);
    exception when others then v_actor := new.created_by; end;
    v_diff := jsonb_build_object(
      'supply_plan_id', new.supply_plan_id, 'item_id', new.item_id,
      'required_qty', new.required_qty, 'resolution', new.resolution);
  elsif tg_op = 'UPDATE' then
    v_org_id := new.org_id; v_entity_id := new.id; v_to := 'updated'; v_action := 'update';
    begin v_actor := coalesce(auth.uid(), new.updated_by);
    exception when others then v_actor := new.updated_by; end;
    v_diff := jsonb_build_object(
      'required_qty', jsonb_build_object('from', old.required_qty, 'to', new.required_qty),
      'reserved_qty', jsonb_build_object('from', old.reserved_qty, 'to', new.reserved_qty),
      'shortage_qty', jsonb_build_object('from', old.shortage_qty, 'to', new.shortage_qty),
      'resolution', jsonb_build_object('from', old.resolution, 'to', new.resolution));
  else
    v_org_id := old.org_id; v_entity_id := old.id; v_to := 'deleted'; v_action := 'delete';
    begin v_actor := coalesce(auth.uid(), old.updated_by);
    exception when others then v_actor := old.updated_by; end;
    v_diff := jsonb_build_object('supply_plan_id', old.supply_plan_id, 'item_id', old.item_id);
  end if;

  perform public.audit_append_state_change(
    v_org_id, 'supply_plan_line', v_entity_id, null, v_to, v_action, v_actor, v_diff);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_supply_plan_lines() from public, anon;

drop trigger if exists audit_supply_plan_lines on public.supply_plan_lines;
create trigger audit_supply_plan_lines
  after insert or update or delete on public.supply_plan_lines
  for each row execute function public.trg_audit_supply_plan_lines();

-- ---------------------------------------------------------------------------
-- release_supply_plan: draft -> released. For each line, snapshot available
-- stock for (warehouse, item) from stock_levels; for reserve-resolution lines,
-- reserve min(required, available) by writing a 'reserve' movement (0095) so the
-- spine quantity_reserved reflects the hold. Records available / reserved /
-- shortage on every line. Non-reserve resolutions snapshot available + shortage
-- but reserve nothing (the operator covers them via the linked PO / inbound).
-- 3-arg cross-tenant pattern: reads the plan's org from the row, NOT_FOUND on a
-- cross-tenant or missing plan (never 403). Idempotent on an already-released
-- plan.
-- ---------------------------------------------------------------------------

create or replace function public.release_supply_plan(
  p_plan_id uuid,
  p_actor uuid,
  p_caller_org_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status text;
  v_warehouse_id uuid;
  v_line record;
  v_available numeric(18,4);
  v_reservable numeric(18,4);
begin
  select org_id, status, warehouse_id
    into v_org_id, v_status, v_warehouse_id
    from public.supply_plans
   where id = p_plan_id;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: supply plan not found' using errcode = 'P0001';
  end if;

  if v_status = 'released' then
    return p_plan_id; -- idempotent
  end if;
  if v_status <> 'draft' then
    raise exception 'STATE_CONFLICT: supply plan not in draft state (was %)', v_status
      using errcode = 'P0001';
  end if;

  -- Resolve the warehouse: the plan's, else the org default. Reservations are
  -- per warehouse, so one is required.
  if v_warehouse_id is null then
    select id into v_warehouse_id
      from public.warehouses
     where org_id = v_org_id and is_default = true and deleted_at is null
     limit 1;
  end if;
  if v_warehouse_id is null then
    raise exception 'VALIDATION_ERROR: no warehouse set on the plan and no default warehouse'
      using errcode = '22023';
  end if;

  for v_line in
    select id, item_id, required_qty, resolution
      from public.supply_plan_lines
     where supply_plan_id = p_plan_id
     order by position, id
  loop
    select coalesce(quantity_available, 0)
      into v_available
      from public.stock_levels
     where warehouse_id = v_warehouse_id and item_id = v_line.item_id;
    v_available := coalesce(v_available, 0);

    if v_line.resolution = 'reserve' then
      v_reservable := least(v_line.required_qty, greatest(v_available, 0));
    else
      v_reservable := 0;
    end if;

    update public.supply_plan_lines
       set available_qty = v_available,
           reserved_qty  = v_reservable,
           shortage_qty  = greatest(v_line.required_qty - v_reservable, 0),
           updated_by    = p_actor
     where id = v_line.id;

    if v_reservable > 0 then
      insert into public.stock_movements (
        org_id, warehouse_id, item_id, movement_type, quantity,
        source_entity_type, source_entity_id, created_by
      ) values (
        v_org_id, v_warehouse_id, v_line.item_id, 'reserve', v_reservable,
        'supply_plan', p_plan_id, p_actor
      );
    end if;
  end loop;

  update public.supply_plans
     set status = 'released',
         released_at = now(),
         warehouse_id = v_warehouse_id,
         updated_by = p_actor
   where id = p_plan_id;

  return p_plan_id;
end;
$$;

revoke execute on function public.release_supply_plan(uuid, uuid, uuid) from public, anon;
grant execute on function public.release_supply_plan(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.release_supply_plan(uuid, uuid, uuid) is
  'Releases a draft Supply Plan (Wave 12 / A5): snapshots available stock per line and reserves min(required, available) for reserve-resolution lines by writing 0095 reserve movements so the spine quantity_reserved reflects the hold. 3-arg cross-tenant guard (NOT_FOUND). Idempotent on an already-released plan.';

-- ---------------------------------------------------------------------------
-- cancel_supply_plan: -> cancelled. If the plan was released, write a
-- 'reserve_release' movement (0095) for each line that holds a reservation so
-- the spine quantity_reserved is restored, and zero the line reserved_qty. Same
-- 3-arg cross-tenant guard. Idempotent on an already-cancelled plan.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_supply_plan(
  p_plan_id uuid,
  p_actor uuid,
  p_caller_org_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status text;
  v_warehouse_id uuid;
  v_line record;
begin
  select org_id, status, warehouse_id
    into v_org_id, v_status, v_warehouse_id
    from public.supply_plans
   where id = p_plan_id;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: supply plan not found' using errcode = 'P0001';
  end if;

  if v_status = 'cancelled' then
    return p_plan_id; -- idempotent
  end if;

  if v_status = 'released' and v_warehouse_id is not null then
    for v_line in
      select id, item_id, reserved_qty
        from public.supply_plan_lines
       where supply_plan_id = p_plan_id and reserved_qty > 0
    loop
      insert into public.stock_movements (
        org_id, warehouse_id, item_id, movement_type, quantity,
        source_entity_type, source_entity_id, created_by
      ) values (
        v_org_id, v_warehouse_id, v_line.item_id, 'reserve_release', v_line.reserved_qty,
        'supply_plan', p_plan_id, p_actor
      );

      update public.supply_plan_lines
         set reserved_qty = 0,
             shortage_qty = required_qty,
             updated_by = p_actor
       where id = v_line.id;
    end loop;
  end if;

  update public.supply_plans
     set status = 'cancelled',
         cancelled_at = now(),
         updated_by = p_actor
   where id = p_plan_id;

  return p_plan_id;
end;
$$;

revoke execute on function public.cancel_supply_plan(uuid, uuid, uuid) from public, anon;
grant execute on function public.cancel_supply_plan(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.cancel_supply_plan(uuid, uuid, uuid) is
  'Cancels a Supply Plan (Wave 12 / A5): if it was released, writes 0095 reserve_release movements to restore the spine quantity_reserved and zeroes each line reserved_qty. 3-arg cross-tenant guard (NOT_FOUND). Idempotent on an already-cancelled plan.';

-- ---------------------------------------------------------------------------
-- Table comments.
-- ---------------------------------------------------------------------------

comment on table public.supply_plans is
  '3PL Supply Plan header (Wave 12 / A5): shortage resolution for a project, not auto-created receiving orders. FSM draft / released / fulfilled / cancelled. warehouse_id is where reservations draw from (defaults to the org default at release). plan_number SUP- (0097). Pattern A RLS.';
comment on table public.supply_plan_lines is
  'Per-item demand line of a supply_plan (Wave 12 / A5). required / available / reserved / shortage quantities; resolution in reserve / inbound / purchase / replenish. resolved_po_id and resolved_receiving_order_id are the nullable manual shortage links. Child of supply_plans, denormalised org_id for Pattern A RLS.';
