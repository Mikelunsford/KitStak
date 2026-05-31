-- ============================================================================
-- Migration: 0080_kitforce_assignments.sql
-- Wave: 11
-- Phase: Pillar 4 (KitForce) foundation, step 3 of 5
-- Closes: prerequisite for 0081 (time entries), 0082 (numbering), the
--   kitforce-api edge bundle, kitforce capabilities, the Zod canon side-car,
--   and the SPA pillar mirror. Implements section 3.5 and the work_assignment
--   portion of section 4 of
--   03-workspace/specs/kitforce-pillar-spec.md (APPROVED 2026-05-31).
--   Decision K2 (polymorphic job link) and K3 (no cross-pillar migration
--   dependency) resolved 2026-05-31.
-- Date: 2026-05-31
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop trigger if exists audit_work_assignments_status on public.work_assignments;
--   drop trigger if exists work_assignments_set_updated_at on public.work_assignments;
--   drop function if exists public.trg_audit_work_assignments_status();
--   drop function if exists public.trg_work_assignments_set_updated_at();
--   drop policy if exists work_assignments_write  on public.work_assignments;
--   drop policy if exists work_assignments_select on public.work_assignments;
--   drop table if exists public.work_assignments;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0079 CHECK constraint by hand if needed).
--
-- Constitutional alignment:
--   Money rules        No money columns. planned_minutes is numeric(18,4) per
--                      the spec (quantities and durations rule). No floats.
--   RLS rules          Pattern A on every new table from creation. org_id
--                      denormalised for RLS without a parent join. Write policy
--                      role set is ('org_owner','org_admin','ops') per spec
--                      section 5, matching the manufacturing pillar convention.
--                      Cross-tenant reads return 200 + []; cross-tenant writes
--                      hit the NOT_FOUND surface.
--   Audit rules        work_assignments has an auto-state-transition audit
--                      trigger that fires AFTER UPDATE OF status, identical
--                      pattern to trg_audit_manufacturing_runs_status from 0052
--                      (SECURITY DEFINER, per-org advisory lock, hash chain via
--                      prev_hash, inline audit_log INSERT). to_state carries the
--                      new status string.
--   Migration rules    Forward-only. All DDL idempotent. The audit_log
--                      entity_type CHECK extension uses a guarded DROP
--                      CONSTRAINT IF EXISTS / ADD CONSTRAINT pair and re-adds
--                      the full authoritative list (through 0079) plus
--                      work_assignment.
--   State machine      open -> assigned -> in_progress -> done;
--                      open|assigned|in_progress -> cancelled; done terminal.
--                      Status text + CHECK constraint, not pg enum. Allowed
--                      transitions enforced by the kitforce-api handler layer.
--   Polymorphic link   Decision K2: job link is a (job_type, job_id) pair.
--                      No database-level FK on job_id; the handler validates
--                      the row exists and is org-scoped before write. A CHECK
--                      ensures both columns are null or both are non-null.
--                      kitting_jobs are live from day one because Co-Pack ships
--                      first (Decision K3).
--   Out of scope       WA- numbering prefix is seeded in 0082. time_entries
--                      (0081) and numbering (0082) are separate files. No
--                      handler code, no SPA, no Zod canon, no capabilities
--                      side-car in this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include work_assignment.
-- Guarded drop-then-add. Re-adds every value authoritative as of 0079 plus
-- work_assignment.
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
    -- Pillar 4 KitForce assignments (this migration)
    'work_assignment'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Extended in 0080 to add work_assignment.';

-- ---------------------------------------------------------------------------
-- work_assignments: discrete tasks handed to a member, optionally linked to
-- a job via the polymorphic (job_type, job_id) pair (Decision K2).
-- State machine: open -> assigned -> in_progress -> done;
-- open|assigned|in_progress -> cancelled; done is terminal.
-- assignment_number is org-scoped nullable (WA- prefix seeded in 0082).
-- member_id and shift_id are both nullable (an assignment may be unlinked
-- until picked up).
-- A CHECK enforces that job_type and job_id are either both null or both
-- non-null. No DB-level FK on job_id; handler validates before write.
-- ---------------------------------------------------------------------------

create table if not exists public.work_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  assignment_number text,
  member_id uuid references public.workforce_members(id),
  shift_id uuid references public.shifts(id),
  job_type text
    check (job_type in ('manufacturing_run', 'kitting_job', 'project')),
  job_id uuid,
  title text not null,
  status text not null default 'open'
    check (status in ('open', 'assigned', 'in_progress', 'done', 'cancelled')),
  planned_minutes numeric(18, 4)
    check (planned_minutes is null or planned_minutes >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,

  -- Both job_type and job_id must be null or both must be non-null (K2).
  constraint work_assignments_job_link_pair_check
    check (
      (job_type is null and job_id is null)
      or (job_type is not null and job_id is not null)
    )
);

create unique index if not exists work_assignments_org_assignment_number_uniq
  on public.work_assignments (org_id, assignment_number)
  where assignment_number is not null;

create index if not exists work_assignments_org_idx
  on public.work_assignments (org_id)
  where deleted_at is null;

create index if not exists work_assignments_org_status_idx
  on public.work_assignments (org_id, status)
  where deleted_at is null;

create index if not exists work_assignments_org_member_idx
  on public.work_assignments (org_id, member_id)
  where member_id is not null and deleted_at is null;

create index if not exists work_assignments_org_shift_idx
  on public.work_assignments (org_id, shift_id)
  where shift_id is not null and deleted_at is null;

create index if not exists work_assignments_org_job_idx
  on public.work_assignments (org_id, job_type, job_id)
  where job_id is not null and deleted_at is null;

alter table public.work_assignments enable row level security;

drop policy if exists work_assignments_select on public.work_assignments;
create policy work_assignments_select on public.work_assignments
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists work_assignments_write on public.work_assignments;
create policy work_assignments_write on public.work_assignments
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

create or replace function public.trg_work_assignments_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists work_assignments_set_updated_at on public.work_assignments;
create trigger work_assignments_set_updated_at
  before update on public.work_assignments
  for each row execute function public.trg_work_assignments_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: work_assignments status transitions. Identical pattern to
-- trg_audit_manufacturing_runs_status from 0052 (SECURITY DEFINER, per-org
-- advisory lock, hash chain via prev_hash, inline audit_log INSERT). Fires
-- only when status actually changes. to_state carries the new status string.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_work_assignments_status()
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
    'entity_type', 'work_assignment',
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
    new.org_id, 'work_assignment', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

revoke execute on function public.trg_audit_work_assignments_status() from public, anon;

drop trigger if exists audit_work_assignments_status on public.work_assignments;
create trigger audit_work_assignments_status
  after update of status on public.work_assignments
  for each row execute function public.trg_audit_work_assignments_status();

-- ---------------------------------------------------------------------------
-- Table comment for operator discoverability.
-- ---------------------------------------------------------------------------

comment on table public.work_assignments is
  'Pillar 4 KitForce: discrete task handed to a workforce_member. State machine: open -> assigned -> in_progress -> done; open|assigned|in_progress -> cancelled; done terminal. Polymorphic job link (job_type, job_id) per Decision K2: both null or both non-null enforced by CHECK; no DB FK on job_id, handler validates. assignment_number WA- prefix seeded in 0082. Pattern A RLS via denormalised org_id.';
