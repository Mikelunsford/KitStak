-- ============================================================================
-- Migration: 0135_duplicate_quote_tier_aware.sql
-- Wave: Native tiered quoting (ADR 0004, Option A) - unit 4 (duplicate tier-aware)
-- Phase: P2-4 duplicate_quote tier-awareness. The 0129 duplicate_quote was
--   written before native tiers (0132) and before line billing_interval (0131),
--   so its line copy silently dropped both columns: duplicating a tiered quote
--   produced a non-tiered clone (tiers gone, every cloned line tier_id null), and
--   a monthly line reset to one_time. Now that the tier CRUD unit makes tiers
--   creatable, this redefine clones the source's tiers into the new quote and
--   remaps each cloned line's tier_id to its new tier, and copies billing_interval
--   through. A non-tiered source is byte-identical to before (empty tier set, all
--   cloned lines tier_id null).
-- Closes: ADR 0004 duplicate_quote tier-awareness (unit 4 of the tiering wave) and
--   the billing_interval-on-duplicate drop (0131 added the column after 0129).
-- Date: 2026-06-24
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   Restore the 0129 definition of public.duplicate_quote(uuid, uuid, uuid) (no
--   tier clone, no billing_interval copy) with a new forward migration. The
--   cloned tiers / billing_interval are forward-only data on new quotes; no
--   backfill is needed to revert the function.
--
-- Constitutional alignment:
--   Money rules        Integer cents only. The per-line _cents are still copied
--                      verbatim (BIGINT) and recompute_quote_totals (now tier-
--                      grain, 0134) re-derives the per-tier and header totals from
--                      them. The cloned tiers' own _cents start at their column
--                      defaults (0) and are filled by the recompute; no per-tier
--                      total is copied. No float, no SPA authority, no new
--                      rounding. currency_code and tax_rate_snapshot are still
--                      snapshotted as in 0129.
--   RLS rules          Unchanged from 0129. SECURITY DEFINER with SET search_path
--                      = public; the org gate (org_id = p_caller_org_id, else
--                      NOT_FOUND 404) is unchanged. The cloned tiers and lines are
--                      inserted with the new quote's id, which carries the source
--                      org_id, so the clone cannot cross a tenant boundary.
--                      quote_tiers is Pattern B (RLS through quotes.org_id); the
--                      service-role insert here is org-correct by construction.
--   Audit rules        Untouched. No audit row on the new quote / tiers / lines
--                      (quotes and quote_tiers have no INSERT audit trigger), the
--                      same posture as 0129.
--   Idempotency        Unchanged. POST /quotes/:id/duplicate enforces the
--                      Idempotency-Key header; the RPC mints a fresh draft per
--                      call and retries are deduped by the idempotency layer.
--   Migration rules    Forward-only. CREATE OR REPLACE FUNCTION is idempotent. No
--                      prior migration is edited.
--   Grants             Post-0133 hardened baseline preserved: service_role only.
--                      CREATE OR REPLACE preserves grants, but the baseline is
--                      re-asserted explicitly (revoke from public, anon,
--                      authenticated; grant to service_role) so this redefine
--                      cannot re-open the authenticated EXECUTE surface that 0129
--                      originally granted and 0133 revoked. The edge calls this via
--                      admin() (service_role), so nothing breaks.
-- ============================================================================

create or replace function public.duplicate_quote(
  p_source_quote_id uuid,
  p_actor uuid,
  p_caller_org_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_new_quote_id uuid;
  v_number text;
begin
  -- Gate on org. A missing or cross-tenant source surfaces as NOT_FOUND so the
  -- caller cannot distinguish the two. Constitutional 404, never 403 / 409.
  select org_id into v_org_id
    from public.quotes
   where id = p_source_quote_id;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: quote not found' using errcode = 'P0001';
  end if;

  -- Gap-free number from the org-scoped numbering chassis (same path as the
  -- create handler's next_doc_number(org, 'quote')).
  v_number := public.next_doc_number(v_org_id, 'quote');

  -- New header: a fresh draft for the same org and customer (unchanged from 0129).
  insert into public.quotes (
    org_id, number, customer_id, state,
    title, description, expiration_date,
    currency_code, exchange_rate_e9,
    default_tax_id, payment_method_id, pricing_tier_id,
    requires_approval, notes, internal_notes,
    job_type_id, source_job_template_id,
    metadata,
    created_by, updated_by
  )
  select
    org_id,
    v_number,
    customer_id,
    'draft',
    case when title is not null then title || ' (copy)' else null end,
    description,
    expiration_date,
    currency_code,
    exchange_rate_e9,
    default_tax_id,
    payment_method_id,
    pricing_tier_id,
    requires_approval,
    notes,
    internal_notes,
    job_type_id,
    source_job_template_id,
    metadata,
    p_actor,
    p_actor
  from public.quotes
  where id = p_source_quote_id
  returning id into v_new_quote_id;

  -- ADR 0004: clone the source's tiers into the new quote and remap each cloned
  -- line's tier_id to its new tier, in one statement. src_tiers is MATERIALIZED so
  -- gen_random_uuid() is evaluated exactly once: ins_tiers inserts the new tiers
  -- with those ids, and the line copy reads the same old_id -> new_id mapping. The
  -- FK quote_line_items.tier_id -> quote_tiers(id) is satisfied because the tier
  -- inserts and the line inserts run in the same statement (RI is checked at
  -- statement end, by which point the tiers exist). A non-tiered source has an
  -- empty src_tiers, so no tiers are cloned and every cloned line keeps tier_id
  -- null via the LEFT JOIN: byte-identical to 0129 for the non-tiered path.
  --
  -- billing_interval (0131) and tier_id (0132) were both added after the original
  -- 0129 line copy and were silently dropped by it; both are copied here.
  with src_tiers as materialized (
    select
      id as old_id,
      gen_random_uuid() as new_id,
      label,
      break_quantity_e3,
      sort_order,
      metadata
    from public.quote_tiers
    where quote_id = p_source_quote_id
  ),
  ins_tiers as (
    insert into public.quote_tiers (
      id, quote_id, label, break_quantity_e3, sort_order, metadata,
      created_by, updated_by
    )
    select
      new_id, v_new_quote_id, label, break_quantity_e3, sort_order, metadata,
      p_actor, p_actor
    from src_tiers
  )
  insert into public.quote_line_items (
    quote_id, position, item_id, vas_id,
    sku, name, description, kind,
    quantity_e3, unit_price_cents, discount_bps,
    tax_id, tax_rate_snapshot, is_taxable,
    billing_interval, tier_id,
    line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents,
    metadata,
    created_by, updated_by
  )
  select
    v_new_quote_id, li.position, li.item_id, li.vas_id,
    li.sku, li.name, li.description, li.kind,
    li.quantity_e3, li.unit_price_cents, li.discount_bps,
    li.tax_id, li.tax_rate_snapshot, li.is_taxable,
    li.billing_interval, st.new_id,
    li.line_subtotal_cents, li.line_discount_cents, li.line_tax_cents, li.line_total_cents,
    li.metadata,
    p_actor, p_actor
  from public.quote_line_items li
  left join src_tiers st on st.old_id = li.tier_id
  where li.quote_id = p_source_quote_id;

  -- Roll the copied per-line cents up: per-tier totals into the cloned tiers and
  -- the header to the tier grain (0 when tiered), via the 0134 recompute.
  perform public.recompute_quote_totals(v_new_quote_id);

  return v_new_quote_id;
end;
$$;

-- Post-0133 hardened baseline: service_role only. CREATE OR REPLACE preserves the
-- existing grants, but re-assert explicitly so this redefine cannot re-open the
-- authenticated EXECUTE surface that 0129 granted and 0133 revoked.
revoke execute on function public.duplicate_quote(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.duplicate_quote(uuid, uuid, uuid)
  to service_role;

comment on function public.duplicate_quote(uuid, uuid, uuid) is
  'Clones a quote header, its tiers, and its line items into a new draft for the same org and customer (Quote flow P1-3 + ADR 0004 tier-awareness). One atomic SECURITY DEFINER call: allocates a gap-free number via next_doc_number, copies commercial terms, clones each tier (remapping every cloned line tier_id to its new tier), copies every line (positions, per-line cents, tax snapshot, and billing_interval preserved), resets lifecycle fields, suffixes the title with " (copy)", and recomputes tier and header totals. A non-tiered source clones with no tiers and every line tier_id null. Cross-tenant or missing source raises NOT_FOUND (404, never 403), matching convert_quote_to_project.';
