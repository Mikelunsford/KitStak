-- ============================================================================
-- Migration: 0028_vendors_expenses.sql
-- Wave: 2
-- Phase: Expenses + categories (Agent E)
-- Closes: R-W2-VENDORS-04
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. drop trigger, then expenses, then
--   expense_categories. Not auto-run.
--
-- Constitutional alignment:
--   RLS rules         Pattern A on both. Expense categories are tenant-scoped
--                     so each org curates its own chart.
--   Money rules       BIGINT cents on every monetary column.
--   Migration rules   Forward-only. All DDL idempotent. State machine is a
--                     text CHECK, not a pg enum.
--   Audit rules       expenses.status writes audit_log via trigger.
-- ============================================================================

create table if not exists public.expense_categories (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  display_name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (org_id, code)
);

create index if not exists expense_categories_org_idx
  on public.expense_categories (org_id);

alter table public.expense_categories enable row level security;

drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists expense_categories_write on public.expense_categories;
create policy expense_categories_write on public.expense_categories
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting')
  );

create table if not exists public.expenses (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  expense_number text,
  expense_category_id uuid references public.expense_categories(id),
  vendor_id uuid references public.vendors(id),
  submitter_user_id uuid,
  status text not null default 'draft'
    check (status in (
      'draft', 'submitted', 'approved',
      'paid', 'reimbursed', 'rejected'
    )),
  currency_code text not null default 'USD',
  expense_date date not null default current_date,
  description text,
  amount_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  reimbursable boolean not null default false,
  receipt_url text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, expense_number)
);

create index if not exists expenses_org_idx
  on public.expenses (org_id)
  where deleted_at is null;

create index if not exists expenses_org_status_idx
  on public.expenses (org_id, status)
  where deleted_at is null;

alter table public.expenses enable row level security;

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists expenses_write on public.expenses;
create policy expenses_write on public.expenses
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting', 'ops')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting', 'ops')
  );

-- ---------------------------------------------------------------------------
-- Audit state-change trigger for expenses.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_expenses_status()
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
   order by triggered_at desc, id desc
   limit 1;

  v_payload := jsonb_build_object(
    'org_id',       new.org_id,
    'entity_type',  'expense',
    'entity_id',    new.id,
    'from_state',   old.status,
    'to_state',     new.status,
    'action',       'status_change',
    'triggered_by', v_triggered_by,
    'diff_json',    jsonb_build_object(
                       'status', jsonb_build_object('from', old.status, 'to', new.status)
                    ),
    'prev_hash',    v_prev_hash
  );

  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'),
    'hex'
  );

  insert into public.audit_log (
    org_id, entity_type, entity_id,
    from_state, to_state, action,
    triggered_by, diff_json,
    prev_hash, payload_hash
  ) values (
    new.org_id, 'expense', new.id,
    old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );

  return new;
end;
$$;

revoke execute on function public.trg_audit_expenses_status() from public, anon;

drop trigger if exists audit_expenses_status on public.expenses;
create trigger audit_expenses_status
  after update of status on public.expenses
  for each row execute function public.trg_audit_expenses_status();
