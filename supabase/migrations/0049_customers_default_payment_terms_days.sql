-- ============================================================================
-- Migration: 0049_customers_default_payment_terms_days.sql
-- Wave: 7
-- Phase: 7 schema gap-fill (CRM customers payment terms)
-- Closes: F-Wave7-CRM-SCHEMA-01 (re-scoped per PR #38)
-- Date: 2026-05-19
--
-- DOWN MIGRATION (operator-only, not auto-run):
--   alter table public.customers
--     drop column if exists default_payment_terms_days;
--   Not auto-run. Forward-only is constitutional. Drop only on operator review.
--
-- Constitutional alignment:
--   Money rules        No monetary value column. `default_payment_terms_days`
--                      is an integer day count, not cents. The cents discipline
--                      is untouched.
--   RLS rules          Pattern A on public.customers (migration 0007) gates
--                      reads/writes by org_id = current_org_id() plus staff
--                      role. The new nullable column inherits that policy
--                      without policy change. Filter still never throws.
--   Idempotency rules  No new endpoint surface. Idempotency stays enforced at
--                      the handler boundary via respondWithIdempotency().
--   Audit rules        The audit_log hash chain already covers every column
--                      update on public.customers via the table-level update
--                      audit trigger registered in earlier waves; the new
--                      column is automatically captured in the diff payload
--                      because the trigger reflects the whole row, not a
--                      hard-coded column list. No trigger body change needed.
--   Migration rules    Forward-only. DDL is idempotent via `add column if not
--                      exists`. Nullable column, so no backfill is needed and
--                      no multi-stage rollout applies.
--   Zod canon          Side-car schema in _shared/types/crm.ts and the
--                      byte-mirror in apps/web/src/lib/types/crm.ts add the
--                      optional, nullable field in the same PR.
-- ============================================================================

-- The column is nullable so existing rows are unaffected. The check constraint
-- defends against accidental negative day counts at the DB layer; the side-car
-- Zod schema mirrors `nonnegative()` at the handler boundary.

alter table public.customers
  add column if not exists default_payment_terms_days integer null
    check (
      default_payment_terms_days is null
      or default_payment_terms_days >= 0
    );

comment on column public.customers.default_payment_terms_days is
  'Optional default payment terms in days for AR invoices issued to this customer. Null means no customer-level override; the org or invoice default applies.';
