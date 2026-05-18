-- ============================================================================
-- Migration: 0029_vendors_auto_je_triggers.sql
-- Wave: 2
-- Phase: Auto-journal-entry triggers (Agent E)
-- Closes: R-W2-VENDORS-05
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. drop the three triggers and three functions.
--   Not auto-run.
--
-- Auto-JE triggers for:
--   * vendor_bill approved   -> debit expense / credit AP
--   * vendor_bill paid       -> debit AP / credit cash
--   * expense paid           -> debit expense / credit cash
--
-- All three are EXISTS-guarded on public.journal_entries (Agent C / finance
-- ships that table later) AND gated by per-org flag
-- finance.journal_entries.enabled. With both gates off (no table OR flag off)
-- the trigger is a no-op so this migration is safe to apply in any order
-- against the finance migrations.
--
-- Constitutional alignment:
--   Audit rules        Triggers are the single writer. No best-effort handler
--                      writes. The trigger fires AFTER the state transition
--                      so the audit_log row already records the transition.
--   Migration rules    Forward-only. All DDL idempotent. EXISTS-guarded.
-- ============================================================================

create or replace function public.tg_vendor_bills_je_on_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_je_table_exists boolean;
  v_flag_enabled boolean;
begin
  if new.status is null or new.status = old.status or new.status <> 'approved' then
    return new;
  end if;

  select exists(
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'journal_entries'
  ) into v_je_table_exists;
  if not v_je_table_exists then
    return new;
  end if;

  select coalesce(is_enabled, false) into v_flag_enabled
    from public.org_feature_flags
   where org_id = new.org_id
     and flag_key = 'finance.journal_entries.enabled'
   limit 1;
  if not coalesce(v_flag_enabled, false) then
    return new;
  end if;

  -- Finance bundle is expected to ship a public.fn_post_vendor_bill_je RPC.
  -- EXISTS-guard the call so this migration applies before finance ships.
  if exists(
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_post_vendor_bill_je'
  ) then
    perform public.fn_post_vendor_bill_je(new.id, 'approved');
  end if;

  return new;
end;
$$;

revoke execute on function public.tg_vendor_bills_je_on_approved() from public, anon;

drop trigger if exists vendor_bills_je_on_approved on public.vendor_bills;
create trigger vendor_bills_je_on_approved
  after update of status on public.vendor_bills
  for each row execute function public.tg_vendor_bills_je_on_approved();

create or replace function public.tg_vendor_bills_je_on_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_je_table_exists boolean;
  v_flag_enabled boolean;
begin
  if new.status is null or new.status = old.status
     or new.status not in ('paid', 'partial_paid') then
    return new;
  end if;

  select exists(
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'journal_entries'
  ) into v_je_table_exists;
  if not v_je_table_exists then
    return new;
  end if;

  select coalesce(is_enabled, false) into v_flag_enabled
    from public.org_feature_flags
   where org_id = new.org_id
     and flag_key = 'finance.journal_entries.enabled'
   limit 1;
  if not coalesce(v_flag_enabled, false) then
    return new;
  end if;

  if exists(
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_post_vendor_bill_je'
  ) then
    perform public.fn_post_vendor_bill_je(new.id, new.status);
  end if;

  return new;
end;
$$;

revoke execute on function public.tg_vendor_bills_je_on_paid() from public, anon;

drop trigger if exists vendor_bills_je_on_paid on public.vendor_bills;
create trigger vendor_bills_je_on_paid
  after update of status on public.vendor_bills
  for each row execute function public.tg_vendor_bills_je_on_paid();

create or replace function public.tg_expenses_je_on_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_je_table_exists boolean;
  v_flag_enabled boolean;
begin
  if new.status is null or new.status = old.status
     or new.status not in ('paid', 'reimbursed') then
    return new;
  end if;

  select exists(
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'journal_entries'
  ) into v_je_table_exists;
  if not v_je_table_exists then
    return new;
  end if;

  select coalesce(is_enabled, false) into v_flag_enabled
    from public.org_feature_flags
   where org_id = new.org_id
     and flag_key = 'finance.journal_entries.enabled'
   limit 1;
  if not coalesce(v_flag_enabled, false) then
    return new;
  end if;

  if exists(
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_post_expense_je'
  ) then
    perform public.fn_post_expense_je(new.id, new.status);
  end if;

  return new;
end;
$$;

revoke execute on function public.tg_expenses_je_on_paid() from public, anon;

drop trigger if exists expenses_je_on_paid on public.expenses;
create trigger expenses_je_on_paid
  after update of status on public.expenses
  for each row execute function public.tg_expenses_je_on_paid();
