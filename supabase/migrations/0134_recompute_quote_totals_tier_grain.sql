-- ============================================================================
-- Migration: 0134_recompute_quote_totals_tier_grain.sql
-- Wave: Native tiered quoting (ADR 0004, Option A) - unit 2 (tier-grain totals)
-- Phase: P2-2 tier-grain recompute. Redefine recompute_quote_totals so a tiered
--   quote rolls totals up per tier into quote_tiers.{subtotal,discount,tax,
--   total}_cents, and the quote header carries no single total when tiers are
--   present. The non-tiered path (every existing quote: tier_id null everywhere)
--   stays byte-identical to the original 0017 definition. This follows the 0132
--   quote_tiers foundation; nothing creates a tier yet, so on prod every quote is
--   non-tiered and this redefine is behaviour-preserving until the tier CRUD and
--   tier-building UI units land.
-- Closes: ADR 0004 Option A tier-grain totals (unit 2 of the tiering wave).
-- Date: 2026-06-24
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   Restore the 0017 definition of public.recompute_quote_totals(uuid) (the pure
--   header sum-of-lines, no tier rollup) with a new forward migration. The
--   per-tier totals it writes into quote_tiers are derived data, recomputed on the
--   next line write; no data backfill is needed to revert.
--
-- Constitutional alignment:
--   Money rules        All arithmetic stays BIGINT cents (the _cents columns),
--                      summed with SQL SUM over the per-line BIGINT amounts. No
--                      float, no SPA-computed authority, and no rounding is
--                      introduced: the per-line amounts are already roundHalfEven
--                      at write time and recompute only sums them, exactly as 0017
--                      did. A tiered quote's header totals are set to 0 (the NOT
--                      NULL _cents money columns are preserved and a 0 header is
--                      aggregation-safe); the per-tier totals are the source of
--                      truth and readers branch on tier presence. The non-tiered
--                      header is the identical four-sum of 0017.
--   RLS rules          Untouched. The function stays SECURITY DEFINER (as in 0017)
--                      and is invoked only from the edge via admin() (service_role)
--                      and from duplicate_quote / convert. It writes quotes and
--                      quote_tiers, both of which carry their own RLS for the
--                      authenticated path. No policy changes.
--   Audit rules        Untouched. recompute_quote_totals updates totals and
--                      updated_at only; it does not change quote.state, so the
--                      before-update-of-state audit trigger (0017) does not fire.
--                      quote_tiers carries no state machine and no audit trigger.
--   Idempotency        Unaffected. recompute is a pure re-derivation: calling it
--                      repeatedly on the same quote yields the same totals.
--   Migration rules    Forward-only. CREATE OR REPLACE FUNCTION is idempotent. No
--                      prior migration is edited.
--   Grants             Post-0117 hardened baseline preserved: service_role only.
--                      CREATE OR REPLACE preserves existing grants; the baseline is
--                      re-asserted explicitly (revoke from public, anon,
--                      authenticated; grant to service_role) so this redefine
--                      cannot re-open the authenticated EXECUTE surface that the
--                      0017 definition originally granted and 0117 revoked.
-- ============================================================================

create or replace function public.recompute_quote_totals(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_tiers boolean;
  v_subtotal bigint;
  v_discount bigint;
  v_tax bigint;
  v_total bigint;
begin
  -- 1. Roll up every tier of this quote from the lines assigned to it. LEFT JOIN
  --    so a tier with no lines settles to 0 rather than dropping out of the set.
  update public.quote_tiers t
     set subtotal_cents = s.subtotal,
         discount_cents = s.discount,
         tax_cents      = s.tax,
         total_cents    = s.total,
         updated_at     = now()
    from (
      select tt.id,
             coalesce(sum(li.line_subtotal_cents), 0) as subtotal,
             coalesce(sum(li.line_discount_cents), 0) as discount,
             coalesce(sum(li.line_tax_cents), 0)      as tax,
             coalesce(sum(li.line_total_cents), 0)    as total
        from public.quote_tiers tt
        left join public.quote_line_items li on li.tier_id = tt.id
       where tt.quote_id = p_quote_id
       group by tt.id
    ) s
   where t.id = s.id;

  -- 2. A quote is tiered if it has at least one tier.
  select exists (
    select 1 from public.quote_tiers where quote_id = p_quote_id
  ) into v_has_tiers;

  -- 3. Header totals.
  if v_has_tiers then
    -- A tiered quote presents many quantity-break offers under one document and
    -- one number (ADR 0004); only one tier is ultimately accepted, so there is no
    -- single header total. Zero the header (kept NOT NULL and aggregation-safe);
    -- the per-tier totals above are the source of truth and readers branch on tier
    -- presence. A line left unassigned to any tier (tier_id null) on a tiered
    -- quote contributes to neither a tier nor the header until it is assigned.
    v_subtotal := 0;
    v_discount := 0;
    v_tax      := 0;
    v_total    := 0;
  else
    -- A non-tiered quote (every existing quote: tier_id null everywhere) keeps the
    -- original 0017 behaviour exactly: the header is the sum of all its lines.
    select
      coalesce(sum(line_subtotal_cents), 0),
      coalesce(sum(line_discount_cents), 0),
      coalesce(sum(line_tax_cents), 0),
      coalesce(sum(line_total_cents), 0)
    into v_subtotal, v_discount, v_tax, v_total
    from public.quote_line_items
    where quote_id = p_quote_id;
  end if;

  update public.quotes
     set subtotal_cents = v_subtotal,
         discount_cents = v_discount,
         tax_cents      = v_tax,
         total_cents    = v_total,
         updated_at     = now()
   where id = p_quote_id;
end;
$$;

-- Post-0117 hardened baseline: service_role only. CREATE OR REPLACE preserves the
-- existing grants, but re-assert explicitly so this redefine cannot re-open the
-- authenticated EXECUTE surface that the 0017 definition granted and 0117 revoked.
revoke execute on function public.recompute_quote_totals(uuid)
  from public, anon, authenticated;
grant execute on function public.recompute_quote_totals(uuid) to service_role;
