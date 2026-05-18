-- ============================================================================
-- Migration: 0045_convert_project_to_invoice.sql
-- Wave: 6
-- Phase: 6.5 (workflow integration remediation)
-- Closes: G-COMPLETE-AUTO-01 (no convert_project_to_invoice RPC; operator
--         picked Option B from the audit: a button on the project detail
--         page that creates a draft invoice from the project)
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop the function. Not auto-run.
--
-- Constitutional alignment:
--   Money rules        unit_price_cents copied byte-for-byte from
--                      project_line_items to invoice_line_items. Line totals
--                      (line_total_cents, tax_amount_cents) are recomputed
--                      via public.recompute_invoice_totals (0018) at the
--                      end of the function. No floats touched.
--   RLS rules          SECURITY DEFINER with p_caller_org_id parameter (the
--                      0041 pitfall #10 pattern: public.current_org_id()
--                      returns NULL under service-role, so handlers MUST
--                      pass the org id explicitly). Cross-tenant or missing
--                      project returns NOT_FOUND, never 403 / 409.
--   Audit rules        Invoice creation fires the existing audit trigger
--                      from 0024 on invoices.status (initial 'draft' state
--                      is stamped by the same trigger that handles
--                      transitions). Invoice line item inserts go through
--                      the existing invoice_line_items audit path. No
--                      best-effort handler writes.
--   Idempotency        If a draft invoice with project_id = p_project_id
--                      already exists for this org, return its id instead
--                      of creating a duplicate. This guards both Idempotency-
--                      Key replays and operator double-clicks.
--   Migration rules    Forward-only. CREATE OR REPLACE FUNCTION is
--                      idempotent. All DDL idempotent.
-- ============================================================================

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
  v_seq bigint;
begin
  -- Resolve project and validate ownership. NOT_FOUND on cross-tenant or
  -- missing rows: callers cannot distinguish.
  select org_id, state, customer_id, currency_code, source_quote_id
    into v_org_id, v_state, v_customer_id, v_currency, v_quote_id
    from public.projects
   where id = p_project_id;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: project not found' using errcode = 'P0001';
  end if;

  -- Operator policy from the audit: only completed / shipped projects can
  -- be converted to an invoice. ready_to_ship plus completed cover the
  -- "work is done, time to bill" window. Other states surface as
  -- STATE_CONFLICT (409) at the handler boundary.
  if v_state not in ('ready_to_ship', 'completed') then
    raise exception 'STATE_CONFLICT: project not in billable state (was %)', v_state
      using errcode = 'P0001';
  end if;

  -- Idempotency by project_id + draft status: if the operator already
  -- generated a draft invoice for this project, return its id rather than
  -- creating a duplicate. The handler-side Idempotency-Key key catches
  -- exact-replay; this catches operator-double-click on a fresh request.
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

  -- Generate an invoice_number deterministically. Pattern matches the
  -- convert_quote_to_project number scheme: prefix + date + first 8 hex
  -- of the project id. Operators can rename via PATCH /invoices/:id.
  v_invoice_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' ||
    substr(replace(p_project_id::text, '-', ''), 1, 8);

  -- Collision tolerance: if the deterministic number is already taken in
  -- this org (e.g., re-run on a different project that shares the prefix),
  -- append a short numeric suffix.
  if exists (
    select 1 from public.invoices
     where org_id = v_org_id and invoice_number = v_invoice_number
  ) then
    select count(*) into v_seq
      from public.invoices
     where org_id = v_org_id
       and invoice_number like v_invoice_number || '%';
    v_invoice_number := v_invoice_number || '-' || (v_seq + 1)::text;
  end if;

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

  -- Carry project_line_items into invoice_line_items. quantity copies
  -- straight across (both numeric). unit_price_cents copies as BIGINT
  -- cents. discount_percent converts to discount_cents at the per-line
  -- level: discount_cents = round(quantity * unit_price_cents *
  -- discount_percent / 100). Tax amount is left at 0 here; the operator
  -- attaches taxes via the invoice line item PATCH path. line_total_cents
  -- is recomputed by recompute_invoice_totals afterwards from the
  -- in-table fields.
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
    0,
    0,
    round((pli.quantity * pli.unit_price_cents * pli.discount_percent / 100.0))::bigint,
    round((pli.quantity * pli.unit_price_cents)::numeric)::bigint -
      round((pli.quantity * pli.unit_price_cents * pli.discount_percent / 100.0))::bigint,
    pli.position,
    p_actor,
    p_actor
  from public.project_line_items pli
  where pli.project_id = p_project_id
  order by pli.position;

  -- Recompute invoice header totals from the freshly inserted lines. The
  -- 0018 helper handles subtotal / tax / total; balance_cents is GENERATED
  -- so it tracks automatically.
  perform public.recompute_invoice_totals(v_invoice_id);

  return v_invoice_id;
end;
$$;

revoke execute on function public.convert_project_to_invoice(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.convert_project_to_invoice(uuid, uuid, uuid)
  to authenticated, service_role;

comment on function public.convert_project_to_invoice(uuid, uuid, uuid) is
  'Convert a completed / shipped project into a draft invoice. Idempotent by (org_id, project_id, status=draft). p_caller_org_id closes the cross-tenant gate per the 0041 pattern.';
