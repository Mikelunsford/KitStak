-- ============================================================================
-- Migration: 0131_quote_line_billing_interval.sql
-- Wave: Recurring billing (ADR 0005, Phase 1a)
-- Phase: P2-2 Phase 1a (author billing_interval on quote lines)
-- Closes: ADR 0005 Phase 1a. Fulfillment revenue is partly recurring (storage
--   is $32/mo, several programs bill standing per-order rates) but the line
--   model was one-time only, so operators hid recurrence inside a one-time line
--   name and recurring revenue was not queryable. This adds the line-level
--   billing_interval so a monthly storage line is tagged monthly, making
--   recurring revenue (MRR) modellable at the quote stage. Carrying the interval
--   through convert_quote_to_project and convert_project_to_invoice onto project
--   and invoice lines is the immediate Phase 1b follow-up; the recurring-invoice
--   generator is Phase 2 (ADR 0005).
-- Date: 2026-06-23
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   alter table public.quote_line_items drop column if exists billing_interval;
--
-- Constitutional alignment:
--   Money rules        billing_interval is line metadata, not money. No _cents
--                      column, no math change. The per-period amount stays the
--                      existing integer line_total_cents; a recurring line is the
--                      same banker's-rounded cents billed repeatedly (the
--                      generator is Phase 2). No float.
--   RLS rules          quote_line_items keeps its 0014 Pattern B parent-join
--                      policies, unchanged. The additive column inherits them.
--   Zod canon          BillingIntervalSchema and the quote-line shapes change in
--                      _shared/types/sales.ts and the apps/web mirror in the same
--                      PR; pnpm test:contract gates the byte-identical parity.
--   Audit rules        Untouched. No new trigger; the column rides the existing
--                      line insert / update writes. The quote audit trigger on
--                      state change is unchanged.
--   Migration rules    Forward-only. DDL is idempotent (ADD COLUMN IF NOT
--                      EXISTS). The CHECK is satisfied by the default for every
--                      existing row.
--   Capabilities       Untouched. Editing a quote line stays on quotes.quote.write.
-- ============================================================================

alter table public.quote_line_items
  add column if not exists billing_interval text not null default 'one_time'
    check (billing_interval in ('one_time', 'monthly'));

comment on column public.quote_line_items.billing_interval is
  'How this line is billed: one_time (default, the historical behaviour) or monthly (recurring, e.g. storage). ADR 0005 Phase 1a. Phase 1b carries it onto project and invoice lines; Phase 2 adds the recurring-invoice generator. Distinct from the org''s own Stripe subscription_status.';
