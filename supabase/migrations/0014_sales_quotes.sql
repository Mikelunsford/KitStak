-- ============================================================================
-- Migration: 0014_sales_quotes.sql
-- Wave: 2
-- Phase: Sales chassis (quotes, quote_line_items)
-- Closes: R-W2-QUOTES-01, R-W2-QUOTE-LINES-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop quote_line_items, quotes in reverse
--   dependency order. Not auto-run.
--
-- Constitutional alignment:
--   Workflow rules     6-state quote FSM (draft, submitted, revise_requested,
--                      approved, project_pending, cancelled). Paired
--                      <state>_at timestamptz columns per state. CHECK
--                      constraint on state column. Auto-state-transition
--                      trigger lives in 0017.
--   Money rules        All money columns BIGINT cents with _cents suffix.
--                      Currency snapshotted on quote via currency_code.
--                      tax_rate_snapshot captured per quote_line_item insert.
--   RLS rules          Pattern A on quotes; Pattern B parent-join on
--                      quote_line_items.
--   Audit rules        Triggers in 0017 write to audit_log on state change.
--   Migration rules    Forward-only. All DDL idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- quotes: top-level sales document. 6-state machine per TS1 pattern.
-- ---------------------------------------------------------------------------

create table if not exists public.quotes (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  number text not null,
  customer_id uuid,
  state text not null default 'draft'
    check (state in (
      'draft', 'submitted', 'revise_requested',
      'approved', 'project_pending', 'cancelled'
    )),

  -- paired state timestamps. populated by 0017 trigger on transition.
  submitted_at timestamptz,
  revise_requested_at timestamptz,
  approved_at timestamptz,
  project_pending_at timestamptz,
  cancelled_at timestamptz,

  title text,
  description text,
  expiration_date date,

  currency_code text not null default 'USD' references public.currencies(code),
  exchange_rate_e9 bigint,

  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),

  default_tax_id uuid references public.taxes(id) on delete set null,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  pricing_tier_id uuid references public.pricing_tiers(id) on delete set null,

  requires_approval boolean not null default false,
  notes text,
  internal_notes text,

  sent_at timestamptz,
  accepted_at timestamptz,
  converted_to_project_id uuid,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, number)
);

create index if not exists quotes_org_state_idx
  on public.quotes (org_id, state) where deleted_at is null;
create index if not exists quotes_org_customer_idx
  on public.quotes (org_id, customer_id) where deleted_at is null;
create index if not exists quotes_created_idx
  on public.quotes (org_id, created_at desc) where deleted_at is null;

alter table public.quotes enable row level security;

drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists quotes_write on public.quotes;
create policy quotes_write on public.quotes
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'accounting')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'sales', 'accounting')
  );

-- ---------------------------------------------------------------------------
-- quote_line_items: Pattern B parent-join. RLS resolves via quotes.org_id.
-- tax_rate_snapshot is captured at insert; subsequent edits to taxes do not
-- mutate previously-snapshotted lines.
-- ---------------------------------------------------------------------------

create table if not exists public.quote_line_items (
  id uuid primary key default uuid_generate_v4(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  position integer not null default 0,
  item_id uuid references public.items(id) on delete set null,
  vas_id uuid references public.value_added_services(id) on delete set null,

  sku text,
  name text not null,
  description text,
  kind text not null default 'item'
    check (kind in ('item', 'vas', 'discount', 'note')),

  quantity_e3 bigint not null default 1000 check (quantity_e3 >= 0),
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  discount_bps integer not null default 0
    check (discount_bps >= 0 and discount_bps <= 100000),
  tax_id uuid references public.taxes(id) on delete set null,
  tax_rate_snapshot integer not null default 0
    check (tax_rate_snapshot >= 0 and tax_rate_snapshot <= 100000),
  is_taxable boolean not null default true,

  line_subtotal_cents bigint not null default 0 check (line_subtotal_cents >= 0),
  line_discount_cents bigint not null default 0 check (line_discount_cents >= 0),
  line_tax_cents bigint not null default 0 check (line_tax_cents >= 0),
  line_total_cents bigint not null default 0 check (line_total_cents >= 0),

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists quote_line_items_quote_idx
  on public.quote_line_items (quote_id, position);

alter table public.quote_line_items enable row level security;

drop policy if exists quote_line_items_select on public.quote_line_items;
create policy quote_line_items_select on public.quote_line_items
  for select to authenticated
  using (
    exists (
      select 1 from public.quotes q
       where q.id = quote_line_items.quote_id
         and q.org_id = public.current_org_id()
    )
  );

drop policy if exists quote_line_items_write on public.quote_line_items;
create policy quote_line_items_write on public.quote_line_items
  for all to authenticated
  using (
    exists (
      select 1 from public.quotes q
       where q.id = quote_line_items.quote_id
         and q.org_id = public.current_org_id()
         and public.current_user_role() in
             ('org_owner', 'org_admin', 'sales', 'accounting')
    )
  )
  with check (
    exists (
      select 1 from public.quotes q
       where q.id = quote_line_items.quote_id
         and q.org_id = public.current_org_id()
         and public.current_user_role() in
             ('org_owner', 'org_admin', 'sales', 'accounting')
    )
  );

-- ---------------------------------------------------------------------------
-- Snapshot trigger: on insert, if tax_rate_snapshot is zero AND tax_id is set,
-- copy the tax's current rate_bps onto the line. This guarantees later edits
-- to public.taxes do not retro-mutate historical line tax math.
-- ---------------------------------------------------------------------------

create or replace function public.trg_snapshot_quote_line_tax()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate integer;
begin
  if new.tax_id is null then
    return new;
  end if;
  -- Only snapshot if caller did not provide an explicit non-zero rate.
  -- A caller-supplied rate beats the lookup, allowing back-dated imports.
  if new.tax_rate_snapshot is not null and new.tax_rate_snapshot > 0 then
    return new;
  end if;
  select rate_bps into v_rate
    from public.taxes
   where id = new.tax_id;
  if v_rate is not null then
    new.tax_rate_snapshot := v_rate;
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_snapshot_quote_line_tax() from public, anon;

drop trigger if exists snapshot_quote_line_tax on public.quote_line_items;
create trigger snapshot_quote_line_tax
  before insert on public.quote_line_items
  for each row execute function public.trg_snapshot_quote_line_tax();
