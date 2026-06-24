-- ============================================================================
-- Migration: 0138_recurring_invoice_generator.sql
-- Wave: Recurring billing (ADR 0005, Phase 2)
-- Phase: The recurring-invoice generator. ADR 0005 Phase 1 tagged lines monthly
--   and carried billing_interval quote -> project -> invoice (0131 / 0136 / 0137).
--   Phase 2 closes the loop: a recurring_schedules table plus a pg_cron job that,
--   each day, drafts an invoice from each due project's monthly project lines. The
--   generation is pure in-DB money work (insert invoice + lines with the same
--   banker's-rounded math convert_project_to_invoice uses), so it is a SQL
--   SECURITY DEFINER function called by cron directly, not an edge round-trip via
--   pg_net (unlike the 0056 notifications-drain, which needs the edge for Resend).
-- Closes: ADR 0005 Phase 2 (recurring-invoice generator + recurring_schedules).
-- Date: 2026-06-24
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   select cron.unschedule('generate-recurring-invoices');
--   drop function if exists public.generate_recurring_invoices(date);
--   drop table if exists public.recurring_schedules;
--   Generated invoices are real documents; they are NOT deleted on rollback.
--
-- Constitutional alignment:
--   Money rules        The drafted invoice lines reuse the exact 0137 /
--                      convert_project_to_invoice math: gross / discount / tax /
--                      line_total are banker's-rounded (round_half_even) over
--                      BIGINT cents, tax snapshotted from the project line's
--                      tax_rate_id. No float authority, no new rounding. Only
--                      monthly project lines are billed (the recurring revenue);
--                      one_time lines are excluded.
--   RLS rules          recurring_schedules ships with RLS in this creation
--                      migration: Pattern A (org_id = current_org_id() for select;
--                      write gated to org_owner / org_admin / accounting). The
--                      generator is SECURITY DEFINER and runs as its owner under
--                      pg_cron (the postgres superuser), so it is org-correct by
--                      the schedule's own org_id; it never relies on
--                      current_org_id().
--   Audit rules        The drafted invoice + lines carry no hand-written audit
--                      (invoices have no INSERT audit trigger; the state machine
--                      audits transitions), exactly like convert_project_to_invoice
--                      and approve_billing_review.
--   Idempotency        The generator advances each processed schedule's next_run_on
--                      by one month inside the same transaction as the draft, so a
--                      second run on the same day finds next_run_on already in the
--                      future and generates nothing for that period. pg_cron runs a
--                      job single-threaded, so there is no intra-run concurrency.
--                      A backlog (a missed day) catches up one period per daily run.
--   Migration rules    Forward-only. All DDL is idempotent (CREATE TABLE / INDEX /
--                      EXTENSION IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
--                      cron.schedule upserts on jobname). Re-runs are safe.
--   Grants             generate_recurring_invoices is service_role only (revoked
--                      from public / anon / authenticated); cron runs it as the
--                      superuser seam.
--   Capabilities       No new capability. A future schedule-CRUD edge endpoint will
--                      gate on the invoicing write caps; the table RLS already
--                      restricts the authenticated write path to the finance roles.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- recurring_schedules: one active monthly schedule per project that bills
-- recurring (monthly) lines. Pattern A RLS on org_id.
-- ---------------------------------------------------------------------------
create table if not exists public.recurring_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  cadence text not null default 'monthly' check (cadence in ('monthly')),
  next_run_on date not null,
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  last_run_on date,
  last_invoice_id uuid references public.invoices(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists recurring_schedules_due_idx
  on public.recurring_schedules (status, next_run_on);
create index if not exists recurring_schedules_org_idx
  on public.recurring_schedules (org_id);

alter table public.recurring_schedules enable row level security;

drop policy if exists recurring_schedules_select on public.recurring_schedules;
create policy recurring_schedules_select on public.recurring_schedules
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists recurring_schedules_write on public.recurring_schedules;
create policy recurring_schedules_write on public.recurring_schedules
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'accounting')
  );

comment on table public.recurring_schedules is
  'A monthly recurring-billing schedule for a project (ADR 0005 Phase 2). The generator drafts an invoice from the project''s monthly lines on next_run_on, then advances next_run_on one month. Pattern A RLS on org_id.';

-- ---------------------------------------------------------------------------
-- generate_recurring_invoices: drafts an invoice from each due schedule's project
-- monthly lines, then advances the schedule. Returns the count generated. Called
-- daily by pg_cron. SECURITY DEFINER, service_role only.
-- ---------------------------------------------------------------------------
create or replace function public.generate_recurring_invoices(
  p_today date default current_date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule record;
  v_org_id uuid;
  v_customer_id uuid;
  v_currency text;
  v_quote_id uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_line_count integer;
  v_generated integer := 0;
begin
  for v_schedule in
    select * from public.recurring_schedules
     where status = 'active' and next_run_on <= p_today
     order by next_run_on, id
  loop
    select p.org_id, p.customer_id, p.currency_code, p.source_quote_id
      into v_org_id, v_customer_id, v_currency, v_quote_id
      from public.projects p
     where p.id = v_schedule.project_id;

    -- Only draft when the project has recurring (monthly) lines to bill.
    select count(*) into v_line_count
      from public.project_line_items pli
     where pli.project_id = v_schedule.project_id
       and pli.billing_interval = 'monthly';

    v_invoice_id := null;

    if v_org_id is not null and v_line_count > 0 then
      v_invoice_number := public.next_doc_number(v_org_id, 'invoice');

      insert into public.invoices (
        org_id, invoice_number, customer_id, project_id, quote_id,
        status, currency_code, issue_date, created_by, updated_by
      ) values (
        v_org_id, v_invoice_number, v_customer_id, v_schedule.project_id, v_quote_id,
        'draft', v_currency, p_today, v_schedule.created_by, v_schedule.created_by
      )
      returning id into v_invoice_id;

      -- Carry the monthly project lines onto the invoice. Identical banker's-
      -- rounded math to convert_project_to_invoice (0137); only monthly lines.
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
        v_schedule.created_by,
        v_schedule.created_by
      from public.project_line_items pli
      left join public.taxes t
        on t.id = pli.tax_rate_id and t.org_id = pli.org_id
      where pli.project_id = v_schedule.project_id
        and pli.billing_interval = 'monthly'
      order by pli.position;

      perform public.recompute_invoice_totals(v_invoice_id);
      v_generated := v_generated + 1;
    end if;

    -- Advance the schedule one period regardless (idempotency: a re-run today
    -- finds next_run_on in the future). last_invoice_id updates only on a draft.
    update public.recurring_schedules
       set last_run_on = p_today,
           last_invoice_id = coalesce(v_invoice_id, last_invoice_id),
           next_run_on = (next_run_on + interval '1 month')::date,
           updated_at = now()
     where id = v_schedule.id;
  end loop;

  return v_generated;
end;
$$;

revoke execute on function public.generate_recurring_invoices(date)
  from public, anon, authenticated;
grant execute on function public.generate_recurring_invoices(date)
  to service_role;

comment on function public.generate_recurring_invoices(date) is
  'pg_cron callback (ADR 0005 Phase 2). Drafts an invoice from each due recurring_schedules project''s monthly lines, then advances next_run_on one month (idempotent per period). service_role only.';

-- ---------------------------------------------------------------------------
-- Schedule: daily at 06:00 UTC. cron.schedule upserts on jobname, so re-applying
-- is safe. pg_cron is pre-installed on Supabase (0056 already enabled it).
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'generate-recurring-invoices',
  '0 6 * * *',
  $$select public.generate_recurring_invoices();$$
);
