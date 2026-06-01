-- ============================================================================
-- Migration: 0083_audit_log_entity_type_restore_copack.sql
-- Wave: 10
-- Phase: Pillar 3 (Co-Pack and Ecom) + Pillar 4 (KitForce) regression repair
-- Closes: R-W10-AUDIT-01 (2026-05-31 smoke test P0)
-- Date: 2026-05-31
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0081 CHECK constraint by hand if needed. Note
--    that restoring 0081 re-introduces the very bug this migration closes.)
--
-- Why this migration exists:
--   The audit_log.entity_type CHECK constraint is recreated (guarded
--   drop-then-add) by every migration that introduces a new auditable entity.
--   Migrations 0074 and 0076 correctly added the Co-Pack kitting and
--   fulfillment entity_types:
--       'kitting_job'
--       'kitting_job_consumed_line_item'
--       'kitting_job_produced_line_item'
--       'fulfillment'
--   The KitForce migrations 0078, 0079, 0080, and 0081 each ALSO recreate the
--   constraint, but each copied the enumeration as it stood at 0073
--   (channels/orders) and silently dropped the four entity_types added in 0074
--   and 0076. Because 0081 runs last, its narrower list won on prod. Result:
--   every Co-Pack MAKE write that emits an audit row (fulfillment pick/pack/
--   ship/cancel, kitting job start/complete, kitting consumed/produced
--   components) failed with HTTP 500:
--       new row for relation "audit_log" violates check constraint
--       "audit_log_entity_type_check"
--   Fulfillments were frozen at `pending` and kitting jobs frozen at `draft`,
--   making both marquee Co-Pack features non-functional in production.
--
--   This migration re-adds the constraint with the full authoritative
--   enumeration: the complete 0081 list PLUS the four omitted Co-Pack types.
--   It is a strict superset of every prior enumeration, so no existing
--   audit_log row can violate it.
--
-- Constitutional alignment:
--   Audit rules        audit_log entity_type must enumerate every entity that
--                      a write trigger references. This restores the four
--                      Co-Pack types written by the triggers shipped in 0074,
--                      0075, and 0076. No semantics change: the constraint is
--                      widened, never narrowed.
--   Migration rules    Forward-only. Does not edit 0074/0076/0078-0081. DDL is
--                      idempotent (guarded DROP CONSTRAINT IF EXISTS, then ADD).
--   Append-only audit  No audit_log rows are modified, deleted, or re-hashed.
--                      Only the column CHECK is replaced.
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
    'org_membership',
    -- Sales / CRM
    'customer',
    'contact',
    'activity',
    'lead',
    'opportunity',
    -- Catalog
    'item',
    -- Sales chassis
    'quote',
    'quote_line_item',
    'project',
    'project_phase',
    'project_line_item',
    -- Billing / GL
    'invoice',
    'invoice_line_item',
    'payment',
    'credit_note',
    'journal_entry',
    'period_close',
    -- Procurement / Ops
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
    -- Cross-cutting collab
    'attachment',
    'comment',
    'notification',
    -- Pillar 2 Manufacturing
    'manufacturing_run',
    'manufacturing_run_consumed_line_item',
    'manufacturing_run_produced_line_item',
    -- Pillar 3 Co-Pack and Ecom (channels/orders, 0073)
    'sales_channel',
    'sales_order',
    'sales_order_line_item',
    -- Pillar 3 Co-Pack and Ecom (kitting, 0074) -- omitted by 0078-0081, restored here
    'kitting_job',
    'kitting_job_consumed_line_item',
    'kitting_job_produced_line_item',
    -- Pillar 3 Co-Pack and Ecom (fulfillment, 0076) -- omitted by 0078-0081, restored here
    'fulfillment',
    -- Pillar 4 KitForce workforce (0078)
    'workforce_member',
    'workforce_team',
    'workforce_team_member',
    -- Pillar 4 KitForce shifts (0079)
    'shift',
    -- Pillar 4 KitForce assignments (0080)
    'work_assignment',
    -- Pillar 4 KitForce time entries (0081)
    'time_entry'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Authoritative full list as of 0083, which restored the Co-Pack kitting + fulfillment types that 0078-0081 dropped. Update via forward migration when a new state machine ships, and never subset the prior list.';
