-- ============================================================================
-- Migration: 0022_finance_journal_entries.sql
-- Wave: 2
-- Phase: Finance
-- Closes: R-W2-JE-01, R-W2-JE-BAL-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop post_journal_entry, check_journal_balance,
--   journal_entry_lines, journal_entries.
--
-- Constitutional alignment:
--   Money rules        BIGINT cents. SUM(debit_cents) = SUM(credit_cents)
--                      enforced at post time by check_journal_balance.
--   RLS rules          Pattern A on journal_entries. Pattern B on lines.
--   Workflow rules     3-state text CHECK (draft, posted, reversed).
--   Migration rules    Forward-only. Idempotent DDL.
--   Auto-JE rule       The post_journal_entry RPC is the only writer the SPA
--                      uses; auto-JE triggers in 0024 call the same code path
--                      so handlers never insert JEs directly.
-- ============================================================================

create table if not exists public.journal_entries (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entry_number text not null,
  entry_date date not null default current_date,
  period_year integer not null,
  period_month integer not null check (period_month between 1 and 12),
  status text not null default 'draft'
    check (status in ('draft', 'posted', 'reversed')),
  state_changed_at timestamptz not null default now(),
  source_type text not null default 'manual'
    check (source_type in (
      'invoice', 'payment', 'expense', 'credit_note',
      'vendor_bill', 'vendor_bill_payment', 'manual'
    )),
  source_id uuid,
  memo text,
  posted_at timestamptz,
  reversed_at timestamptz,
  reversal_of_id uuid references public.journal_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (org_id, entry_number)
);

create index if not exists journal_entries_org_period_idx
  on public.journal_entries (org_id, period_year, period_month, status);
create index if not exists journal_entries_source_idx
  on public.journal_entries (source_type, source_id, status);

alter table public.journal_entries enable row level security;

drop policy if exists journal_entries_select on public.journal_entries;
create policy journal_entries_select on public.journal_entries
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists journal_entries_write on public.journal_entries;
create policy journal_entries_write on public.journal_entries
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
-- journal_entry_lines: one debit XOR credit non-zero per line.
-- ---------------------------------------------------------------------------

create table if not exists public.journal_entry_lines (
  id uuid primary key default uuid_generate_v4(),
  entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
  debit_cents bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  memo text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  -- one side non-zero, the other zero. Both-zero rows are noise.
  check (
    (debit_cents > 0 and credit_cents = 0)
    or (debit_cents = 0 and credit_cents > 0)
  )
);

create index if not exists journal_entry_lines_entry_idx
  on public.journal_entry_lines (entry_id, sort_order);
create index if not exists journal_entry_lines_account_idx
  on public.journal_entry_lines (account_id);

alter table public.journal_entry_lines enable row level security;

drop policy if exists journal_entry_lines_select on public.journal_entry_lines;
create policy journal_entry_lines_select on public.journal_entry_lines
  for select to authenticated
  using (
    exists (
      select 1 from public.journal_entries je
       where je.id = journal_entry_lines.entry_id
         and je.org_id = public.current_org_id()
    )
  );

drop policy if exists journal_entry_lines_write on public.journal_entry_lines;
create policy journal_entry_lines_write on public.journal_entry_lines
  for all to authenticated
  using (
    exists (
      select 1 from public.journal_entries je
       where je.id = journal_entry_lines.entry_id
         and je.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin', 'accounting')
    )
  )
  with check (
    exists (
      select 1 from public.journal_entries je
       where je.id = journal_entry_lines.entry_id
         and je.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin', 'accounting')
    )
  );

-- ---------------------------------------------------------------------------
-- check_journal_balance(entry_id): asserts SUM(debit) = SUM(credit). Raises
-- VALIDATION_ERROR / 22023 when mismatched so the API layer can translate to
-- a 422 envelope.
-- ---------------------------------------------------------------------------

create or replace function public.check_journal_balance(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debit  bigint;
  v_credit bigint;
begin
  select coalesce(sum(debit_cents), 0),
         coalesce(sum(credit_cents), 0)
    into v_debit, v_credit
    from public.journal_entry_lines
   where entry_id = p_entry_id;

  if v_debit is null or v_credit is null or v_debit <> v_credit then
    raise exception
      'VALIDATION_ERROR: journal entry % is unbalanced (debit=%, credit=%)',
        p_entry_id, v_debit, v_credit
      using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.check_journal_balance(uuid) from public, anon;
grant execute on function public.check_journal_balance(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- post_journal_entry(p_entry_id): flips status draft -> posted. Calls
-- check_journal_balance. Stamps posted_at.
-- ---------------------------------------------------------------------------

create or replace function public.post_journal_entry(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.journal_entries
   where id = p_entry_id;
  if v_status is null then
    raise exception 'NOT_FOUND: journal_entry % missing', p_entry_id
      using errcode = 'P0002';
  end if;
  if v_status = 'posted' then
    return p_entry_id;
  end if;
  if v_status <> 'draft' then
    raise exception 'STATE_CONFLICT: cannot post from status %', v_status
      using errcode = 'P0001';
  end if;

  perform public.check_journal_balance(p_entry_id);

  update public.journal_entries
     set status = 'posted',
         posted_at = now(),
         updated_at = now()
   where id = p_entry_id;

  return p_entry_id;
end;
$$;

revoke execute on function public.post_journal_entry(uuid) from public, anon;
grant execute on function public.post_journal_entry(uuid) to authenticated, service_role;

-- updated_at stamping trigger for journal_entries.
create or replace function public.trg_journal_entries_set_updated_at()
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

drop trigger if exists journal_entries_set_updated_at on public.journal_entries;
create trigger journal_entries_set_updated_at
  before update on public.journal_entries
  for each row execute function public.trg_journal_entries_set_updated_at();
