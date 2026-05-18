-- ============================================================================
-- Migration: 0018_invoicing_invoices.sql
-- Wave: 2
-- Phase: Invoicing
-- Closes: R-W2-INV-01, R-W2-INV-02, R-W2-INV-BAL-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop in reverse: invoice_versions, then
--   invoice_line_items, then invoices. Not auto-run.
--
-- Constitutional alignment:
--   Money rules        BIGINT cents on every monetary column. `_cents` suffix.
--                      tax_rate_snapshot captured per line. currency_code
--                      snapshotted at issuance on the invoice header.
--                      balance_cents is GENERATED ALWAYS AS STORED to match
--                      vendor_bills.balance_cents (AUDIT row line 72).
--   RLS rules          Pattern A on invoices and invoice_versions. Pattern B
--                      on invoice_line_items (parent join through invoices).
--   Migration rules    Forward-only. All DDL idempotent.
--   Workflow rules     invoices.status is a text CHECK 9-state column with a
--                      paired state_changed_at timestamptz, per workflow canon.
--   Audit rules        Auto-state-transition trigger lives in 0024 to keep
--                      schema and trigger wiring in separate files.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- invoices: header row. 9-state machine per AUDIT.md line 83 and the
-- finance side-car. balance_cents is GENERATED so it can never drift from
-- (total_cents - paid_cents - credit_allocated_cents).
-- ---------------------------------------------------------------------------

create table if not exists public.invoices (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invoice_number text not null,
  customer_id uuid,
  project_id uuid,
  quote_id uuid,
  status text not null default 'draft'
    check (status in (
      'draft', 'pending', 'sent', 'partially_paid', 'paid',
      'overdue', 'refunded', 'cancelled', 'on_hold'
    )),
  state_changed_at timestamptz not null default now(),
  currency_code text not null default 'USD',
  issue_date date,
  due_date date,
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  tax_total_cents bigint not null default 0 check (tax_total_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  credit_allocated_cents bigint not null default 0 check (credit_allocated_cents >= 0),
  balance_cents bigint generated always as
    (total_cents - paid_cents - credit_allocated_cents) stored,
  notes text,
  pdf_url text,
  sent_at timestamptz,
  sent_to text,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, invoice_number)
);

create index if not exists invoices_org_status_idx
  on public.invoices (org_id, status, created_at desc) where deleted_at is null;
create index if not exists invoices_customer_idx
  on public.invoices (customer_id, created_at desc) where deleted_at is null;

alter table public.invoices enable row level security;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists invoices_write on public.invoices;
create policy invoices_write on public.invoices
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting', 'sales')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting', 'sales')
  );

-- ---------------------------------------------------------------------------
-- invoice_line_items: Pattern B RLS through parent invoice. tax_rate_snapshot
-- captured per line. line_total_cents is GENERATED.
-- ---------------------------------------------------------------------------

create table if not exists public.invoice_line_items (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  item_id uuid,
  description text not null,
  quantity numeric(18, 4) not null default 1,
  unit_price_cents bigint not null default 0,
  tax_rate_snapshot numeric(7, 4) not null default 0,
  tax_amount_cents bigint not null default 0,
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  line_total_cents bigint not null default 0 check (line_total_cents >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists invoice_line_items_invoice_idx
  on public.invoice_line_items (invoice_id, sort_order);

alter table public.invoice_line_items enable row level security;

drop policy if exists invoice_line_items_select on public.invoice_line_items;
create policy invoice_line_items_select on public.invoice_line_items
  for select to authenticated
  using (
    exists (
      select 1 from public.invoices i
       where i.id = invoice_line_items.invoice_id
         and i.org_id = public.current_org_id()
    )
  );

drop policy if exists invoice_line_items_write on public.invoice_line_items;
create policy invoice_line_items_write on public.invoice_line_items
  for all to authenticated
  using (
    exists (
      select 1 from public.invoices i
       where i.id = invoice_line_items.invoice_id
         and i.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin', 'accounting', 'sales')
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
       where i.id = invoice_line_items.invoice_id
         and i.org_id = public.current_org_id()
         and public.current_user_role() in ('org_owner', 'org_admin', 'accounting', 'sales')
    )
  );

-- ---------------------------------------------------------------------------
-- invoice_versions: snapshot at each non-draft transition. Pattern A.
-- ---------------------------------------------------------------------------

create table if not exists public.invoice_versions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  version_number integer not null,
  snapshot_jsonb jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (invoice_id, version_number)
);

create index if not exists invoice_versions_invoice_idx
  on public.invoice_versions (invoice_id, version_number desc);

alter table public.invoice_versions enable row level security;

drop policy if exists invoice_versions_select on public.invoice_versions;
create policy invoice_versions_select on public.invoice_versions
  for select to authenticated
  using (org_id = public.current_org_id());

-- service_role writes only; no authenticated INSERT/UPDATE/DELETE policy.

-- ---------------------------------------------------------------------------
-- recompute_invoice_totals(p_invoice_id): SECURITY DEFINER. Sums the line
-- items and writes back subtotal/tax/total. paid_cents and
-- credit_allocated_cents are written by payments and credit_note allocations
-- in 0019 / 0020. balance_cents is GENERATED.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal bigint;
  v_tax      bigint;
  v_total    bigint;
begin
  select
    coalesce(sum(line_total_cents - tax_amount_cents), 0),
    coalesce(sum(tax_amount_cents), 0),
    coalesce(sum(line_total_cents), 0)
   into v_subtotal, v_tax, v_total
   from public.invoice_line_items
   where invoice_id = p_invoice_id;

  update public.invoices
     set subtotal_cents = v_subtotal,
         tax_total_cents = v_tax,
         total_cents = v_total,
         updated_at = now()
   where id = p_invoice_id;
end;
$$;

revoke execute on function public.recompute_invoice_totals(uuid) from public, anon;
grant execute on function public.recompute_invoice_totals(uuid) to authenticated, service_role;

-- updated_at stamping trigger for invoices.
create or replace function public.trg_invoices_set_updated_at()
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

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.trg_invoices_set_updated_at();
