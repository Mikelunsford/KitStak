-- ============================================================================
-- Migration: 0058_invoice_paid_status_transition.sql
-- Wave: 9
-- Phase: E2E smoke test follow-ups (Path D bug-fix bundle, PR-1)
-- Closes: F-Wave9-INVOICE-PAID-TRANSITION-01 (B2 from 2026-05-21 E2E smoke).
--         Cascade-closes F-Wave9-KITCOST-DASHBOARD-REVENUE-01 (B1) because
--         dashboard-api filters `.eq('status', 'paid')` and the upstream
--         status flip was the missing link.
-- Date: 2026-05-21
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- Restore the prior recompute_invoice_paid body that only writes paid_cents.
--   create or replace function public.recompute_invoice_paid(p_invoice_id uuid)
--   returns void
--   language plpgsql
--   security definer
--   set search_path = public
--   as $$
--   declare
--     v_paid bigint;
--   begin
--     select coalesce(sum(amount_cents), 0)
--       into v_paid
--       from public.payment_allocations
--      where invoice_id = p_invoice_id;
--     update public.invoices
--        set paid_cents = v_paid,
--            updated_at = now()
--      where id = p_invoice_id;
--   end;
--   $$;
--   -- Backfilled status / paid_at values stay (do not re-stuck at 'sent').
--
-- Constitutional alignment:
--   Money rules        Untouched. paid_cents / total_cents / credit_allocated_cents /
--                      balance_cents (GENERATED) all keep their BIGINT cents
--                      shape. No floating-point math added; the comparison
--                      `paid_cents + credit_allocated_cents >= total_cents`
--                      is integer arithmetic.
--   RLS rules          Untouched. recompute_invoice_paid is SECURITY DEFINER
--                      (per 0019); RLS on invoices is unaffected because the
--                      function writes directly via the table-owner identity.
--   Audit rules        Audit log fires automatically. `invoice_audit_state_change`
--                      trigger (0024 line 179) fires AFTER UPDATE OF status on
--                      invoices and calls kitstak_audit_state for any status
--                      change. We update status -> 'paid' / 'partially_paid'
--                      from within recompute_invoice_paid; the trigger writes
--                      the audit_log row with proper hash chain. No
--                      best-effort handler writes added.
--   Migration rules    Forward-only. Idempotent (CREATE OR REPLACE FUNCTION;
--                      backfill is an UPDATE with predicate that becomes a
--                      no-op on re-run once stuck rows are fixed).
--   State machine     The invoice status enum already includes 'paid' and
--                      'partially_paid' (0018 lines 38-42). No new states
--                      introduced. We auto-flip from a closed allowlist of
--                      live states (pending / sent / partially_paid /
--                      overdue) so cancelled / refunded / on_hold invoices
--                      stay where the operator put them even if the math
--                      coincidentally reaches zero. 'draft' is excluded
--                      because draft invoices should not carry allocations
--                      (handler-level guard) and even if they do, the
--                      operator hasn't approved sending yet.
--
-- Background (B2 from the 2026-05-21 E2E smoke walk):
--   Operator's smoke walk produced SMOKE-PAY-001 (payment) fully allocated
--   against INV-20260521-AD35B5D1 (invoice, total $5,000). After allocation,
--   `invoices.paid_cents = 500000`, `balance_cents = 0` (GENERATED), but
--   `invoices.status` stayed at 'sent'. AuditTimeline showed no
--   `invoice.paid` row.
--
--   Root cause: `recompute_invoice_paid` from 0019 (lines 125-144) writes
--   paid_cents and updated_at only. The function never compares
--   `paid_cents + credit_allocated_cents` against `total_cents` to flip
--   `status` or stamp `paid_at`.
--
--   Cascade: dashboard-api/index.ts lines 200, 219, 226 filter
--   `.eq('status', 'paid')`. Total Revenue YTD, Top Customers, Revenue
--   Trend all stayed at $0 because no invoice ever reached `paid`.
--
-- Investigation: 03-workspace/journal/2026-05-21-e2e-smoke-investigation.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Redefine recompute_invoice_paid to also flip status + stamp paid_at.
--
-- Behavior matrix (read-after-recompute):
--   paid >= total AND status in (pending, sent, partially_paid, overdue)
--     -> status = 'paid', paid_at = now()
--   0 < paid < total AND status in (pending, sent, overdue)
--     -> status = 'partially_paid' (paid_at stays null)
--   paid == 0 AND status = 'partially_paid'
--     -> status = 'sent' (allocations were deleted; revert to live state)
--   draft / cancelled / refunded / on_hold -> untouched.
--
-- The function reads the *new* totals (paid_cents already updated in this
-- transaction) and the *current* status to decide whether to transition.
-- paid_at is only stamped on the 0 -> paid edge (preserve original stamp on
-- re-recompute against an already-paid invoice).
-- ---------------------------------------------------------------------------

create or replace function public.recompute_invoice_paid(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid                   bigint;
  v_total                  bigint;
  v_credit                 bigint;
  v_current_status         text;
  v_current_paid_at        timestamptz;
  v_target_status          text;
  v_target_paid_at         timestamptz;
begin
  select coalesce(sum(amount_cents), 0)
    into v_paid
    from public.payment_allocations
   where invoice_id = p_invoice_id;

  update public.invoices
     set paid_cents = v_paid,
         updated_at = now()
   where id = p_invoice_id;

  -- Read the post-update row so we can decide the status transition.
  select total_cents, credit_allocated_cents, status, paid_at
    into v_total, v_credit, v_current_status, v_current_paid_at
    from public.invoices
   where id = p_invoice_id;

  -- Resolve the target status from the allowlist. NULL means leave alone.
  v_target_status := null;

  if v_current_status in ('pending', 'sent', 'partially_paid', 'overdue') then
    if v_paid + v_credit >= v_total and v_total > 0 then
      v_target_status := 'paid';
    elsif v_paid > 0 then
      v_target_status := 'partially_paid';
    elsif v_current_status = 'partially_paid' then
      -- Allocations dropped back to zero; revert to the live posted state.
      v_target_status := 'sent';
    end if;
  end if;

  -- paid_at is stamped only on the 0 -> paid edge. Preserve operator-set or
  -- prior-transition paid_at when re-recomputing.
  v_target_paid_at := v_current_paid_at;
  if v_target_status = 'paid' and v_current_paid_at is null then
    v_target_paid_at := now();
  end if;

  if v_target_status is not null and v_target_status <> v_current_status then
    update public.invoices
       set status = v_target_status,
           paid_at = v_target_paid_at,
           updated_at = now()
     where id = p_invoice_id;
  end if;
end;
$$;

revoke execute on function public.recompute_invoice_paid(uuid)
  from public, anon;
grant execute on function public.recompute_invoice_paid(uuid)
  to authenticated, service_role;

comment on function public.recompute_invoice_paid(uuid) is
  'Recomputes invoices.paid_cents from payment_allocations and auto-transitions invoices.status between sent / partially_paid / paid (and back) based on the live total. Stamps paid_at on the 0 -> paid edge only. SECURITY DEFINER. Audit log fires via invoice_audit_state_change trigger from 0024.';

-- ---------------------------------------------------------------------------
-- 2) Backfill historical invoices stuck at 'sent' (or similar live states)
--    with balance_cents = 0. The PR-1 fix only repairs the function; the
--    smoke-test invoice INV-20260521-AD35B5D1 plus any other prod or staging
--    rows that allocated payments under the old function are still wrong.
--
--    We re-run recompute_invoice_paid against every candidate row. The
--    function is idempotent so re-running against already-correct rows is a
--    no-op. Bounding by the source-state allowlist keeps the backfill
--    cheap and predictable.
--
--    Audit log emission: this backfill triggers invoice_audit_state_change
--    once per row that flips. That's the intended behavior; the audit trail
--    should record that the system corrected the status.
-- ---------------------------------------------------------------------------

do $$
declare
  v_row record;
begin
  for v_row in
    select id
      from public.invoices
     where deleted_at is null
       and status in ('pending', 'sent', 'partially_paid', 'overdue')
       and paid_cents > 0
       and (
            paid_cents + credit_allocated_cents >= total_cents
         or paid_cents < total_cents
       )
  loop
    perform public.recompute_invoice_paid(v_row.id);
  end loop;
end$$;
