-- ============================================================================
-- Migration: 0008_crm_activities_leads_opportunities.sql
-- Wave: 2
-- Phase: CRM core (Agent B)
-- Closes: R-W2-CRM-03 (activity log entity), R-W2-CRM-04 (lead state machine),
--         R-W2-CRM-05 (opportunity stage machine + amount in cents)
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop in reverse dependency order:
--   drop table public.opportunities cascade;
--   drop table public.leads cascade;
--   drop table public.activities cascade;
--   Not auto-run.
--
-- Constitutional alignment:
--   Money rules        opportunities.amount_cents and leads.estimated_value_cents
--                      stored as bigint cents. currency_code snapshotted on the
--                      row at issuance. No floats; never numeric for money.
--   RLS rules          Pattern A on activities, leads, opportunities. Cross-
--                      tenant reads filter to empty. Writes gated by staff roles.
--   Audit rules        State columns carry text CHECK constraints aligned with
--                      _shared/workflow/crm.ts. Triggers land in 0010.
--   Migration rules    Forward-only. All DDL idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- activities: polymorphic activity log (call, meeting, email, note, task)
-- against customer / contact / lead / opportunity. Pattern A RLS.
-- ---------------------------------------------------------------------------

create table if not exists public.activities (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null
    check (entity_type in ('customer', 'contact', 'lead', 'opportunity')),
  entity_id uuid not null,
  kind text not null
    check (kind in ('call', 'meeting', 'email', 'note', 'task')),
  subject text not null,
  body text,
  status text not null default 'open'
    check (status in ('open', 'completed', 'cancelled')),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create index if not exists activities_org_entity_idx
  on public.activities (org_id, entity_type, entity_id, created_at desc)
  where deleted_at is null;

create index if not exists activities_org_status_due_idx
  on public.activities (org_id, status, due_at)
  where deleted_at is null and status = 'open';

alter table public.activities enable row level security;

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists activities_write on public.activities;
create policy activities_write on public.activities
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in (
      'org_owner', 'org_admin', 'sales', 'ops'
    )
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in (
      'org_owner', 'org_admin', 'sales', 'ops'
    )
  );

-- ---------------------------------------------------------------------------
-- leads: pre-sales pipeline rows. Status CHECK aligns with
-- _shared/workflow/crm.ts leadStateMachine. estimated_value_cents is bigint
-- per the money rules.
-- ---------------------------------------------------------------------------

create table if not exists public.leads (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null,
  company_name text,
  source text
    check (source is null or source in (
      'inbound', 'outbound', 'referral', 'event', 'import', 'other'
    )),
  status text not null default 'new'
    check (status in (
      'new', 'working', 'qualified', 'converted', 'disqualified'
    )),
  primary_email citext,
  primary_phone text,
  owner_user_id uuid,
  estimated_value_cents bigint not null default 0
    check (estimated_value_cents >= 0),
  currency_code text,
  converted_customer_id uuid references public.customers(id) on delete set null,
  converted_opportunity_id uuid,
  converted_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create index if not exists leads_org_status_idx
  on public.leads (org_id, status, created_at desc)
  where deleted_at is null;

create index if not exists leads_org_owner_idx
  on public.leads (org_id, owner_user_id)
  where deleted_at is null;

alter table public.leads enable row level security;

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists leads_write on public.leads;
create policy leads_write on public.leads
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in (
      'org_owner', 'org_admin', 'sales'
    )
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in (
      'org_owner', 'org_admin', 'sales'
    )
  );

-- ---------------------------------------------------------------------------
-- opportunities: sales pipeline rows. Stage CHECK aligns with
-- _shared/workflow/crm.ts opportunityStageMachine. amount_cents bigint per
-- the money rules; currency_code snapshotted on the row.
-- ---------------------------------------------------------------------------

create table if not exists public.opportunities (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  lead_id uuid references public.leads(id) on delete set null,
  display_name text not null,
  stage text not null default 'discovery'
    check (stage in (
      'discovery', 'evaluation', 'proposal', 'negotiation',
      'closed_won', 'closed_lost'
    )),
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  currency_code text,
  probability_pct integer not null default 0
    check (probability_pct between 0 and 100),
  expected_close_date date,
  closed_at timestamptz,
  close_reason text,
  owner_user_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create index if not exists opportunities_org_stage_idx
  on public.opportunities (org_id, stage, created_at desc)
  where deleted_at is null;

create index if not exists opportunities_org_customer_idx
  on public.opportunities (org_id, customer_id)
  where deleted_at is null;

create index if not exists opportunities_org_owner_idx
  on public.opportunities (org_id, owner_user_id)
  where deleted_at is null;

-- DEFERRABLE FK so convert_lead() can insert the opportunity and patch the
-- lead's converted_opportunity_id in the same transaction.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'leads_converted_opportunity_id_fkey'
  ) then
    alter table public.leads
      add constraint leads_converted_opportunity_id_fkey
      foreign key (converted_opportunity_id)
      references public.opportunities(id)
      on delete set null
      deferrable initially deferred;
  end if;
end$$;

alter table public.opportunities enable row level security;

drop policy if exists opportunities_select on public.opportunities;
create policy opportunities_select on public.opportunities
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists opportunities_write on public.opportunities;
create policy opportunities_write on public.opportunities
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in (
      'org_owner', 'org_admin', 'sales'
    )
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in (
      'org_owner', 'org_admin', 'sales'
    )
  );
