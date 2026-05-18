-- ============================================================================
-- Migration: 0021_finance_coa.sql
-- Wave: 2
-- Phase: Finance
-- Closes: R-W2-COA-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop seed_org_chart_of_accounts function,
--   then chart_of_accounts. Not auto-run.
--
-- Constitutional alignment:
--   Money rules        BIGINT cents on balance projections downstream; this
--                      table itself is metadata only.
--   RLS rules          Pattern A on chart_of_accounts.
--   Migration rules    Forward-only. Idempotent DDL.
-- ============================================================================

create table if not exists public.chart_of_accounts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  account_type text not null
    check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_account_id uuid references public.chart_of_accounts(id) on delete set null,
  is_active boolean not null default true,
  is_system boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (org_id, code)
);

create index if not exists chart_of_accounts_org_type_idx
  on public.chart_of_accounts (org_id, account_type, code) where is_active;

alter table public.chart_of_accounts enable row level security;

drop policy if exists chart_of_accounts_select on public.chart_of_accounts;
create policy chart_of_accounts_select on public.chart_of_accounts
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists chart_of_accounts_write on public.chart_of_accounts;
create policy chart_of_accounts_write on public.chart_of_accounts
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
-- seed_org_chart_of_accounts(p_org_id): SECURITY DEFINER. Seeds 13 default
-- rows. Idempotent (on conflict (org_id, code) do nothing).
-- ---------------------------------------------------------------------------

create or replace function public.seed_org_chart_of_accounts(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.chart_of_accounts (org_id, code, name, account_type, is_system)
  values
    (p_org_id, '1000', 'Cash',                        'asset',     true),
    (p_org_id, '1200', 'Accounts Receivable',         'asset',     true),
    (p_org_id, '1400', 'Inventory',                   'asset',     true),
    (p_org_id, '1500', 'Prepaid Expenses',            'asset',     true),
    (p_org_id, '2000', 'Accounts Payable',            'liability', true),
    (p_org_id, '2100', 'Sales Tax Payable',           'liability', true),
    (p_org_id, '2200', 'Accrued Liabilities',         'liability', true),
    (p_org_id, '3000', 'Owner Equity',                'equity',    true),
    (p_org_id, '3100', 'Retained Earnings',           'equity',    true),
    (p_org_id, '4000', 'Sales Revenue',               'revenue',   true),
    (p_org_id, '4100', 'Service Revenue',             'revenue',   true),
    (p_org_id, '5000', 'Cost of Goods Sold',          'expense',   true),
    (p_org_id, '6000', 'Operating Expenses',          'expense',   true)
  on conflict (org_id, code) do nothing;
end;
$$;

revoke execute on function public.seed_org_chart_of_accounts(uuid) from public, anon;
grant execute on function public.seed_org_chart_of_accounts(uuid) to authenticated, service_role;
