-- ============================================================================
-- Migration: 0081_kitforce_time_entries.sql
-- Wave: 11
-- Phase: Pillar 4 (KitForce) foundation, step 4 of 5
-- Closes: prerequisite for 0082 (numbering), the kitforce-api edge bundle,
--   kitforce capabilities, the Zod canon side-car, and the SPA pillar mirror.
--   Implements section 3.6 and the time_entry portion of section 4 of
--   03-workspace/specs/kitforce-pillar-spec.md (APPROVED 2026-05-31).
--   Decision T1 resolved 2026-05-31: KitCost rolls up labor cost as a
--   read-rollup (minutes * hourly_rate_cents); no separate labor ledger.
-- Date: 2026-05-31
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop trigger if exists audit_time_entries on public.time_entries;
--   drop trigger if exists time_entries_set_updated_at on public.time_entries;
--   drop function if exists public.trg_audit_time_entries();
--   drop function if exists public.trg_time_entries_set_updated_at();
--   drop policy if exists time_entries_write  on public.time_entries;
--   drop policy if exists time_entries_select on public.time_entries;
--   drop table if exists public.time_entries;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0080 CHECK constraint by hand if needed).
--
-- Constitutional alignment:
--   Money rules        hourly_rate_cents is BIGINT cents with the _cents suffix,
--                      snapshotted from the member's default_hourly_rate_cents at
--                      clock-in (overridable by the handler). NOT NULL and >= 0.
--                      minutes is numeric(18,4) per the duration rule. No floats.
--   RLS rules          Pattern A on every new table from creation. org_id
--                      denormalised for RLS without a parent join. Write policy
--                      role set is ('org_owner','org_admin','ops') per spec
--                      section 5, matching the manufacturing pillar convention.
--                      Cross-tenant reads return 200 + []; cross-tenant writes
--                      hit the NOT_FOUND surface.
--   Audit rules        time_entries is a line-item-class table (no state machine
--                      of its own). Uses the central audit_append_state_change
--                      helper on INSERT / UPDATE / DELETE with an action verb
--                      (created / updated / deleted) in to_state so the NOT NULL
--                      contract on audit_log.to_state holds.
--   Migration rules    Forward-only. All DDL idempotent. The audit_log
--                      entity_type CHECK extension uses a guarded DROP
--                      CONSTRAINT IF EXISTS / ADD CONSTRAINT pair and re-adds
--                      the full authoritative list (through 0080) plus
--                      time_entry.
--   State machine      None. A clock-out is an UPDATE that sets clock_out_at
--                      and minutes. Open entries have clock_out_at null.
--   Out of scope       No numbering prefix for time_entries (not in spec).
--                      Numbering (0082) is the next file. No handler code, no
--                      SPA, no Zod canon, no capabilities side-car here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include time_entry.
-- Guarded drop-then-add. Re-adds every value authoritative as of 0080 plus
-- time_entry.
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
    -- Pillar 4 KitForce shifts (0079)
    'shift',
    -- Pillar 4 KitForce assignments (0080)
    'work_assignment',
    -- Pillar 4 KitForce time entries (this migration)
    'time_entry'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Extended in 0081 to add time_entry.';

-- ---------------------------------------------------------------------------
-- time_entries: clock-in / clock-out records. Labor-cost feeder for KitCost.
-- hourly_rate_cents is snapshotted from workforce_members.default_hourly_rate_cents
-- at clock-in (overridable); it is NOT NULL so labor cost is always computable.
-- minutes is null while the entry is open (clock_out_at null); the handler
-- derives and sets it on clock-out.
-- shift_id and assignment_id are both optional context links.
-- No state machine; treated as a line-item-class table (Decision T1).
-- ---------------------------------------------------------------------------

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null references public.workforce_members(id),
  shift_id uuid references public.shifts(id),
  assignment_id uuid references public.work_assignments(id),
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  minutes numeric(18, 4)
    check (minutes is null or minutes >= 0),
  hourly_rate_cents bigint not null
    check (hourly_rate_cents >= 0),
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists time_entries_org_idx
  on public.time_entries (org_id);

create index if not exists time_entries_org_member_idx
  on public.time_entries (org_id, member_id);

create index if not exists time_entries_org_member_clock_in_idx
  on public.time_entries (org_id, member_id, clock_in_at desc);

create index if not exists time_entries_org_shift_idx
  on public.time_entries (org_id, shift_id)
  where shift_id is not null;

create index if not exists time_entries_org_assignment_idx
  on public.time_entries (org_id, assignment_id)
  where assignment_id is not null;

create index if not exists time_entries_org_open_idx
  on public.time_entries (org_id, member_id)
  where clock_out_at is null;

alter table public.time_entries enable row level security;

drop policy if exists time_entries_select on public.time_entries;
create policy time_entries_select on public.time_entries
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists time_entries_write on public.time_entries;
create policy time_entries_write on public.time_entries
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

create or replace function public.trg_time_entries_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists time_entries_set_updated_at on public.time_entries;
create trigger time_entries_set_updated_at
  before update on public.time_entries
  for each row execute function public.trg_time_entries_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: time_entries. Fires on INSERT / UPDATE / DELETE via the
-- central audit_append_state_change helper. Action verb in to_state mirrors
-- the trg_audit_sales_channels pattern from 0073. Line-item class: no status
-- column, so to_state is created / updated / deleted.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_time_entries()
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
      'member_id', new.member_id,
      'shift_id', new.shift_id,
      'assignment_id', new.assignment_id,
      'clock_in_at', new.clock_in_at,
      'clock_out_at', new.clock_out_at,
      'minutes', new.minutes,
      'hourly_rate_cents', new.hourly_rate_cents
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
      'member_id', new.member_id,
      'shift_id', jsonb_build_object('from', old.shift_id, 'to', new.shift_id),
      'assignment_id', jsonb_build_object('from', old.assignment_id, 'to', new.assignment_id),
      'clock_in_at', jsonb_build_object('from', old.clock_in_at, 'to', new.clock_in_at),
      'clock_out_at', jsonb_build_object('from', old.clock_out_at, 'to', new.clock_out_at),
      'minutes', jsonb_build_object('from', old.minutes, 'to', new.minutes),
      'hourly_rate_cents', jsonb_build_object('from', old.hourly_rate_cents, 'to', new.hourly_rate_cents)
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
      'member_id', old.member_id,
      'clock_in_at', old.clock_in_at,
      'clock_out_at', old.clock_out_at,
      'minutes', old.minutes,
      'hourly_rate_cents', old.hourly_rate_cents
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'time_entry',
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

revoke execute on function public.trg_audit_time_entries() from public, anon;

drop trigger if exists audit_time_entries on public.time_entries;
create trigger audit_time_entries
  after insert or update or delete on public.time_entries
  for each row execute function public.trg_audit_time_entries();

-- ---------------------------------------------------------------------------
-- Table comment for operator discoverability.
-- ---------------------------------------------------------------------------

comment on table public.time_entries is
  'Pillar 4 KitForce: clock-in / clock-out labor record. Labor-cost feeder for KitCost (minutes * hourly_rate_cents, Decision T1 read-rollup). hourly_rate_cents snapshotted at clock-in from workforce_members.default_hourly_rate_cents. minutes null while open (clock_out_at null); handler derives and sets on clock-out. No state machine; line-item-class audit trigger. Pattern A RLS via denormalised org_id.';
