-- ============================================================================
-- Migration: 0036_audit_log_entity_type_extend.sql
-- Wave: 2
-- Phase: Cross-cutting collaboration
-- Closes: R-W2-AUDIT-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop the new CHECK constraint. Not auto-run.
--
-- Constitutional alignment:
--   Audit rules      audit_log entity_type must enumerate every entity that
--                    has a state machine or that is referenced by a write
--                    trigger. We list 30 explicit types here, covering the
--                    14 state machines (org + 13 from Phase 2 agents) and
--                    the collab tables that get their own audit rows.
--   Migration rules  Forward-only. DDL idempotent (DROP CONSTRAINT IF EXISTS).
-- ============================================================================

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.audit_log'::regclass
       and conname  = 'audit_log_entity_type_check'
  ) then
    alter table public.audit_log
      drop constraint audit_log_entity_type_check;
  end if;
end$$;

alter table public.audit_log
  add constraint audit_log_entity_type_check
  check (entity_type in (
    -- Wave 1 identity
    'organization',
    -- Sales / CRM (Agent B)
    'customer',
    'contact',
    'activity',
    'lead',
    'opportunity',
    -- Catalog (cross-domain)
    'item',
    -- Sales chassis (Agent C)
    'quote',
    'quote_line_item',
    'project',
    'project_phase',
    -- Billing / GL (Agent D)
    'invoice',
    'invoice_line_item',
    'payment',
    'credit_note',
    'journal_entry',
    'period_close',
    -- Procurement / Ops (Agent E)
    'vendor',
    'purchase_order',
    'po_line_item',
    'vendor_bill',
    'expense',
    'warehouse',
    'stock_movement',
    'receiving_order',
    'production_run',
    'shipment',
    -- Cross-cutting collab (Agent F)
    'attachment',
    'comment',
    'notification'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Update via forward migration when a new state machine ships.';
