-- ============================================================================
-- Migration: 0129_duplicate_quote_rpc.sql
-- Wave: Quote flow follow-ups (2026-06-23 operator walkthrough)
-- Phase: P1-3 Duplicate quote
-- Closes: P1-3 (Duplicate quote, the tiered-quoting workaround). Product
--   Connections quotes almost everything in quantity-break tiers (Sam's Club
--   10/100/600, Heineken 20/40/80/100/120+). With no native tiering and no
--   clone action, building five tiers meant re-entering the customer, title,
--   and every line five times. duplicate_quote clones a quote header plus its
--   lines into a new draft in one atomic SECURITY DEFINER call, so the only
--   per-tier edits left are quantity and unit price.
-- Date: 2026-06-23
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   drop function if exists public.duplicate_quote(uuid, uuid, uuid);
--
-- Constitutional alignment:
--   Money rules        Integer cents only. Every _cents column is copied
--                      verbatim (BIGINT), and recompute_quote_totals (0017)
--                      re-derives the header subtotal/discount/tax/total by
--                      summing the copied per-line cents. No float, no SPA-side
--                      authority. currency_code is snapshotted (copied) onto the
--                      new quote; each line's tax_rate_snapshot is copied as-is
--                      so the clone preserves the source tax grain.
--   RLS rules          SECURITY DEFINER with SET search_path = public. The
--                      source quote is read by id and gated on
--                      org_id = p_caller_org_id; a missing or foreign-org source
--                      raises NOT_FOUND (constitutional 404, never 403), the
--                      same guard convert_quote_to_project uses (0041/0094). The
--                      new quote and its lines are inserted with the source's
--                      org_id, so the clone can never cross a tenant boundary.
--   Idempotency        The POST /quotes/:id/duplicate handler enforces the
--                      Idempotency-Key header (respondWithIdempotency). The RPC
--                      itself mints a fresh draft per call by design; retries of
--                      the same request are deduped by the idempotency layer.
--   Audit log          Untouched. The new-quote INSERT writes no audit row,
--                      matching the normal quote-create path (quotes have no
--                      INSERT audit trigger; only state transitions are audited
--                      by trg_audit_quotes_state). The created-audit symmetry is
--                      the separate app-wide F-Wave9-AUDIT-CREATED-SYMMETRY-01.
--                      Every later transition on the duplicate is audited as
--                      usual.
--   Migration rules    Forward-only. DDL is idempotent (CREATE OR REPLACE
--                      function). Does not edit any applied migration.
--   Capabilities       No catalog change. The handler gates on quotes.quote.write
--                      (the same cap that mints a quote via POST /quotes), since
--                      a duplicate is a create.
--   State machine      Untouched. The new quote starts in 'draft'; no quote FSM
--                      edit, no workflow.ts change.
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

  -- New header: a fresh draft for the same org and customer. Commercial terms
  -- (currency, tax / payment / pricing defaults, notes, job type, source
  -- template breadcrumb) carry over; lifecycle fields (state, the paired _at
  -- stamps, sent_at, accepted_at, converted_to_project_id) reset to their
  -- defaults. The title gains a " (copy)" suffix when the source had one.
  -- Header totals start at their column defaults (0) and are recomputed from
  -- the copied lines below.
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

  -- Copy every line, positions preserved. The per-line _cents are copied
  -- verbatim because recompute_quote_totals only SUMS them into the header (it
  -- does not re-derive them). tax_rate_snapshot is copied as-is so the clone is
  -- exact at the source's tax grain; the BEFORE INSERT snapshot trigger leaves a
  -- non-zero snapshot untouched.
  insert into public.quote_line_items (
    quote_id, position, item_id, vas_id,
    sku, name, description, kind,
    quantity_e3, unit_price_cents, discount_bps,
    tax_id, tax_rate_snapshot, is_taxable,
    line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents,
    metadata,
    created_by, updated_by
  )
  select
    v_new_quote_id, position, item_id, vas_id,
    sku, name, description, kind,
    quantity_e3, unit_price_cents, discount_bps,
    tax_id, tax_rate_snapshot, is_taxable,
    line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents,
    metadata,
    p_actor, p_actor
  from public.quote_line_items
  where quote_id = p_source_quote_id;

  -- Roll the copied per-line cents up into the new quote header.
  perform public.recompute_quote_totals(v_new_quote_id);

  return v_new_quote_id;
end;
$$;

revoke execute on function public.duplicate_quote(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.duplicate_quote(uuid, uuid, uuid)
  to authenticated, service_role;

comment on function public.duplicate_quote(uuid, uuid, uuid) is
  'Clones a quote header plus its line items into a new draft for the same org and customer (Quote flow P1-3, the tiered-quoting workaround). One atomic SECURITY DEFINER call: allocates a gap-free number via next_doc_number, copies commercial terms and every line (positions and per-line cents preserved), resets lifecycle fields, suffixes the title with " (copy)", and recomputes header totals. Cross-tenant or missing source raises NOT_FOUND (404, never 403), matching convert_quote_to_project.';
