-- ============================================================================
-- Migration: 0132_quote_tiers.sql
-- Wave: Native tiered quoting (ADR 0004, Option A) - foundation
-- Phase: P2-1 foundation (quote_tiers table + nullable quote_line_items.tier_id)
-- Closes: ADR 0004 Option A foundation. The highest-volume account quotes in
--   quantity-break tiers (Sam's Club 10/100/600, Heineken 20/40/80/100/120+).
--   Duplicate (0129) gives one quote per tier; native tiering makes one quote
--   document carry many tiers under one number. This is the inert data-model
--   foundation: it creates quote_tiers (a child of quotes) and adds a nullable
--   tier_id to quote_line_items. It is behaviour-preserving: nothing creates a
--   tier yet, so every line stays tier_id null and existing quotes are
--   untouched, exactly as the WMS location_id deepening left pre-WMS rows null
--   (ADR 0002). The tier-grain recompute, the tier CRUD, the tier-building UI,
--   the multi-tier PDF, and the convert tier_id argument land in later units of
--   this wave.
-- Date: 2026-06-23
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   alter table public.quote_line_items drop column if exists tier_id;
--   drop table if exists public.quote_tiers;
--
-- Constitutional alignment:
--   Money rules        Per-tier totals are BIGINT cents with the _cents suffix,
--                      defaulting to 0. They are populated by the tier-grain
--                      recompute in a later unit; this migration adds no math and
--                      no float. The quote header totals (recompute_quote_totals)
--                      are untouched while tier_id is null everywhere.
--   RLS rules          quote_tiers ships with RLS in this creation migration:
--                      Pattern B parent-join on quotes.org_id, byte-for-byte the
--                      quote_line_items (0014) policy shape (select on org match;
--                      write additionally gated to org_owner / org_admin / sales
--                      / accounting). The additive tier_id column inherits the
--                      quote_line_items policies.
--   Audit rules        Untouched. quote_tiers carries no state machine, so it
--                      gets no audit trigger (same posture as quote_line_items).
--                      The quote state audit trigger is unchanged.
--   Migration rules    Forward-only. All DDL is idempotent (CREATE TABLE IF NOT
--                      EXISTS, ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS
--                      then CREATE). quote_tiers is created before the tier_id FK
--                      that references it.
--   Zod canon          QuoteTierSchema and the nullable tier_id on the quote line
--                      read shape are added to _shared/types/sales.ts and the
--                      apps/web mirror in the same PR; pnpm test:contract gates
--                      the parity. tier_id is not added to the line create/update
--                      request here, so no surface can set it until the tier CRUD
--                      unit lands.
--   Capabilities       Untouched. Tier authoring will gate on quotes.quote.write
--                      (a tier is part of editing a quote); no new capability.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- quote_tiers: a quantity-break tier of one quote. Pattern B parent-join: RLS
-- resolves through quotes.org_id, exactly like quote_line_items. Per-tier totals
-- mirror the quote header totals and are recomputed (in a later unit) from the
-- tier's lines.
-- ---------------------------------------------------------------------------

create table if not exists public.quote_tiers (
  id uuid primary key default uuid_generate_v4(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  label text not null,
  break_quantity_e3 bigint not null default 0 check (break_quantity_e3 >= 0),
  sort_order integer not null default 0,

  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists quote_tiers_quote_idx
  on public.quote_tiers (quote_id, sort_order);

alter table public.quote_tiers enable row level security;

drop policy if exists quote_tiers_select on public.quote_tiers;
create policy quote_tiers_select on public.quote_tiers
  for select to authenticated
  using (
    exists (
      select 1 from public.quotes q
       where q.id = quote_tiers.quote_id
         and q.org_id = public.current_org_id()
    )
  );

drop policy if exists quote_tiers_write on public.quote_tiers;
create policy quote_tiers_write on public.quote_tiers
  for all to authenticated
  using (
    exists (
      select 1 from public.quotes q
       where q.id = quote_tiers.quote_id
         and q.org_id = public.current_org_id()
         and public.current_user_role() in
             ('org_owner', 'org_admin', 'sales', 'accounting')
    )
  )
  with check (
    exists (
      select 1 from public.quotes q
       where q.id = quote_tiers.quote_id
         and q.org_id = public.current_org_id()
         and public.current_user_role() in
             ('org_owner', 'org_admin', 'sales', 'accounting')
    )
  );

-- ---------------------------------------------------------------------------
-- quote_line_items.tier_id: which tier a line belongs to. Nullable; a non-tiered
-- quote leaves it null and behaves exactly as today. ON DELETE CASCADE so
-- removing a tier removes its lines (a non-tiered quote's lines are unaffected,
-- their tier_id being null).
-- ---------------------------------------------------------------------------

alter table public.quote_line_items
  add column if not exists tier_id uuid
    references public.quote_tiers(id) on delete cascade;

create index if not exists quote_line_items_tier_idx
  on public.quote_line_items (tier_id) where tier_id is not null;

comment on table public.quote_tiers is
  'A quantity-break tier of one quote (ADR 0004 native tiered quoting). One quote document carries many tiers under one number; each tier owns its own lines (quote_line_items.tier_id) and per-tier totals. Pattern B RLS via quotes.org_id.';
comment on column public.quote_line_items.tier_id is
  'The quote tier this line belongs to (ADR 0004). Null for a non-tiered quote (every existing line). ON DELETE CASCADE with the tier.';
