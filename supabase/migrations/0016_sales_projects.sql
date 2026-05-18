-- ============================================================================
-- Migration: 0016_sales_projects.sql
-- Wave: 2
-- Phase: Sales chassis (projects, project_phases, convert_quote_to_project RPC)
-- Closes: R-W2-PROJECTS-01, R-W2-PROJECT-PHASES-01, R-W2-QUOTE-TO-PROJECT-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop convert_quote_to_project,
--   project_phases, projects in reverse dependency order. Not auto-run.
--
-- Constitutional alignment:
--   Workflow rules     6-state project FSM (pending, ready_to_build,
--                      in_production, ready_to_ship, completed, cancelled).
--                      4-state project_phase FSM (pending, active, completed,
--                      cancelled). Paired <state>_at timestamps on both.
--   Money rules        Money columns _cents BIGINT. Currency snapshotted on
--                      project via currency_code.
--   RLS rules          Pattern A on projects; Pattern B parent-join on
--                      project_phases.
--   Audit rules        Triggers in 0017 write on state change.
--   Migration rules    Forward-only. All DDL idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- projects: top-level production / fulfillment workspace. 6-state machine.
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  number text not null,
  name text not null,
  description text,
  customer_id uuid,
  source_quote_id uuid references public.quotes(id) on delete set null,
  job_type_id uuid references public.job_types(id) on delete set null,
  state text not null default 'pending'
    check (state in (
      'pending', 'ready_to_build', 'in_production',
      'ready_to_ship', 'completed', 'cancelled'
    )),

  pending_at timestamptz,
  ready_to_build_at timestamptz,
  in_production_at timestamptz,
  ready_to_ship_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,

  start_date date,
  due_date date,

  currency_code text not null default 'USD' references public.currencies(code),
  budget_cents bigint not null default 0 check (budget_cents >= 0),

  notes text,
  internal_notes text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, number)
);

create index if not exists projects_org_state_idx
  on public.projects (org_id, state) where deleted_at is null;
create index if not exists projects_org_customer_idx
  on public.projects (org_id, customer_id) where deleted_at is null;
create index if not exists projects_source_quote_idx
  on public.projects (source_quote_id) where deleted_at is null;

alter table public.projects enable row level security;

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'ops', 'accounting')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'ops', 'accounting')
  );

-- ---------------------------------------------------------------------------
-- project_phases: Pattern B parent-join. 4-state FSM. Drag-drop reorder is
-- pure UI: the API patches the integer `position` column inside a single
-- service-role transaction.
-- ---------------------------------------------------------------------------

create table if not exists public.project_phases (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  position integer not null default 0,
  name text not null,
  description text,
  state text not null default 'pending'
    check (state in ('pending', 'active', 'completed', 'cancelled')),

  pending_at timestamptz,
  active_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,

  start_date date,
  due_date date,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists project_phases_project_position_idx
  on public.project_phases (project_id, position);

alter table public.project_phases enable row level security;

drop policy if exists project_phases_select on public.project_phases;
create policy project_phases_select on public.project_phases
  for select to authenticated
  using (
    exists (
      select 1 from public.projects p
       where p.id = project_phases.project_id
         and p.org_id = public.current_org_id()
    )
  );

drop policy if exists project_phases_write on public.project_phases;
create policy project_phases_write on public.project_phases
  for all to authenticated
  using (
    exists (
      select 1 from public.projects p
       where p.id = project_phases.project_id
         and p.org_id = public.current_org_id()
         and public.current_user_role() in
             ('org_owner', 'org_admin', 'sales', 'ops', 'accounting')
    )
  )
  with check (
    exists (
      select 1 from public.projects p
       where p.id = project_phases.project_id
         and p.org_id = public.current_org_id()
         and public.current_user_role() in
             ('org_owner', 'org_admin', 'sales', 'ops', 'accounting')
    )
  );

-- ---------------------------------------------------------------------------
-- convert_quote_to_project: atomic conversion. Reads the source quote,
-- creates a project row in 'pending', transitions the quote to
-- 'project_pending', sets converted_to_project_id on the quote.
--
-- The quote must be in 'approved' state. Re-running on a quote that is
-- already 'project_pending' returns the existing converted_to_project_id
-- (idempotent).
-- ---------------------------------------------------------------------------

create or replace function public.convert_quote_to_project(
  p_quote_id uuid,
  p_actor uuid,
  p_project_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_state text;
  v_existing uuid;
  v_project_id uuid;
  v_customer_id uuid;
  v_currency text;
  v_name text;
  v_number text;
begin
  select org_id, state, converted_to_project_id, customer_id,
         currency_code, coalesce(title, 'Quote ' || number)
    into v_org_id, v_state, v_existing, v_customer_id, v_currency, v_name
    from public.quotes
   where id = p_quote_id;

  if v_org_id is null then
    raise exception 'NOT_FOUND: quote not found' using errcode = 'P0001';
  end if;
  if v_org_id <> public.current_org_id() then
    raise exception 'FORBIDDEN: cross-tenant conversion' using errcode = '42501';
  end if;

  if v_state = 'project_pending' and v_existing is not null then
    return v_existing;
  end if;

  if v_state <> 'approved' then
    raise exception 'STATE_CONFLICT: quote not in approved state (was %)', v_state
      using errcode = 'P0001';
  end if;

  v_number := coalesce(p_project_number,
    'PRJ-' || to_char(now(), 'YYYYMMDD') || '-' ||
    substr(replace(p_quote_id::text, '-', ''), 1, 8));

  insert into public.projects (
    org_id, number, name, customer_id, source_quote_id,
    state, currency_code,
    created_by, updated_by
  ) values (
    v_org_id, v_number, v_name, v_customer_id, p_quote_id,
    'pending', v_currency,
    p_actor, p_actor
  )
  returning id into v_project_id;

  update public.quotes
     set state = 'project_pending',
         converted_to_project_id = v_project_id,
         updated_at = now(),
         updated_by = p_actor
   where id = p_quote_id;

  return v_project_id;
end;
$$;

revoke execute on function public.convert_quote_to_project(uuid, uuid, text)
  from public, anon;
grant execute on function public.convert_quote_to_project(uuid, uuid, text)
  to authenticated, service_role;
