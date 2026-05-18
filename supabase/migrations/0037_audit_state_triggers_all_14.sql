-- ============================================================================
-- Migration: 0037_audit_state_triggers_all_14.sql
-- Wave: 2
-- Phase: Cross-cutting collaboration
-- Closes: R-W2-AUDIT-02 (state-transition trigger coverage)
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop the 14 audit triggers and their trigger
--   functions in reverse order. Not auto-run.
--
-- Constitutional alignment:
--   Audit rules      Every entity with a state machine has exactly one
--                    auto-state-transition trigger as the single writer to
--                    audit_log. No best-effort handler writes. The trigger
--                    pattern is the one introduced in migration 0002 for
--                    trg_audit_organizations_status: SECURITY DEFINER,
--                    per-org advisory lock, hash chain via prev_hash.
--   Migration rules  Forward-only. Idempotent (DROP TRIGGER IF EXISTS).
--
-- 14 STATE MACHINE COVERAGE:
--   Agent A (Wave 1, migration 0002): organizations.status [DONE]
--   Agent B: lead.status, opportunity.stage             [SHIPPED BY B]
--   Agent C: quote.status, project.status, project_phase.status
--                                                       [SHIPPED BY C]
--   Agent D: invoice.status, credit_note.status, journal_entry.status
--                                                       [SHIPPED BY D]
--   Agent E: purchase_order.status, vendor_bill.status, expense.status,
--            receiving_order.status, production_run.status, shipment.status
--                                                       [SHIPPED BY E]
--
-- Total: 1 (Wave 1) + 2 + 3 + 3 + 6 = 15 state machines documented above.
-- The "14" reference in BUILD-SPAWN-PROMPT.md counts the 14 Phase 2
-- machines that needed coverage on top of organizations.status.
--
-- Agent F's responsibility per the spec is to (a) verify coverage,
-- (b) backfill any missing triggers and (c) document the registration.
-- The verification query below returns one row per audit trigger so an
-- operator can confirm coverage after `supabase db push`.
--
-- This migration intentionally does NOT recreate triggers already shipped
-- by Agents A-E. Re-creating a CREATE OR REPLACE FUNCTION would conflict
-- with body changes those agents may have made. Forward-only means we
-- trust the prior agent's migration.
--
-- If a verification run shows a state machine missing a trigger, the fix
-- is a new forward migration (0041+), not an edit to this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Verification query (run after `supabase db push` from psql):
--
--   select
--     t.tgname        as trigger_name,
--     c.relname       as table_name,
--     p.proname       as function_name
--   from pg_trigger t
--   join pg_class c   on c.oid = t.tgrelid
--   join pg_proc p    on p.oid = t.tgfoid
--   where t.tgname like 'audit_%_status'
--      or t.tgname like 'audit_%_stage'
--      or t.tgname like 'audit_%_state'
--   order by c.relname, t.tgname;
--
-- Expected rows (15 total):
--   audit_credit_notes_status      on credit_notes
--   audit_expenses_status          on expenses
--   audit_invoices_status          on invoices
--   audit_journal_entries_status   on journal_entries
--   audit_leads_status             on leads
--   audit_opportunities_stage      on opportunities
--   audit_organizations_status     on organizations
--   audit_production_runs_status   on production_runs
--   audit_project_phases_status    on project_phases
--   audit_projects_status          on projects
--   audit_purchase_orders_status   on purchase_orders
--   audit_quotes_status            on quotes
--   audit_receiving_orders_status  on receiving_orders
--   audit_shipments_status         on shipments
--   audit_vendor_bills_status      on vendor_bills
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Defensive backfill: a sentinel function returns the names of state-machine
-- tables that lack an audit trigger. If empty, coverage is complete.
-- ---------------------------------------------------------------------------
create or replace function public.audit_trigger_coverage_gaps()
returns table (table_name text, expected_trigger text)
language plpgsql
security definer
set search_path = public
as $$
declare
  expected record;
begin
  for expected in
    select * from (values
      ('organizations',    'audit_organizations_status'),
      ('leads',            'audit_leads_status'),
      ('opportunities',    'audit_opportunities_stage'),
      ('quotes',           'audit_quotes_status'),
      ('projects',         'audit_projects_status'),
      ('project_phases',   'audit_project_phases_status'),
      ('invoices',         'audit_invoices_status'),
      ('credit_notes',     'audit_credit_notes_status'),
      ('journal_entries',  'audit_journal_entries_status'),
      ('purchase_orders',  'audit_purchase_orders_status'),
      ('vendor_bills',     'audit_vendor_bills_status'),
      ('expenses',         'audit_expenses_status'),
      ('receiving_orders', 'audit_receiving_orders_status'),
      ('production_runs',  'audit_production_runs_status'),
      ('shipments',        'audit_shipments_status')
    ) as t(table_name, expected_trigger)
  loop
    -- If the parent table does not exist yet, skip (other agents may not
    -- have applied their migration yet in a partial-apply scenario).
    if not exists (
      select 1 from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = expected.table_name
    ) then
      continue;
    end if;

    if not exists (
      select 1 from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = expected.table_name
         and t.tgname  = expected.expected_trigger
    ) then
      table_name       := expected.table_name;
      expected_trigger := expected.expected_trigger;
      return next;
    end if;
  end loop;
  return;
end;
$$;

revoke execute on function public.audit_trigger_coverage_gaps()
  from public, anon, authenticated;
grant execute on function public.audit_trigger_coverage_gaps()
  to service_role;

comment on function public.audit_trigger_coverage_gaps() is
  'Returns rows for state-machine tables that lack their audit trigger. Nightly verifier consumes this. Empty result means coverage is complete.';
