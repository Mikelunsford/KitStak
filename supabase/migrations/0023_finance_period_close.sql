-- ============================================================================
-- Migration: 0023_finance_period_close.sql
-- Wave: 2
-- Phase: Finance
-- Closes: R-W2-PERIOD-01, R-W2-PERIOD-LOCK-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop tg_je_reject_closed_period, close_period,
--   reopen_period, period_close.
--
-- Constitutional alignment:
--   RLS rules          Pattern A. Writes are admin/accounting only.
--   Workflow rules     period_close.status is a TEXT CHECK (open, in_review,
--                      closed, reopened) per AUDIT.md row line 65 OPTIMIZE
--                      from pg enum to text CHECK.
--   Migration rules    Forward-only. Idempotent DDL.
--   Period close rule  tg_je_reject_closed_period BEFORE INSERT/UPDATE on
--                      journal_entries raises SQLSTATE P0001 with stable
--                      message prefix 'period_closed:' so handlers map to 422.
-- ============================================================================

create table if not exists public.period_close (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  period_year integer not null,
  period_month integer not null check (period_month between 1 and 12),
  status text not null default 'open'
    check (status in ('open', 'in_review', 'closed', 'reopened')),
  state_changed_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid,
  reopened_at timestamptz,
  reopened_by uuid,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (org_id, period_year, period_month)
);

create index if not exists period_close_org_year_idx
  on public.period_close (org_id, period_year desc, period_month desc);

alter table public.period_close enable row level security;

drop policy if exists period_close_select on public.period_close;
create policy period_close_select on public.period_close
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists period_close_write on public.period_close;
create policy period_close_write on public.period_close
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting')
  );

-- ---------------------------------------------------------------------------
-- close_period(p_org_id, p_year, p_month): SECURITY DEFINER. Upserts the row
-- in 'closed'. Idempotent (re-close of closed period is a no-op).
-- ---------------------------------------------------------------------------

create or replace function public.close_period(
  p_org_id uuid,
  p_year   integer,
  p_month  integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_year is null or p_month is null
     or p_month < 1 or p_month > 12 then
    raise exception 'VALIDATION_ERROR: invalid period %-%', p_year, p_month
      using errcode = '22023';
  end if;

  insert into public.period_close (org_id, period_year, period_month, status, closed_at)
  values (p_org_id, p_year, p_month, 'closed', now())
  on conflict (org_id, period_year, period_month)
  do update set status = 'closed',
                closed_at = now(),
                updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.close_period(uuid, integer, integer) from public, anon;
grant execute on function public.close_period(uuid, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- reopen_period(p_org_id, p_year, p_month): flips closed -> reopened.
-- ---------------------------------------------------------------------------

create or replace function public.reopen_period(
  p_org_id uuid,
  p_year   integer,
  p_month  integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.period_close
     set status = 'reopened',
         reopened_at = now(),
         updated_at = now()
   where org_id = p_org_id
     and period_year = p_year
     and period_month = p_month
   returning id into v_id;

  if v_id is null then
    raise exception 'NOT_FOUND: period %-% not found for org %', p_year, p_month, p_org_id
      using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;

revoke execute on function public.reopen_period(uuid, integer, integer) from public, anon;
grant execute on function public.reopen_period(uuid, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- tg_je_reject_closed_period: BEFORE INSERT or UPDATE on journal_entries.
-- Rejects writes whose entry_date falls in a closed (not reopened) period.
-- Raises SQLSTATE P0001 with message prefix 'period_closed:' so handler-side
-- code can map to 422 with FEATURE_DISABLED-style messaging.
-- ---------------------------------------------------------------------------

create or replace function public.tg_je_reject_closed_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  -- Only enforce when a row is going posted, or already posted and being
  -- re-stated. A draft JE may live inside any period.
  if tg_op = 'INSERT' then
    if new.status <> 'posted' then return new; end if;
  elsif tg_op = 'UPDATE' then
    if new.status <> 'posted' and old.status <> 'posted' then return new; end if;
  end if;

  select status into v_status
    from public.period_close
   where org_id = new.org_id
     and period_year = new.period_year
     and period_month = new.period_month;

  if v_status = 'closed' then
    raise exception
      'period_closed: cannot post journal entry into closed period %-%',
        new.period_year, new.period_month
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute on function public.tg_je_reject_closed_period() from public, anon;

drop trigger if exists je_reject_closed_period on public.journal_entries;
create trigger je_reject_closed_period
  before insert or update on public.journal_entries
  for each row execute function public.tg_je_reject_closed_period();

-- updated_at stamping trigger for period_close.
create or replace function public.trg_period_close_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.state_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists period_close_set_updated_at on public.period_close;
create trigger period_close_set_updated_at
  before update on public.period_close
  for each row execute function public.trg_period_close_set_updated_at();
