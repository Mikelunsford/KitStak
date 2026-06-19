-- =============================================================================
-- Migration: 0127_convert_carries_project_tax.sql
-- Wave:      Production readiness 2026-06-18 (R-W14-MONEY-01)
-- Phase:     Money integrity hardening
-- Closes:    R-W14-MONEY-01 (convert_project_to_invoice hardcoded
--            tax_rate_snapshot = 0 and tax_amount_cents = 0 on every invoice
--            line generated from a project line, discarding the project line's
--            tax_rate_id entirely. Taxed projects converted to a zero-tax
--            invoice, forcing the operator to re-apply taxes by hand.)
-- Date:      2026-06-18
--
-- Fix: snapshot the tax at invoice issuance. The invoice is "issued" at
-- conversion, so per the constitution (tax rate snapshotted on the line at
-- issuance) the invoice line captures the project line's tax rate as it stands
-- at conversion time, read through the existing project_line_items.tax_rate_id
-- FK into taxes.rate_bps. No project_line_items schema change, no trigger, no
-- data backfill: the FK already carries the rate, and the snapshot grain that
-- matters is the invoice line at issuance.
--
-- Invoice line math (mirrors invoicing-api computeLineMath and the invoice
-- tax_rate_snapshot grain, a decimal fraction numeric(7,4), e.g. 0.0825):
--   gross            = round_half_even(quantity * unit_price_cents)
--   discount_cents   = round_half_even(quantity * unit_price_cents * discount_percent / 100)
--   net              = gross - discount_cents
--   tax_rate_snapshot= taxes.rate_bps / 10000   (bps -> fraction; null FK -> 0)
--   tax_amount_cents = round_half_even(net * tax_rate_snapshot)
--   line_total_cents = net + tax_amount_cents
-- All cents arithmetic uses round_half_even (0126), so the SQL and the SPA line
-- math agree to the cent. recompute_invoice_totals (0018) then sums line_total
-- and tax_amount directly, so header subtotal / tax / total stay consistent.
--
-- Constitutional alignment:
--   Money rules   Tax rate is now snapshotted on every converted invoice line
--                 at issuance, as required. BIGINT cents storage unchanged; all
--                 rounding is banker's via round_half_even. No float.
--   RLS rules     The taxes join is org-scoped (t.org_id = pli.org_id) so a
--                 foreign-org tax row can never be read. SECURITY DEFINER with
--                 SET search_path = public preserved.
--   Idempotency   Untouched. The existing draft-invoice idempotency guard is
--                 unchanged.
--   Audit log     Untouched.
--
-- Behaviour change: converting a project whose lines carry a tax_rate_id now
-- produces an invoice with tax pre-applied per line (previously 0). Project
-- lines without a tax_rate_id are unchanged (tax 0). Already-issued invoices
-- are not touched. The manual "re-apply taxes on the generated invoice" step is
-- no longer required.
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   Re-run the 0126 definition of convert_project_to_invoice (tax_rate_snapshot
--   and tax_amount_cents hardcoded to 0, line_total_cents = gross - discount).
--
-- All DDL is idempotent (CREATE OR REPLACE).
-- =============================================================================

create or replace function public.convert_project_to_invoice(p_project_id uuid, p_caller_org_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org_id uuid;
  v_state text;
  v_customer_id uuid;
  v_currency text;
  v_quote_id uuid;
  v_existing_invoice_id uuid;
  v_invoice_id uuid;
  v_invoice_number text;
begin
  select org_id, state, customer_id, currency_code, source_quote_id
    into v_org_id, v_state, v_customer_id, v_currency, v_quote_id
    from public.projects
   where id = p_project_id;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: project not found' using errcode = 'P0001';
  end if;

  if v_state not in ('ready_to_ship', 'completed') then
    raise exception 'STATE_CONFLICT: project not in billable state (was %)', v_state
      using errcode = 'P0001';
  end if;

  select id into v_existing_invoice_id
    from public.invoices
   where org_id = v_org_id
     and project_id = p_project_id
     and status = 'draft'
     and deleted_at is null
   order by created_at asc
   limit 1;

  if v_existing_invoice_id is not null then
    return v_existing_invoice_id;
  end if;

  v_invoice_number := public.next_doc_number(v_org_id, 'invoice');

  insert into public.invoices (
    org_id, invoice_number, customer_id, project_id, quote_id,
    status, currency_code, issue_date,
    created_by, updated_by
  ) values (
    v_org_id, v_invoice_number, v_customer_id, p_project_id, v_quote_id,
    'draft', v_currency, current_date,
    p_actor, p_actor
  )
  returning id into v_invoice_id;

  -- Carry project_line_items into invoice_line_items. Tax is snapshotted at
  -- issuance from the project line's tax_rate_id (taxes.rate_bps -> fraction),
  -- org-scoped. gross / discount / net / tax / line_total mirror the invoicing
  -- line math; every cents value is banker's-rounded via round_half_even.
  insert into public.invoice_line_items (
    invoice_id, item_id, description, quantity, unit_price_cents,
    tax_rate_snapshot, tax_amount_cents, discount_cents,
    line_total_cents, sort_order,
    created_by, updated_by
  )
  select
    v_invoice_id,
    pli.item_id,
    coalesce(pli.description, pli.name),
    pli.quantity,
    pli.unit_price_cents,
    coalesce(t.rate_bps, 0) / 10000.0,
    public.round_half_even(
      ( public.round_half_even((pli.quantity * pli.unit_price_cents)::numeric)
        - public.round_half_even((pli.quantity * pli.unit_price_cents * pli.discount_percent / 100.0))
      ) * (coalesce(t.rate_bps, 0) / 10000.0)
    )::bigint,
    public.round_half_even((pli.quantity * pli.unit_price_cents * pli.discount_percent / 100.0))::bigint,
    ( public.round_half_even((pli.quantity * pli.unit_price_cents)::numeric)::bigint
      - public.round_half_even((pli.quantity * pli.unit_price_cents * pli.discount_percent / 100.0))::bigint )
    + public.round_half_even(
        ( public.round_half_even((pli.quantity * pli.unit_price_cents)::numeric)
          - public.round_half_even((pli.quantity * pli.unit_price_cents * pli.discount_percent / 100.0))
        ) * (coalesce(t.rate_bps, 0) / 10000.0)
      )::bigint,
    pli.position,
    p_actor,
    p_actor
  from public.project_line_items pli
  left join public.taxes t
    on t.id = pli.tax_rate_id and t.org_id = pli.org_id
  where pli.project_id = p_project_id
  order by pli.position;

  perform public.recompute_invoice_totals(v_invoice_id);

  return v_invoice_id;
end;
$function$;
