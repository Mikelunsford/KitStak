-- ============================================================================
-- Migration: 0060_invoice_convert_use_numbering_chassis.sql
-- Wave: 9
-- Phase: B8 (post-2026-05-21 E2E smoke walk)
-- Closes: F-Wave9-AUTO-NUMBERING-01 (DB portion). Replaces the ad-hoc
--   `INV-YYYYMMDD-<8hex>` invoice numbering inside
--   convert_project_to_invoice (shipped in 0045) with a call to the org-
--   scoped numbering chassis (public.next_doc_number(p_org_id, 'invoice')).
--   Handler-side changes for Quote / Receiving Order / Shipment land in the
--   same PR as application code (quotes-api, ops-api).
-- Date: 2026-05-21
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- Restore the prior body verbatim by re-applying the
--   -- convert_project_to_invoice from 0045_convert_project_to_invoice.sql.
--   -- Operator copies that file's body into a fresh forward migration.
--
-- Constitutional alignment:
--   Money rules        Untouched. unit_price_cents copy logic, recompute call,
--                      and per-line discount math are byte-identical to the
--                      0045 body. No floats touched.
--   RLS rules          Untouched. SECURITY DEFINER + p_caller_org_id gate
--                      preserved verbatim. NOT_FOUND on cross-tenant /
--                      missing project preserved. The 0041 pitfall #10
--                      pattern (public.current_org_id() returns NULL under
--                      service-role) still applies.
--   Audit rules        Untouched. Invoice creation fires the existing 0024
--                      audit trigger; invoice_line_items audit path
--                      unchanged.
--   Idempotency        Untouched. Existing draft invoice for the same
--                      project short-circuits before next_doc_number is
--                      called, so replays do NOT burn sequence values.
--   Migration rules    Forward-only. CREATE OR REPLACE FUNCTION is
--                      idempotent. All DDL idempotent.
--   State machine     Untouched. Same billable-state gate.
--
-- Out of scope:
--   * Handler wiring for quotes-api / ops-api (calling nextDocNumber on
--     create). Ships in the same PR but is application code, not DDL.
--   * SPA form updates (drop the number input). Application code.
--
-- B8 background:
--   The 0045 body computed `v_invoice_number := 'INV-' || to_char(now(),
--   'YYYYMMDD') || '-' || substr(replace(p_project_id::text, '-', ''), 1, 8)`
--   with a collision-suffix branch. That predates the operator-visible
--   numbering admin UI (which exists today and exposes per-org sequence
--   prefix / pad / reset config). The chassis call honours operator config;
--   the ad-hoc string did not. After this migration the operator who sets
--   `prefix = 'INV/'` and `pad_width = 6` on the invoice numbering row sees
--   convert-to-invoice produce `INV/2026-000001` instead of
--   `INV-20260521-deadbeef`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Backfill: re-seed numbering_sequences rows for every existing org. 0038
-- defined seed_org_numbering() but only newly-provisioned orgs called it.
-- 0054 backfilled `manufacturing_run` but not the other 10 doc_types. The
-- 2026-05-21 E2E smoke walk surfaced that pre-0038 orgs miss some rows; the
-- numbering admin page therefore shows partial coverage. Per-org call is
-- idempotent (seed_org_numbering uses ON CONFLICT DO NOTHING for every
-- doc_type) so this is safe to re-run.
-- ---------------------------------------------------------------------------

do $$
declare
  v_row record;
begin
  for v_row in
    select id from public.organizations
  loop
    perform public.seed_org_numbering(v_row.id);
  end loop;
end$$;

-- ---------------------------------------------------------------------------
-- Rewrite convert_project_to_invoice. The function body is otherwise
-- byte-identical to the 0045 version. Only the v_invoice_number assignment
-- changes: an ad-hoc string -> a chassis call.
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
  -- IMPORTANT: this branch fires BEFORE next_doc_number so replays do NOT
  -- burn sequence values.
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

  -- F-Wave9-AUTO-NUMBERING-01 (B8): use the org-scoped numbering chassis
  -- instead of the prior ad-hoc 'INV-YYYYMMDD-<8hex>' construction. The
  -- chassis (numbering_sequences + next_doc_number from 0004 / 0038)
  -- honours per-org prefix / pad_width / reset_period configured via the
  -- numbering admin page. Advisory lock inside next_doc_number is
  -- per-(org, doc_type) so concurrent converts serialise within an org
  -- without holding back other doc types.
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
  'Convert a completed / shipped project into a draft invoice. Idempotent by (org_id, project_id, status=draft). p_caller_org_id closes the cross-tenant gate per the 0041 pattern. Invoice number allocated via next_doc_number (0060, F-Wave9-AUTO-NUMBERING-01).';
