-- ============================================================================
-- Migration: 0144_rate_cards_and_estimates.sql
-- Wave: Estimate Engine + Job Builder (ADR 0006), Phase 1a (schema foundation)
-- Phase: Per-org rate cards (the Estimate Engine's pricing source) and draft
--   estimates (a saved work-in-progress estimate that converts into a quote).
--   This phase lands schema + RLS only; the edge handlers and the wizard build
--   on top in later increments.
-- Closes: ADR 0006 P1 schema (operator decision 2026-06-29: draft estimates
--   that convert; new per-org rate card with editor).
-- Date: 2026-06-29
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   drop trigger if exists audit_estimates on public.estimates;
--   drop function if exists public.trg_audit_estimates();
--   drop table if exists public.estimates;
--   drop table if exists public.rate_card_lines;
--   drop table if exists public.rate_cards;
--   -- audit_log_entity_type_check keeps 'estimate' (a harmless superset).
--
-- Constitutional alignment:
--   Money rules        Rate-card rates are stored as rate_micros: a BIGINT in
--                      millionths of a currency unit, so sub-cent per-unit rates
--                      survive precisely. Estimate snapshot totals are BIGINT
--                      cents (subtotal_cents / total_cents), never floats. The
--                      Estimate Engine computes every line total with banker's
--                      rounding into cents before it is written or converted to a
--                      quote. currency_code is snapshotted on the estimate.
--   RLS rules          Pattern A on all three tables (org_id = current_org_id()).
--                      rate_cards / rate_card_lines are config the operator edits,
--                      so authenticated SELECT plus INSERT/UPDATE/DELETE scoped to
--                      the caller org with a role gate via current setting on the
--                      edge (the SPA mirrors for hiding). estimates are tenant
--                      business records: authenticated SELECT and INSERT for the
--                      caller org; lifecycle (convert/cancel) is driven through
--                      the service role, so no authenticated UPDATE/DELETE policy.
--   Audit rules        estimates has a state machine (draft -> converted /
--                      cancelled), so it carries an auto-state-transition audit
--                      trigger writing through audit_append_state_change; the
--                      INSERT branch records creation. rate_cards / rate_card_lines
--                      are reference/config data with no lifecycle and are not
--                      audited, consistent with units / item_categories.
--   Migration rules    Forward-only. All DDL idempotent (IF NOT EXISTS, guarded
--                      constraint swap, drop-then-create trigger).
--   State machine      estimates.status: draft -> converted, draft -> cancelled.
--                      converted / cancelled are terminal. Enforced by CHECK.
--   Constraint         audit_log_entity_type_check extended with 'estimate' as a
--                      strict superset of the existing list.
--   Seed               One default rate card per existing org, populated from the
--                      app DEFAULT_RATE_CARD values (rate_micros). Idempotent; a
--                      no-op for orgs that already have a rate card.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- rate_cards: a per-org card of editable rates the Estimate Engine prices on.
-- ---------------------------------------------------------------------------

create table if not exists public.rate_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  currency_code text not null default 'USD',
  is_default boolean not null default false,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

-- At most one default card per org (among live cards).
create unique index if not exists rate_cards_one_default_per_org
  on public.rate_cards(org_id)
  where is_default and deleted_at is null;
create index if not exists rate_cards_org_idx
  on public.rate_cards(org_id) where deleted_at is null;

alter table public.rate_cards enable row level security;

drop policy if exists rate_cards_select on public.rate_cards;
create policy rate_cards_select on public.rate_cards
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists rate_cards_insert on public.rate_cards;
create policy rate_cards_insert on public.rate_cards
  for insert to authenticated
  with check (org_id = public.current_org_id());

drop policy if exists rate_cards_update on public.rate_cards;
create policy rate_cards_update on public.rate_cards
  for update to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ---------------------------------------------------------------------------
-- rate_card_lines: the rate rows. rate_micros = millionths of a currency unit.
-- ---------------------------------------------------------------------------

create table if not exists public.rate_card_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rate_card_id uuid not null references public.rate_cards(id) on delete cascade,
  code text not null,
  group_key text not null default 'constants',
  label text not null,
  rate_micros bigint not null default 0 check (rate_micros >= 0),
  uom text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create unique index if not exists rate_card_lines_card_code_uniq
  on public.rate_card_lines(rate_card_id, code);
create index if not exists rate_card_lines_card_idx
  on public.rate_card_lines(rate_card_id, position);

alter table public.rate_card_lines enable row level security;

drop policy if exists rate_card_lines_select on public.rate_card_lines;
create policy rate_card_lines_select on public.rate_card_lines
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists rate_card_lines_insert on public.rate_card_lines;
create policy rate_card_lines_insert on public.rate_card_lines
  for insert to authenticated
  with check (org_id = public.current_org_id());

drop policy if exists rate_card_lines_update on public.rate_card_lines;
create policy rate_card_lines_update on public.rate_card_lines
  for update to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

drop policy if exists rate_card_lines_delete on public.rate_card_lines;
create policy rate_card_lines_delete on public.rate_card_lines
  for delete to authenticated
  using (org_id = public.current_org_id());

-- ---------------------------------------------------------------------------
-- estimates: a saved draft estimate. Holds the classification + pricing inputs
-- and a computed totals snapshot; the full line breakdown is recomputed from
-- inputs + rate card on read. Converts into a quote (converted_to_quote_id).
-- ---------------------------------------------------------------------------

create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  number text,
  name text not null,
  customer_id uuid references public.customers(id) on delete set null,
  rate_card_id uuid references public.rate_cards(id) on delete set null,
  family text not null,
  engine text not null,
  currency_code text not null default 'USD',
  status text not null default 'draft'
    check (status in ('draft', 'converted', 'cancelled')),
  -- The typed EstimateInput (classification + pricing inputs).
  inputs jsonb not null default '{}'::jsonb,
  -- Computed snapshot, BIGINT cents, for list display. The detail view
  -- recomputes the full breakdown from inputs + the rate card.
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  min_applied boolean not null default false,
  converted_to_quote_id uuid references public.quotes(id) on delete set null,
  converted_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (org_id, number)
);

create index if not exists estimates_org_status_idx
  on public.estimates(org_id, status) where deleted_at is null;
create index if not exists estimates_org_created_idx
  on public.estimates(org_id, created_at desc);

alter table public.estimates enable row level security;

drop policy if exists estimates_select on public.estimates;
create policy estimates_select on public.estimates
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists estimates_insert on public.estimates;
create policy estimates_insert on public.estimates
  for insert to authenticated
  with check (
    org_id = public.current_org_id()
    and created_by = auth.uid()
  );

drop policy if exists estimates_update on public.estimates;
create policy estimates_update on public.estimates
  for update to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- ---------------------------------------------------------------------------
-- Audit: register 'estimate' as an auditable entity, then attach the state-
-- transition trigger. Strict superset of the current entity_type CHECK.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.audit_log'::regclass
       and conname  = 'audit_log_entity_type_check'
  ) then
    alter table public.audit_log
      drop constraint audit_log_entity_type_check;
  end if;
end$$;

alter table public.audit_log
  add constraint audit_log_entity_type_check
  check (entity_type in (
    'organization', 'org_membership', 'customer', 'contact', 'activity',
    'lead', 'opportunity', 'item', 'quote', 'quote_line_item', 'project',
    'project_phase', 'project_line_item', 'invoice', 'invoice_line_item',
    'payment', 'credit_note', 'journal_entry', 'period_close', 'vendor',
    'purchase_order', 'po_line_item', 'vendor_bill', 'expense', 'warehouse',
    'stock_movement', 'receiving_order', 'production_run', 'shipment',
    'attachment', 'comment', 'notification', 'manufacturing_run',
    'manufacturing_run_consumed_line_item', 'manufacturing_run_produced_line_item',
    'sales_channel', 'sales_order', 'sales_order_line_item', 'kitting_job',
    'kitting_job_consumed_line_item', 'kitting_job_produced_line_item',
    'fulfillment', 'workforce_member', 'workforce_team', 'workforce_team_member',
    'shift', 'work_assignment', 'time_entry', 'three_pl_account',
    'account_service_definition', 'job_template', 'job_template_line',
    'supply_plan', 'supply_plan_line', 'job_run', 'job_run_daily_log',
    'job_run_daily_log_consumed_line_item', 'job_run_daily_log_produced_line_item',
    'billing_review', 'warehouse_location', 'putaway_task', 'lot',
    'recurring_schedule', 'quote_tier', 'support_ticket', 'estimate'
  ));

create or replace function public.trg_audit_estimates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
  v_entity_id uuid;
  v_from text;
  v_to text;
  v_action text;
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    v_org_id := new.org_id; v_entity_id := new.id;
    v_from := null; v_to := new.status; v_action := 'insert';
    begin v_actor := coalesce(auth.uid(), new.created_by);
    exception when others then v_actor := new.created_by; end;
    v_diff := jsonb_build_object('status', new.status, 'family', new.family);
  elsif tg_op = 'UPDATE' then
    v_org_id := new.org_id; v_entity_id := new.id;
    v_from := old.status; v_to := new.status; v_action := 'update';
    begin v_actor := coalesce(auth.uid(), new.updated_by);
    exception when others then v_actor := new.updated_by; end;
    v_diff := jsonb_build_object(
      'status', jsonb_build_object('from', old.status, 'to', new.status));
  else
    v_org_id := old.org_id; v_entity_id := old.id;
    v_from := old.status; v_to := 'deleted'; v_action := 'delete';
    begin v_actor := coalesce(auth.uid(), old.updated_by);
    exception when others then v_actor := old.updated_by; end;
    v_diff := jsonb_build_object('status', old.status);
  end if;

  perform public.audit_append_state_change(
    v_org_id, 'estimate', v_entity_id, v_from, v_to, v_action, v_actor, v_diff);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_estimates() from public, anon;

drop trigger if exists audit_estimates on public.estimates;
create trigger audit_estimates
  after insert or update or delete on public.estimates
  for each row execute function public.trg_audit_estimates();

-- ---------------------------------------------------------------------------
-- Seed: one default rate card per existing org, from the app DEFAULT_RATE_CARD.
-- Idempotent (no-op when the org already has any rate card).
-- ---------------------------------------------------------------------------

insert into public.rate_cards (org_id, name, currency_code, is_default, status)
select o.id, 'Default rate card', 'USD', true, 'active'
from public.organizations o
where not exists (
  select 1 from public.rate_cards rc where rc.org_id = o.id
);

insert into public.rate_card_lines (org_id, rate_card_id, code, group_key, label, rate_micros, position)
select rc.org_id, rc.id, v.code, v.group_key, v.label, v.rate_micros, v.position
from public.rate_cards rc
cross join (values
  ('CON-LABOR',     'constants',  'Fully-burdened labor (per hour)',     25000000, 0),
  ('CON-TOUCH',     'constants',  'Per-touch labor',                       100000, 1),
  ('RCV-PALLET',    'receiving',  'Inbound pallet',                       5500000, 2),
  ('RCV-CASE-U40',  'receiving',  'Inbound case (under 40 lb)',           1250000, 3),
  ('RCV-CASE-O40',  'receiving',  'Inbound case (over 40 lb)',            2000000, 4),
  ('STO-T1',        'storage',    'Storage 1-99 pallets',                16000000, 5),
  ('STO-T2',        'storage',    'Storage 100-499 pallets',             13500000, 6),
  ('STO-T3',        'storage',    'Storage 500+ pallets',                11000000, 7),
  ('SHP-WRAP',      'shipping',   'Pallet wrap & processing',             5000000, 8),
  ('ECM-ORDER',     'ecommerce',  'E-com order (pull, pack, doc)',        3250000, 9),
  ('ECM-PIECE',     'ecommerce',  'Additional piece pulled',               350000, 10),
  ('ADM-PROG',      'admin',      'Programming / WMS config (per hour)', 95000000, 11),
  ('ADM-SHOP',      'admin',      'Shop hours (billable, per hour)',     65000000, 12),
  ('ADM-SETUP',     'admin',      'New account setup (one-time)',       250000000, 13),
  ('MAT-PALLET-A',  'materials',  'Pallet, Grade A / CHEP',              18000000, 14),
  ('MAT-PALLET-B',  'materials',  'Pallet, Grade B',                     13000000, 15),
  ('ADD-LABEL-APP', 'addons',     'Label print & apply',                   120000, 16)
) as v(code, group_key, label, rate_micros, position)
where rc.is_default and rc.deleted_at is null
and not exists (
  select 1 from public.rate_card_lines l
  where l.rate_card_id = rc.id and l.code = v.code
);
