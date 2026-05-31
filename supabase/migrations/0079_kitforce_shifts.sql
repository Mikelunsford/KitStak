-- ============================================================================
-- Migration: 0079_kitforce_shifts.sql
-- Wave: 11
-- Phase: Pillar 4 (KitForce) foundation, step 2 of 5
-- Closes: prerequisite for 0080 (work assignments), 0081 (time entries),
--   0082 (numbering), the kitforce-api edge bundle, kitforce capabilities,
--   the Zod canon side-car, and the SPA pillar mirror. Implements section 3.4
--   and the shift portion of section 4 of
--   03-workspace/specs/kitforce-pillar-spec.md (APPROVED 2026-05-31).
-- Date: 2026-05-31
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop trigger if exists audit_shifts_status on public.shifts;
--   drop trigger if exists shifts_set_updated_at on public.shifts;
--   drop function if exists public.trg_audit_shifts_status();
--   drop function if exists public.trg_shifts_set_updated_at();
--   drop policy if exists shifts_write  on public.shifts;
--   drop policy if exists shifts_select on public.shifts;
--   drop table if exists public.shifts;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0078 CHECK constraint by hand if needed).
--
-- Constitutional alignment:
--   Money rules        No money columns. Quantities and durations on shifts are
--                      timestamptz (scheduled_start_at / scheduled_end_at,
--                      handler-set timestamp columns). No floats anywhere.
--   RLS rules          Pattern A on every new table from creation. org_id is
--                      denormalised for RLS without a parent join. Write policy
--                      role set is ('org_owner','org_admin','ops') per spec
--                      section 5, matching the workforce_members convention from
--                      0078. Cross-tenant reads return 200 + []; cross-tenant
--                      writes hit the NOT_FOUND surface.
--   Audit rules        shifts has an auto-state-transition audit trigger that
--                      fires AFTER UPDATE OF status, identical pattern to
--                      trg_audit_manufacturing_runs_status from 0052 (SECURITY
--                      DEFINER, per-org advisory lock, hash chain via prev_hash,
--                      inline audit_log INSERT). to_state carries the new status
--                      string.
--   Migration rules    Forward-only. All DDL idempotent. The audit_log
--                      entity_type CHECK extension uses a guarded DROP
--                      CONSTRAINT IF EXISTS / ADD CONSTRAINT pair and re-adds
--                      the full authoritative list (through 0078) plus shift.
--   State machine      scheduled -> started -> completed; scheduled|started ->
--                      cancelled; completed terminal. Status text + CHECK
--                      constraint, not pg enum. Transition enforcement is the
--                      kitforce-api handler layer responsibility.
--   Out of scope       SHF- numbering prefix is seeded in 0082. work_assignments
--                      (0080), time_entries (0081), and numbering (0082) are
--                      separate files. No handler code, no SPA, no Zod canon,
--                      no capabilities side-car in this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include the shift entity type.
-- Guarded drop-then-add. Re-adds every value authoritative as of 0078 plus
-- shift.
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
    -- Pillar 3 Co-Pack and Ecom
    'sales_channel',
    'sales_order',
    'sales_order_line_item',
    -- Pillar 4 KitForce workforce (0078)
    'workforce_member',
    'workforce_team',
    'workforce_team_member',
    -- Pillar 4 KitForce shifts (this migration)
    'shift'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Extended in 0079 to add shift.';

-- ---------------------------------------------------------------------------
-- shifts: rostered blocks of time a member is scheduled to work.
-- State machine: scheduled -> started -> completed; scheduled|started ->
-- cancelled; completed is terminal.
-- member_id is not null (a shift always belongs to exactly one member).
-- team_id and warehouse_id are optional context.
-- Handler-set timestamps: started_at / completed_at / cancelled_at.
-- ---------------------------------------------------------------------------

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.workforce_members(id),
  team_id uuid references public.workforce_teams(id),
  warehouse_id uuid references public.warehouses(id),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'started', 'completed', 'cancelled')),
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create index if not exists shifts_org_idx
  on public.shifts (org_id)
  where deleted_at is null;

create index if not exists shifts_org_status_idx
  on public.shifts (org_id, status)
  where deleted_at is null;

create index if not exists shifts_org_member_idx
  on public.shifts (org_id, member_id)
  where deleted_at is null;

create index if not exists shifts_org_member_scheduled_idx
  on public.shifts (org_id, member_id, scheduled_start_at)
  where deleted_at is null;

create index if not exists shifts_org_team_idx
  on public.shifts (org_id, team_id)
  where team_id is not null and deleted_at is null;

create index if not exists shifts_org_warehouse_idx
  on public.shifts (org_id, warehouse_id)
  where warehouse_id is not null and deleted_at is null;

alter table public.shifts enable row level security;

drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists shifts_write on public.shifts;
create policy shifts_write on public.shifts
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

create or replace function public.trg_shifts_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists shifts_set_updated_at on public.shifts;
create trigger shifts_set_updated_at
  before update on public.shifts
  for each row execute function public.trg_shifts_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: shifts status transitions. Identical pattern to
-- trg_audit_manufacturing_runs_status from 0052 (SECURITY DEFINER, per-org
-- advisory lock, hash chain via prev_hash, inline audit_log INSERT). Fires
-- only when status actually changes. to_state carries the new status string.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_shifts_status()
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
    'entity_type', 'shift',
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
    new.org_id, 'shift', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

revoke execute on function public.trg_audit_shifts_status() from public, anon;

drop trigger if exists audit_shifts_status on public.shifts;
create trigger audit_shifts_status
  after update of status on public.shifts
  for each row execute function public.trg_audit_shifts_status();

-- ---------------------------------------------------------------------------
-- Table comment for operator discoverability.
-- ---------------------------------------------------------------------------

comment on table public.shifts is
  'Pillar 4 KitForce: rostered block of time a workforce_member is scheduled to work. State machine: scheduled -> started -> completed; scheduled|started -> cancelled; completed terminal. member_id required. team_id and warehouse_id optional context. Pattern A RLS via denormalised org_id.';
