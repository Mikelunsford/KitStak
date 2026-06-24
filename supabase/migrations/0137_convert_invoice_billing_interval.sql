-- ============================================================================
-- Migration: 0137_convert_invoice_billing_interval.sql
-- Wave: Recurring billing (ADR 0005, Phase 1b) - remainder (project->invoice half)
-- Phase: convert_project_to_invoice carries the line billing_interval onto the
--   invoice, completing the Phase 1b carry-through chain quote -> project ->
--   invoice. 0131 added billing_interval to quote lines; 0136 added it to project
--   lines and carried it through convert_quote_to_project. This adds the column to
--   invoice_line_items and carries it through convert_project_to_invoice, so a
--   recurring (monthly) line stays tagged monthly all the way to the invoice and
--   the recurring-invoice generator (Phase 2) has a column to read.
--   convert_project_to_invoice keeps its 3-arg signature (projects are not tiered;
--   the tier was already resolved at quote -> project), so this is a plain
--   CREATE OR REPLACE plus an additive column.
-- Closes: ADR 0005 Phase 1b project->invoice billing_interval carry.
-- Date: 2026-06-24
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   Recreate the pre-0137 convert_project_to_invoice (no billing_interval copy)
--   with a new forward migration, then:
--     alter table public.invoice_line_items drop column if exists billing_interval;
--   The copied billing_interval is forward-only data on new invoice lines; no
--   backfill is needed to revert.
--
-- Constitutional alignment:
--   Money rules        billing_interval is line metadata, not money (mirrors 0131
--                      / 0136). The invoice line money math is byte-identical to
--                      the prior definition: gross / discount / tax / line_total
--                      stay banker's-rounded via round_half_even over BIGINT cents,
--                      tax snapshotted at issuance from the project line's
--                      tax_rate_id. No float introduced, no SPA authority.
--   RLS rules          Unchanged. SECURITY DEFINER with SET search_path = public;
--                      the org gate (org_id = p_caller_org_id, else NOT_FOUND 404)
--                      and the billable-state guard are unchanged. The additive
--                      invoice_line_items column inherits the existing RLS.
--   Audit rules        Untouched. The invoice draft / line inserts carry no
--                      hand-written audit; the existing triggers own it.
--   Idempotency        Unchanged. The existing draft-invoice short-circuit
--                      (returns the existing draft for the project) is preserved,
--                      so a retry never mints a second invoice.
--   Migration rules    Forward-only. Same signature, so a plain CREATE OR REPLACE;
--                      DDL is idempotent (ADD COLUMN IF NOT EXISTS). No prior
--                      migration is edited.
--   Zod canon          InvoiceLineItem gains billing_interval in
--                      _shared/types/finance.ts and the apps/web mirror in the same
--                      PR; pnpm test:contract gates the byte-identical parity.
--   Grants             Post-0111 hardened baseline preserved: service_role only.
--                      CREATE OR REPLACE preserves the grant; it is re-asserted
--                      explicitly so the redefine cannot re-open authenticated.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ADR 0005 Phase 1b: billing_interval on invoice lines (mirrors 0131 / 0136).
-- ---------------------------------------------------------------------------
alter table public.invoice_line_items
  add column if not exists billing_interval text not null default 'one_time'
    check (billing_interval in ('one_time', 'monthly'));

comment on column public.invoice_line_items.billing_interval is
  'How this invoice line is billed: one_time (default) or monthly (recurring). ADR 0005 Phase 1b, carried from the source project line by convert_project_to_invoice. Phase 2 adds the recurring-invoice generator that reads it.';

-- ---------------------------------------------------------------------------
-- convert_project_to_invoice carries billing_interval onto the invoice line. The
-- signature is unchanged; the body is byte-identical to the prior definition
-- except for the added billing_interval column + select.
-- ---------------------------------------------------------------------------
create or replace function public.convert_project_to_invoice(
  p_project_id uuid,
  p_caller_org_id uuid,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
  -- ADR 0005 Phase 1b: billing_interval rides onto the invoice line.
  insert into public.invoice_line_items (
    invoice_id, item_id, description, quantity, unit_price_cents,
    tax_rate_snapshot, tax_amount_cents, discount_cents,
    line_total_cents, sort_order, billing_interval,
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
    pli.billing_interval,
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
$$;

-- Post-0111 hardened baseline: service_role only. CREATE OR REPLACE preserves the
-- grant, but re-assert explicitly so the redefine cannot re-open authenticated.
revoke execute on function public.convert_project_to_invoice(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.convert_project_to_invoice(uuid, uuid, uuid)
  to service_role;
