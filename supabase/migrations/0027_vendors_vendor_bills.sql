-- ============================================================================
-- Migration: 0027_vendors_vendor_bills.sql
-- Wave: 2
-- Phase: Vendor bills + payments (Agent E)
-- Closes: R-W2-VENDORS-03
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. drop trigger, then vendor_bill_payments,
--   then vendor_bills. Not auto-run.
--
-- Constitutional alignment:
--   RLS rules         vendor_bills Pattern A. vendor_bill_payments Pattern B.
--   Money rules       BIGINT cents on every monetary column. balance_cents
--                     is GENERATED ALWAYS AS (total_cents - paid_cents).
--                     paid_cents is a denormalised sum maintained by trigger
--                     so the GENERATED column is deterministic on read.
--   Migration rules   Forward-only. All DDL idempotent.
--   Audit rules       vendor_bills.status writes audit_log via trigger.
-- ============================================================================

create table if not exists public.vendor_bills (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  bill_number text,
  vendor_id uuid not null references public.vendors(id),
  purchase_order_id uuid references public.purchase_orders(id),
  status text not null default 'draft'
    check (status in (
      'draft', 'submitted', 'approved',
      'partial_paid', 'paid', 'closed', 'cancelled'
    )),
  currency_code text not null default 'USD',
  bill_date date not null default current_date,
  due_date date,
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  paid_cents bigint not null default 0,
  balance_cents bigint generated always as (total_cents - paid_cents) stored,
  notes text,
  reference text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, bill_number)
);

create index if not exists vendor_bills_org_idx
  on public.vendor_bills (org_id)
  where deleted_at is null;

create index if not exists vendor_bills_org_status_idx
  on public.vendor_bills (org_id, status)
  where deleted_at is null;

create index if not exists vendor_bills_vendor_idx
  on public.vendor_bills (vendor_id)
  where deleted_at is null;

alter table public.vendor_bills enable row level security;

drop policy if exists vendor_bills_select on public.vendor_bills;
create policy vendor_bills_select on public.vendor_bills
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists vendor_bills_write on public.vendor_bills;
create policy vendor_bills_write on public.vendor_bills
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
-- vendor_bill_payments: Pattern B.
-- ---------------------------------------------------------------------------

create table if not exists public.vendor_bill_payments (
  id uuid primary key default uuid_generate_v4(),
  vendor_bill_id uuid not null references public.vendor_bills(id) on delete cascade,
  payment_date date not null default current_date,
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  currency_code text not null default 'USD',
  method text,
  reference text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists vendor_bill_payments_bill_idx
  on public.vendor_bill_payments (vendor_bill_id);

alter table public.vendor_bill_payments enable row level security;

drop policy if exists vendor_bill_payments_select on public.vendor_bill_payments;
create policy vendor_bill_payments_select on public.vendor_bill_payments
  for select to authenticated
  using (
    exists (
      select 1 from public.vendor_bills vb
       where vb.id = vendor_bill_payments.vendor_bill_id
         and vb.org_id = public.current_org_id()
    )
  );

drop policy if exists vendor_bill_payments_write on public.vendor_bill_payments;
create policy vendor_bill_payments_write on public.vendor_bill_payments
  for all to authenticated
  using (
    exists (
      select 1 from public.vendor_bills vb
       where vb.id = vendor_bill_payments.vendor_bill_id
         and vb.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin', 'accounting')
    )
  )
  with check (
    exists (
      select 1 from public.vendor_bills vb
       where vb.id = vendor_bill_payments.vendor_bill_id
         and vb.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin', 'accounting')
    )
  );

-- ---------------------------------------------------------------------------
-- recompute_vendor_bill_paid: maintain paid_cents on parent.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_vendor_bill_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill_id uuid;
  v_paid bigint;
begin
  v_bill_id := coalesce(new.vendor_bill_id, old.vendor_bill_id);
  if v_bill_id is null then
    return coalesce(new, old);
  end if;

  select coalesce(sum(amount_cents), 0) into v_paid
    from public.vendor_bill_payments
   where vendor_bill_id = v_bill_id;

  update public.vendor_bills
     set paid_cents = v_paid,
         updated_at = now()
   where id = v_bill_id;

  return coalesce(new, old);
end;
$$;

revoke execute on function public.recompute_vendor_bill_paid() from public, anon;

drop trigger if exists recompute_vendor_bill_paid_aiud on public.vendor_bill_payments;
create trigger recompute_vendor_bill_paid_aiud
  after insert or update or delete on public.vendor_bill_payments
  for each row execute function public.recompute_vendor_bill_paid();

-- ---------------------------------------------------------------------------
-- Audit state-change trigger for vendor_bills.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_vendor_bills_status()
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
    'entity_type',  'vendor_bill',
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
    new.org_id, 'vendor_bill', new.id,
    old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );

  return new;
end;
$$;

revoke execute on function public.trg_audit_vendor_bills_status() from public, anon;

drop trigger if exists audit_vendor_bills_status on public.vendor_bills;
create trigger audit_vendor_bills_status
  after update of status on public.vendor_bills
  for each row execute function public.trg_audit_vendor_bills_status();
