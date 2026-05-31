-- ============================================================================
-- Migration: 0078_kitforce_members_teams.sql
-- Wave: 11
-- Phase: Pillar 4 (KitForce) foundation, step 1 of 5
-- Closes: prerequisite for 0079 (shifts), 0080 (work assignments),
--   0081 (time entries), 0082 (numbering), the kitforce-api edge bundle,
--   kitforce capabilities, the Zod canon side-car, and the SPA pillar mirror.
--   Implements sections 3.1, 3.2, 3.3, and the workforce entity portion of
--   section 4 of 03-workspace/specs/kitforce-pillar-spec.md (APPROVED 2026-05-31).
-- Date: 2026-05-31
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop trigger if exists audit_workforce_team_members on public.workforce_team_members;
--   drop trigger if exists audit_workforce_teams on public.workforce_teams;
--   drop trigger if exists audit_workforce_members_status on public.workforce_members;
--   drop trigger if exists workforce_team_members_set_updated_at on public.workforce_team_members;
--   drop trigger if exists workforce_teams_set_updated_at on public.workforce_teams;
--   drop trigger if exists workforce_members_set_updated_at on public.workforce_members;
--   drop function if exists public.trg_audit_workforce_team_members();
--   drop function if exists public.trg_audit_workforce_teams();
--   drop function if exists public.trg_audit_workforce_members_status();
--   drop function if exists public.trg_workforce_team_members_set_updated_at();
--   drop function if exists public.trg_workforce_teams_set_updated_at();
--   drop function if exists public.trg_workforce_members_set_updated_at();
--   drop policy if exists workforce_team_members_write  on public.workforce_team_members;
--   drop policy if exists workforce_team_members_select on public.workforce_team_members;
--   drop policy if exists workforce_teams_write  on public.workforce_teams;
--   drop policy if exists workforce_teams_select on public.workforce_teams;
--   drop policy if exists workforce_members_write  on public.workforce_members;
--   drop policy if exists workforce_members_select on public.workforce_members;
--   drop table if exists public.workforce_team_members;
--   drop table if exists public.workforce_teams;
--   drop table if exists public.workforce_members;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0073 CHECK constraint by hand if needed).
--
-- Constitutional alignment:
--   Money rules        default_hourly_rate_cents stored as BIGINT cents with
--                      the _cents suffix. No floats anywhere. Rate column is
--                      nullable; when present it must be >= 0. The rate is
--                      compensation data restricted to org_owner and accounting
--                      at the handler layer (capability kitforce.member.read_rate
--                      per Decision C2); RLS does not filter individual columns,
--                      so the restriction lives in the API, not here.
--   RLS rules          Pattern A on every new table from creation. org_id is
--                      denormalised onto workforce_team_members so RLS evaluates
--                      without a parent join, mirroring 0052 exactly. Write
--                      policy role set is ('org_owner','org_admin','ops') per
--                      spec section 5 and the manufacturing pillar convention.
--                      Cross-tenant reads return 200 + []; cross-tenant writes
--                      hit the same NOT_FOUND surface as the parent.
--   Audit rules        workforce_members has an auto-state-transition audit
--                      trigger that fires AFTER UPDATE OF status, identical
--                      pattern to trg_audit_manufacturing_runs_status from 0052
--                      (SECURITY DEFINER, per-org advisory lock, hash chain via
--                      prev_hash, inline audit_log INSERT). workforce_teams
--                      (library) and workforce_team_members (join) use the
--                      central audit_append_state_change helper on INSERT /
--                      UPDATE / DELETE with an action verb in to_state.
--   Migration rules    Forward-only. All DDL idempotent (CREATE TABLE IF NOT
--                      EXISTS, drop-policy-if-exists before create, CREATE INDEX
--                      IF NOT EXISTS, drop-and-create on every trigger, CREATE OR
--                      REPLACE FUNCTION). The audit_log entity_type CHECK
--                      extension uses a guarded DROP CONSTRAINT IF EXISTS / ADD
--                      CONSTRAINT pair and re-adds the full authoritative list
--                      (through 0073) plus the three new workforce entity_types.
--   State machine      workforce_members status text + CHECK constraint, not pg
--                      enum. Allowed transitions: active <-> inactive. Enforced
--                      by the kitforce-api handler layer. workforce_teams and
--                      workforce_team_members have no state machine.
--   Out of scope       member_number EMP- prefix is seeded in 0082. Shifts
--                      (0079), work assignments (0080), time entries (0081),
--                      and numbering (0082) are separate files. No handler code,
--                      no SPA, no Zod canon, no capabilities side-car in this
--                      file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include the workforce entities.
-- Guarded drop-then-add. Re-adds every value authoritative as of 0073 plus
-- workforce_member, workforce_team, workforce_team_member.
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
    -- Pillar 4 KitForce (this migration)
    'workforce_member',
    'workforce_team',
    'workforce_team_member'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Extended in 0078 to add workforce_member, workforce_team, workforce_team_member.';

-- ---------------------------------------------------------------------------
-- workforce_members: per-org registry of people who perform labor.
-- State machine: active <-> inactive. member_number is org-scoped nullable
-- (filled by the EMP- numbering sequence seeded in 0082). user_id links to
-- a Supabase auth user when the worker also logs into Kitstak; null for
-- floor workers with no login.
-- ---------------------------------------------------------------------------

create table if not exists public.workforce_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  member_number text,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  email text,
  phone text,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  default_hourly_rate_cents bigint
    check (default_hourly_rate_cents is null or default_hourly_rate_cents >= 0),
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create unique index if not exists workforce_members_org_member_number_uniq
  on public.workforce_members (org_id, member_number)
  where member_number is not null;

create index if not exists workforce_members_org_idx
  on public.workforce_members (org_id)
  where deleted_at is null;

create index if not exists workforce_members_org_status_idx
  on public.workforce_members (org_id, status)
  where deleted_at is null;

create index if not exists workforce_members_org_user_idx
  on public.workforce_members (org_id, user_id)
  where user_id is not null and deleted_at is null;

alter table public.workforce_members enable row level security;

drop policy if exists workforce_members_select on public.workforce_members;
create policy workforce_members_select on public.workforce_members
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists workforce_members_write on public.workforce_members;
create policy workforce_members_write on public.workforce_members
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
-- workforce_teams: per-org groupings of members (shift crews, lines, pick
-- teams). Library table, no state machine. Audited on INSERT / UPDATE /
-- DELETE via the central helper.
-- ---------------------------------------------------------------------------

create table if not exists public.workforce_teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create index if not exists workforce_teams_org_idx
  on public.workforce_teams (org_id)
  where deleted_at is null;

create index if not exists workforce_teams_org_active_idx
  on public.workforce_teams (org_id, is_active)
  where deleted_at is null;

alter table public.workforce_teams enable row level security;

drop policy if exists workforce_teams_select on public.workforce_teams;
create policy workforce_teams_select on public.workforce_teams
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists workforce_teams_write on public.workforce_teams;
create policy workforce_teams_write on public.workforce_teams
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
-- workforce_team_members: join table linking members to teams. A member can
-- belong to more than one team. Soft-remove via deleted_at; the unique index
-- covers only active (non-deleted) memberships. org_id is denormalised for
-- Pattern A RLS without a parent join.
-- ---------------------------------------------------------------------------

create table if not exists public.workforce_team_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.workforce_teams(id) on delete cascade,
  member_id uuid not null references public.workforce_members(id),
  role_in_team text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create unique index if not exists workforce_team_members_org_team_member_uniq
  on public.workforce_team_members (org_id, team_id, member_id)
  where deleted_at is null;

create index if not exists workforce_team_members_org_team_idx
  on public.workforce_team_members (org_id, team_id)
  where deleted_at is null;

create index if not exists workforce_team_members_org_member_idx
  on public.workforce_team_members (org_id, member_id)
  where deleted_at is null;

alter table public.workforce_team_members enable row level security;

drop policy if exists workforce_team_members_select on public.workforce_team_members;
create policy workforce_team_members_select on public.workforce_team_members
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists workforce_team_members_write on public.workforce_team_members;
create policy workforce_team_members_write on public.workforce_team_members
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
-- updated_at stamping triggers. Plain BEFORE UPDATE; no audit side effect.
-- ---------------------------------------------------------------------------

create or replace function public.trg_workforce_members_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workforce_members_set_updated_at on public.workforce_members;
create trigger workforce_members_set_updated_at
  before update on public.workforce_members
  for each row execute function public.trg_workforce_members_set_updated_at();

create or replace function public.trg_workforce_teams_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workforce_teams_set_updated_at on public.workforce_teams;
create trigger workforce_teams_set_updated_at
  before update on public.workforce_teams
  for each row execute function public.trg_workforce_teams_set_updated_at();

create or replace function public.trg_workforce_team_members_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workforce_team_members_set_updated_at on public.workforce_team_members;
create trigger workforce_team_members_set_updated_at
  before update on public.workforce_team_members
  for each row execute function public.trg_workforce_team_members_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: workforce_members status transitions. Identical pattern to
-- trg_audit_manufacturing_runs_status from 0052 (SECURITY DEFINER, per-org
-- advisory lock, hash chain via prev_hash, inline audit_log INSERT). Fires
-- only when status actually changes. to_state carries the new status string.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_workforce_members_status()
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
    'entity_type', 'workforce_member',
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
    new.org_id, 'workforce_member', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

revoke execute on function public.trg_audit_workforce_members_status() from public, anon;

drop trigger if exists audit_workforce_members_status on public.workforce_members;
create trigger audit_workforce_members_status
  after update of status on public.workforce_members
  for each row execute function public.trg_audit_workforce_members_status();

-- ---------------------------------------------------------------------------
-- Audit trigger: workforce_teams library. Fires on INSERT / UPDATE / DELETE
-- via the central audit_append_state_change helper. Action verb in to_state.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_workforce_teams()
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
      'is_active', old.is_active
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'workforce_team',
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

revoke execute on function public.trg_audit_workforce_teams() from public, anon;

drop trigger if exists audit_workforce_teams on public.workforce_teams;
create trigger audit_workforce_teams
  after insert or update or delete on public.workforce_teams
  for each row execute function public.trg_audit_workforce_teams();

-- ---------------------------------------------------------------------------
-- Audit trigger: workforce_team_members join table. Fires on INSERT / UPDATE /
-- DELETE via the central helper. Action verb in to_state.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_workforce_team_members()
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
      'team_id', new.team_id,
      'member_id', new.member_id,
      'role_in_team', new.role_in_team
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
      'team_id', new.team_id,
      'member_id', new.member_id,
      'role_in_team', jsonb_build_object('from', old.role_in_team, 'to', new.role_in_team)
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
      'team_id', old.team_id,
      'member_id', old.member_id,
      'role_in_team', old.role_in_team
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'workforce_team_member',
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

revoke execute on function public.trg_audit_workforce_team_members() from public, anon;

drop trigger if exists audit_workforce_team_members on public.workforce_team_members;
create trigger audit_workforce_team_members
  after insert or update or delete on public.workforce_team_members
  for each row execute function public.trg_audit_workforce_team_members();

-- ---------------------------------------------------------------------------
-- Table comments for operator discoverability.
-- ---------------------------------------------------------------------------

comment on table public.workforce_members is
  'Pillar 4 KitForce: per-org registry of people who perform labor. State machine: active <-> inactive. member_number filled by EMP- numbering sequence (seeded in 0082). user_id nullable: links a member to a Kitstak login when one exists. default_hourly_rate_cents is compensation data; read restricted to org_owner and accounting at the API layer (kitforce.member.read_rate capability, Decision C2).';

comment on table public.workforce_teams is
  'Pillar 4 KitForce: per-org groupings of workforce_members (shift crews, lines, pick teams). Library table, no state machine. Pattern A RLS via denormalised org_id.';

comment on table public.workforce_team_members is
  'Pillar 4 KitForce: join between workforce_teams and workforce_members. A member may belong to more than one team. Soft-remove via deleted_at. Unique active membership enforced by partial index. Pattern A RLS via denormalised org_id.';
