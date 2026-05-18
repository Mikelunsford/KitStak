-- ============================================================================
-- Migration: 0019_invoicing_payments.sql
-- Wave: 2
-- Phase: Invoicing
-- Closes: R-W2-PAY-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop payment_allocations then payments. Not auto-run.
--
-- Constitutional alignment:
--   Money rules        BIGINT cents. allocated_cents non-negative. Currency
--                      snapshotted on payment header.
--   RLS rules          Pattern A on payments. Pattern B on allocations.
--   Migration rules    Forward-only. Idempotent DDL.
--   Audit rules        recompute_invoice_paid keeps invoices.paid_cents in
--                      sync with the sum of allocations. Auto-JE trigger
--                      installed in 0024.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- payments: a customer payment. May be unapplied (allocations empty) until
-- the user runs /payments/:id/apply.
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  payment_number text not null,
  customer_id uuid,
  amount_cents bigint not null check (amount_cents > 0),
  currency_code text not null default 'USD',
  payment_method text,
  reference_number text,
  received_at timestamptz not null default now(),
  notes text,
  unapplied_cents bigint not null default 0 check (unapplied_cents >= 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, payment_number)
);

create index if not exists payments_org_received_idx
  on public.payments (org_id, received_at desc) where deleted_at is null;

alter table public.payments enable row level security;

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists payments_write on public.payments;
create policy payments_write on public.payments
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
-- payment_allocations: payment_id splits into N invoice_ids with cents each.
-- Pattern B via payments parent.
-- ---------------------------------------------------------------------------

create table if not exists public.payment_allocations (
  id uuid primary key default uuid_generate_v4(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (payment_id, invoice_id)
);

create index if not exists payment_allocations_invoice_idx
  on public.payment_allocations (invoice_id);
create index if not exists payment_allocations_payment_idx
  on public.payment_allocations (payment_id);

alter table public.payment_allocations enable row level security;

drop policy if exists payment_allocations_select on public.payment_allocations;
create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using (
    exists (
      select 1 from public.payments p
       where p.id = payment_allocations.payment_id
         and p.org_id = public.current_org_id()
    )
  );

drop policy if exists payment_allocations_write on public.payment_allocations;
create policy payment_allocations_write on public.payment_allocations
  for all to authenticated
  using (
    exists (
      select 1 from public.payments p
       where p.id = payment_allocations.payment_id
         and p.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin', 'accounting')
    )
  )
  with check (
    exists (
      select 1 from public.payments p
       where p.id = payment_allocations.payment_id
         and p.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin', 'accounting')
    )
  );

-- ---------------------------------------------------------------------------
-- recompute_invoice_paid(p_invoice_id): rolls payment_allocations into
-- invoices.paid_cents. balance_cents is GENERATED so the update implicitly
-- reshapes the balance.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_invoice_paid(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid bigint;
begin
  select coalesce(sum(amount_cents), 0)
    into v_paid
    from public.payment_allocations
   where invoice_id = p_invoice_id;

  update public.invoices
     set paid_cents = v_paid,
         updated_at = now()
   where id = p_invoice_id;
end;
$$;

revoke execute on function public.recompute_invoice_paid(uuid) from public, anon;
grant execute on function public.recompute_invoice_paid(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Trigger: keep unapplied_cents in sync on payments when allocations change.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_payment_unapplied(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount bigint;
  v_allocated bigint;
begin
  select amount_cents into v_amount
    from public.payments where id = p_payment_id;

  select coalesce(sum(amount_cents), 0)
    into v_allocated
    from public.payment_allocations
   where payment_id = p_payment_id;

  update public.payments
     set unapplied_cents = v_amount - v_allocated,
         updated_at = now()
   where id = p_payment_id;
end;
$$;

revoke execute on function public.recompute_payment_unapplied(uuid) from public, anon;
grant execute on function public.recompute_payment_unapplied(uuid) to authenticated, service_role;

create or replace function public.trg_payment_allocations_recompute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_invoice_id uuid;
begin
  if tg_op = 'DELETE' then
    v_payment_id := old.payment_id;
    v_invoice_id := old.invoice_id;
  else
    v_payment_id := new.payment_id;
    v_invoice_id := new.invoice_id;
  end if;

  perform public.recompute_invoice_paid(v_invoice_id);
  perform public.recompute_payment_unapplied(v_payment_id);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists payment_allocations_recompute on public.payment_allocations;
create trigger payment_allocations_recompute
  after insert or update or delete on public.payment_allocations
  for each row execute function public.trg_payment_allocations_recompute();
