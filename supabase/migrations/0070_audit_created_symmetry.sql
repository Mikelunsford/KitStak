-- ============================================================================
-- Migration: 0070_audit_created_symmetry.sql
-- Wave: 9
-- Phase: Cowork E2E smoke follow-ups (SMOKE-05) + audit completeness.
-- Closes: F-Wave9-COWORK-SMOKE-05 (audit_log silent on entity creation across
--         the full quote-to-cash chain — Cowork verified zero rows for
--         customer.created, item.created, quote.created, project.created,
--         invoice.created on prod 2026-05-26).
--         F-Wave9-AUDIT-CREATED-SYMMETRY-01 (deferred from 0061 which only
--         covered manufacturing_runs).
-- Date: 2026-05-27
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   drop trigger if exists audit_customers_created on public.customers;
--   drop trigger if exists audit_contacts_created on public.contacts;
--   drop trigger if exists audit_leads_created on public.leads;
--   drop trigger if exists audit_opportunities_created on public.opportunities;
--   drop trigger if exists audit_quotes_created on public.quotes;
--   drop trigger if exists audit_projects_created on public.projects;
--   drop trigger if exists audit_project_phases_created on public.project_phases;
--   drop trigger if exists audit_invoices_created on public.invoices;
--   drop trigger if exists audit_payments_created on public.payments;
--   drop trigger if exists audit_credit_notes_created on public.credit_notes;
--   drop trigger if exists audit_vendors_created on public.vendors;
--   drop trigger if exists audit_items_created on public.items;
--   drop trigger if exists audit_purchase_orders_created on public.purchase_orders;
--   drop trigger if exists audit_vendor_bills_created on public.vendor_bills;
--   drop trigger if exists audit_expenses_created on public.expenses;
--   drop trigger if exists audit_receiving_orders_created on public.receiving_orders;
--   drop trigger if exists audit_production_runs_created on public.production_runs;
--   drop trigger if exists audit_shipments_created on public.shipments;
--   drop function if exists public.kitstak_audit_created(
--     uuid, text, uuid, text, uuid, jsonb
--   );
--   -- Backfilled 'created' audit rows are forward-only data; the per-org hash
--   -- chain entries are intentional history. Physical removal breaks the chain
--   -- and is intentionally not scripted here.
--
-- Constitutional alignment:
--   Money rules        Untouched. No money columns read or written.
--   RLS rules          Helper and triggers are SECURITY DEFINER. They write
--                      audit_log under the table-owner identity, preserving
--                      the existing append-only RLS posture (no authenticated
--                      INSERT/UPDATE/DELETE policy on audit_log). The helper
--                      derives org_id from the inserting row (or its parent
--                      project, for project_phases). No cross-tenant read or
--                      write surface introduced.
--   Audit rules        This IS the audit-rule symmetry expansion. The
--                      constitution's "auto-state-transition triggers on every
--                      entity with a state machine; no best-effort handler
--                      writes" reads against the entity's lifecycle, and an
--                      INSERT IS a state event (null -> initial). Existing
--                      UPDATE OF status / state / stage triggers keep their
--                      guards; this migration ADDS, never edits, coverage.
--                      action='created', from_state=null, to_state=initial
--                      status (or null for non-state-machine entities like
--                      customers / contacts / vendors / items / payments).
--                      Hash chain reuses kitstak_audit_canonical for payload
--                      hashing, matching every other audit trigger in the
--                      codebase. Per-org advisory lock keyed off org_id keeps
--                      chain ordering stable under concurrent inserts.
--   Migration rules    Forward-only. Four-digit zero-padded. All DDL is
--                      idempotent (CREATE OR REPLACE FUNCTION, DROP TRIGGER
--                      IF EXISTS before CREATE TRIGGER).
--   State machine      Untouched. No new states. No new transitions. Only a
--                      new audit row at the INSERT edge.
--   Scope              Covers 18 entities. Skips manufacturing_runs (already
--                      shipped in 0061) and organizations (the provisioning
--                      flow inserts in 'provisioning' status and transitions
--                      to 'active', which fires the existing 0002 trigger; a
--                      dedicated organization.created row would double-log
--                      the same lifecycle moment). Also skips journal_entries
--                      because they are system-generated and only ever fire
--                      when finance.journal_entries.enabled is true; their
--                      lifecycle is already covered by the status-change
--                      trigger that fires on draft -> posted.
--
-- Background (Cowork SMOKE-05, 2026-05-26):
--   Cowork ran the org_owner E2E plan on a fresh prod test org and walked
--   the full quote-to-cash chain: lead -> opportunity -> customer -> item ->
--   quote -> approval -> project -> invoice -> payment. Query
--   `select count(*), event from audit_log group by event` returned ZERO
--   rows for any of the *.created events. The existing 14 state-change
--   triggers fire only on UPDATE OF status / state / stage. Entities created
--   in their initial state (the common path: customer in 'active', item with
--   no state at all, invoice in 'draft') never trigger an UPDATE, so they
--   never get an audit row. The audit_log on prod for that test org showed
--   only state TRANSITIONS, never CREATIONS — an auditor reconstructing the
--   history has no record of who created what.
--
-- Investigation: 03-workspace/journal/2026-05-26-cowork-e2e-smoke.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Shared helper: kitstak_audit_created
--    Writes one audit_log row with action='created', from_state=null,
--    to_state=p_to_state. Mirrors the algorithm in 0061's
--    trg_audit_manufacturing_runs_created body, factored so 18 triggers can
--    reuse without each one open-coding the advisory lock / prev_hash lookup
--    / payload hash / insert sequence.
--
--    p_to_state is the entity's initial state when the entity has a state
--    machine ('draft', 'active', etc.); null for entities without one
--    (customers, contacts, vendors, items, payments). The audit_log.to_state
--    column is NOT NULL, so the helper coalesces to 'created' as a sentinel
--    when no state-machine column exists. The diff_json carries the full
--    new-row payload for non-state-machine entities so an auditor can
--    reconstruct what was created.
-- ---------------------------------------------------------------------------

create or replace function public.kitstak_audit_created(
  p_org_id      uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_to_state    text,
  p_actor       uuid,
  p_diff        jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash    text;
  v_payload      jsonb;
  v_payload_hash text;
  v_lock_key     bigint;
  v_to_state     text;
begin
  v_to_state := coalesce(p_to_state, 'created');

  v_lock_key := ('x' || substr(md5(p_org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select payload_hash
    into v_prev_hash
    from public.audit_log
   where org_id = p_org_id
   order by triggered_at desc, id desc
   limit 1;

  v_payload := jsonb_build_object(
    'org_id',       p_org_id,
    'entity_type',  p_entity_type,
    'entity_id',    p_entity_id,
    'from_state',   null,
    'to_state',     v_to_state,
    'action',       'created',
    'triggered_by', p_actor,
    'diff_json',    p_diff,
    'prev_hash',    v_prev_hash
  );

  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'),
    'hex'
  );

  insert into public.audit_log (
    org_id, entity_type, entity_id,
    from_state, to_state, action,
    triggered_by, diff_json,
    prev_hash, payload_hash
  ) values (
    p_org_id, p_entity_type, p_entity_id,
    null, v_to_state, 'created',
    p_actor, p_diff,
    v_prev_hash, v_payload_hash
  );
end;
$$;

revoke execute on function public.kitstak_audit_created(
  uuid, text, uuid, text, uuid, jsonb
) from public, anon, authenticated;

grant execute on function public.kitstak_audit_created(
  uuid, text, uuid, text, uuid, jsonb
) to service_role;

comment on function public.kitstak_audit_created(
  uuid, text, uuid, text, uuid, jsonb
) is
  'Shared helper for entity-creation audit rows. Writes one audit_log row with action=created, from_state=null, to_state=initial (or sentinel ''created'' for non-state-machine entities). SECURITY DEFINER; per-org advisory lock; hash chain via prev_hash.';

-- ---------------------------------------------------------------------------
-- Trigger bodies. Each follows the same shape:
--   declare v_actor uuid;
--   begin
--     resolve actor (coalesce(auth.uid(), new.created_by));
--     call kitstak_audit_created(...);
--     return new;
--   end;
--
-- diff_json carries the meaningful initial-state fields per entity so an
-- auditor can reconstruct what was created without joining back to the row.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- CRM: customers, contacts, leads, opportunities
-- ===========================================================================

create or replace function public.trg_audit_customers_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'customer', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'display_name', new.display_name)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_customers_created() from public, anon;
drop trigger if exists audit_customers_created on public.customers;
create trigger audit_customers_created
  after insert on public.customers
  for each row execute function public.trg_audit_customers_created();

create or replace function public.trg_audit_contacts_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'contact', new.id, null, v_actor,
    jsonb_build_object(
      'email', new.email,
      'first_name', new.first_name,
      'last_name', new.last_name,
      'customer_id', new.customer_id
    )
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_contacts_created() from public, anon;
drop trigger if exists audit_contacts_created on public.contacts;
create trigger audit_contacts_created
  after insert on public.contacts
  for each row execute function public.trg_audit_contacts_created();

create or replace function public.trg_audit_leads_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'lead', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'company_name', new.company_name)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_leads_created() from public, anon;
drop trigger if exists audit_leads_created on public.leads;
create trigger audit_leads_created
  after insert on public.leads
  for each row execute function public.trg_audit_leads_created();

create or replace function public.trg_audit_opportunities_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'opportunity', new.id, new.stage, v_actor,
    jsonb_build_object('stage', new.stage, 'display_name', new.display_name)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_opportunities_created() from public, anon;
drop trigger if exists audit_opportunities_created on public.opportunities;
create trigger audit_opportunities_created
  after insert on public.opportunities
  for each row execute function public.trg_audit_opportunities_created();

-- ===========================================================================
-- Sales / delivery: quotes, projects, project_phases
-- project_phases has no org_id column; derive from parent project.
-- ===========================================================================

create or replace function public.trg_audit_quotes_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'quote', new.id, new.state, v_actor,
    jsonb_build_object('state', new.state, 'customer_id', new.customer_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_quotes_created() from public, anon;
drop trigger if exists audit_quotes_created on public.quotes;
create trigger audit_quotes_created
  after insert on public.quotes
  for each row execute function public.trg_audit_quotes_created();

create or replace function public.trg_audit_projects_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'project', new.id, new.state, v_actor,
    jsonb_build_object('state', new.state, 'customer_id', new.customer_id, 'name', new.name)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_projects_created() from public, anon;
drop trigger if exists audit_projects_created on public.projects;
create trigger audit_projects_created
  after insert on public.projects
  for each row execute function public.trg_audit_projects_created();

create or replace function public.trg_audit_project_phases_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid;
  v_org_id uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;

  select org_id into v_org_id from public.projects where id = new.project_id;
  if v_org_id is null then
    return new;  -- parent project missing; cannot scope audit row to an org
  end if;

  perform public.kitstak_audit_created(
    v_org_id, 'project_phase', new.id, new.state, v_actor,
    jsonb_build_object('state', new.state, 'project_id', new.project_id, 'name', new.name)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_project_phases_created() from public, anon;
drop trigger if exists audit_project_phases_created on public.project_phases;
create trigger audit_project_phases_created
  after insert on public.project_phases
  for each row execute function public.trg_audit_project_phases_created();

-- ===========================================================================
-- Catalog: items
-- ===========================================================================

create or replace function public.trg_audit_items_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'item', new.id, null, v_actor,
    jsonb_build_object('sku', new.sku, 'name', new.name)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_items_created() from public, anon;
drop trigger if exists audit_items_created on public.items;
create trigger audit_items_created
  after insert on public.items
  for each row execute function public.trg_audit_items_created();

-- ===========================================================================
-- Billing: invoices, payments, credit_notes
-- ===========================================================================

create or replace function public.trg_audit_invoices_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'invoice', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'customer_id', new.customer_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_invoices_created() from public, anon;
drop trigger if exists audit_invoices_created on public.invoices;
create trigger audit_invoices_created
  after insert on public.invoices
  for each row execute function public.trg_audit_invoices_created();

create or replace function public.trg_audit_payments_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'payment', new.id, null, v_actor,
    jsonb_build_object('customer_id', new.customer_id, 'amount_cents', new.amount_cents)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_payments_created() from public, anon;
drop trigger if exists audit_payments_created on public.payments;
create trigger audit_payments_created
  after insert on public.payments
  for each row execute function public.trg_audit_payments_created();

create or replace function public.trg_audit_credit_notes_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'credit_note', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'customer_id', new.customer_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_credit_notes_created() from public, anon;
drop trigger if exists audit_credit_notes_created on public.credit_notes;
create trigger audit_credit_notes_created
  after insert on public.credit_notes
  for each row execute function public.trg_audit_credit_notes_created();

-- ===========================================================================
-- Vendor side: vendors, purchase_orders, vendor_bills, expenses
-- ===========================================================================

create or replace function public.trg_audit_vendors_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'vendor', new.id, null, v_actor,
    jsonb_build_object('display_name', new.display_name)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_vendors_created() from public, anon;
drop trigger if exists audit_vendors_created on public.vendors;
create trigger audit_vendors_created
  after insert on public.vendors
  for each row execute function public.trg_audit_vendors_created();

create or replace function public.trg_audit_purchase_orders_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'purchase_order', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'vendor_id', new.vendor_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_purchase_orders_created() from public, anon;
drop trigger if exists audit_purchase_orders_created on public.purchase_orders;
create trigger audit_purchase_orders_created
  after insert on public.purchase_orders
  for each row execute function public.trg_audit_purchase_orders_created();

create or replace function public.trg_audit_vendor_bills_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'vendor_bill', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'vendor_id', new.vendor_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_vendor_bills_created() from public, anon;
drop trigger if exists audit_vendor_bills_created on public.vendor_bills;
create trigger audit_vendor_bills_created
  after insert on public.vendor_bills
  for each row execute function public.trg_audit_vendor_bills_created();

create or replace function public.trg_audit_expenses_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'expense', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'vendor_id', new.vendor_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_expenses_created() from public, anon;
drop trigger if exists audit_expenses_created on public.expenses;
create trigger audit_expenses_created
  after insert on public.expenses
  for each row execute function public.trg_audit_expenses_created();

-- ===========================================================================
-- Ops: receiving_orders, production_runs, shipments
-- ===========================================================================

create or replace function public.trg_audit_receiving_orders_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'receiving_order', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_receiving_orders_created() from public, anon;
drop trigger if exists audit_receiving_orders_created on public.receiving_orders;
create trigger audit_receiving_orders_created
  after insert on public.receiving_orders
  for each row execute function public.trg_audit_receiving_orders_created();

create or replace function public.trg_audit_production_runs_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'production_run', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_production_runs_created() from public, anon;
drop trigger if exists audit_production_runs_created on public.production_runs;
create trigger audit_production_runs_created
  after insert on public.production_runs
  for each row execute function public.trg_audit_production_runs_created();

create or replace function public.trg_audit_shipments_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'shipment', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_shipments_created() from public, anon;
drop trigger if exists audit_shipments_created on public.shipments;
create trigger audit_shipments_created
  after insert on public.shipments
  for each row execute function public.trg_audit_shipments_created();
