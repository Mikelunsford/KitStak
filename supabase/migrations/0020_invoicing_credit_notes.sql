-- ============================================================================
-- Migration: 0020_invoicing_credit_notes.sql
-- Wave: 2
-- Phase: Invoicing
-- Closes: R-W2-CN-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop credit_note_allocations then credit_notes.
--
-- Constitutional alignment:
--   Money rules        BIGINT cents. amount_cents and allocations non-negative.
--   RLS rules          Pattern A on credit_notes. Pattern B on allocations.
--   Workflow rules     4-state text CHECK (draft, issued, applied, voided).
--   Migration rules    Forward-only. Idempotent DDL.
-- ============================================================================

create table if not exists public.credit_notes (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  credit_note_number text not null,
  customer_id uuid,
  source_invoice_id uuid references public.invoices(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'applied', 'voided')),
  state_changed_at timestamptz not null default now(),
  currency_code text not null default 'USD',
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  applied_cents bigint not null default 0 check (applied_cents >= 0),
  reason text,
  issued_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, credit_note_number)
);

create index if not exists credit_notes_org_status_idx
  on public.credit_notes (org_id, status, created_at desc) where deleted_at is null;

alter table public.credit_notes enable row level security;

drop policy if exists credit_notes_select on public.credit_notes;
create policy credit_notes_select on public.credit_notes
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists credit_notes_write on public.credit_notes;
create policy credit_notes_write on public.credit_notes
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
-- credit_note_allocations: credit_note_id applies to invoice_id with cents.
-- ---------------------------------------------------------------------------

create table if not exists public.credit_note_allocations (
  id uuid primary key default uuid_generate_v4(),
  credit_note_id uuid not null references public.credit_notes(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (credit_note_id, invoice_id)
);

create index if not exists credit_note_allocations_invoice_idx
  on public.credit_note_allocations (invoice_id);

alter table public.credit_note_allocations enable row level security;

drop policy if exists credit_note_allocations_select on public.credit_note_allocations;
create policy credit_note_allocations_select on public.credit_note_allocations
  for select to authenticated
  using (
    exists (
      select 1 from public.credit_notes cn
       where cn.id = credit_note_allocations.credit_note_id
         and cn.org_id = public.current_org_id()
    )
  );

drop policy if exists credit_note_allocations_write on public.credit_note_allocations;
create policy credit_note_allocations_write on public.credit_note_allocations
  for all to authenticated
  using (
    exists (
      select 1 from public.credit_notes cn
       where cn.id = credit_note_allocations.credit_note_id
         and cn.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin', 'accounting')
    )
  )
  with check (
    exists (
      select 1 from public.credit_notes cn
       where cn.id = credit_note_allocations.credit_note_id
         and cn.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin', 'accounting')
    )
  );

-- ---------------------------------------------------------------------------
-- recompute_credit_note_applied(p_credit_note_id): sums allocations into
-- credit_notes.applied_cents. recompute_invoice_credit_allocated keeps the
-- invoice side in sync.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_credit_note_applied(p_credit_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applied bigint;
begin
  select coalesce(sum(amount_cents), 0)
    into v_applied
    from public.credit_note_allocations
   where credit_note_id = p_credit_note_id;

  update public.credit_notes
     set applied_cents = v_applied,
         updated_at = now()
   where id = p_credit_note_id;
end;
$$;

revoke execute on function public.recompute_credit_note_applied(uuid) from public, anon;
grant execute on function public.recompute_credit_note_applied(uuid) to authenticated, service_role;

create or replace function public.recompute_invoice_credit_allocated(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alloc bigint;
begin
  select coalesce(sum(amount_cents), 0)
    into v_alloc
    from public.credit_note_allocations
   where invoice_id = p_invoice_id;

  update public.invoices
     set credit_allocated_cents = v_alloc,
         updated_at = now()
   where id = p_invoice_id;
end;
$$;

revoke execute on function public.recompute_invoice_credit_allocated(uuid) from public, anon;
grant execute on function public.recompute_invoice_credit_allocated(uuid) to authenticated, service_role;

create or replace function public.trg_credit_note_allocations_recompute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cn_id      uuid;
  v_invoice_id uuid;
begin
  if tg_op = 'DELETE' then
    v_cn_id := old.credit_note_id;
    v_invoice_id := old.invoice_id;
  else
    v_cn_id := new.credit_note_id;
    v_invoice_id := new.invoice_id;
  end if;

  perform public.recompute_credit_note_applied(v_cn_id);
  perform public.recompute_invoice_credit_allocated(v_invoice_id);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists credit_note_allocations_recompute on public.credit_note_allocations;
create trigger credit_note_allocations_recompute
  after insert or update or delete on public.credit_note_allocations
  for each row execute function public.trg_credit_note_allocations_recompute();
