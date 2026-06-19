-- =============================================================================
-- Migration: 0126_money_banker_rounding.sql
-- Wave:      Production readiness 2026-06-18 (R-W14-MONEY-02)
-- Phase:     Money integrity hardening
-- Closes:    R-W14-MONEY-02 (SQL money arithmetic used Postgres round(), which
--            is round-half-away-from-zero on the numeric type, not the
--            constitution's mandated banker's rounding roundHalfEven).
-- Date:      2026-06-18
--
-- Constitutional alignment:
--   Money rules   This is the point of the migration. Introduces a SQL
--                 round_half_even(numeric) helper whose tie-breaking logic is
--                 line-for-line identical to apps/web/src/lib/money.ts and
--                 _shared/money.ts roundHalfEven (floor-based: diff < 0.5 ->
--                 floor, diff > 0.5 -> floor + 1, diff = 0.5 -> nearest even).
--                 Replaces every money-math round() call site in the four live
--                 objects that perform cents arithmetic. No _cents column type
--                 changes; storage stays BIGINT cents. No float introduced.
--   RLS rules     view_job_profitability is recreated WITH
--                 (security_invoker = true), preserving the existing option so
--                 the view continues to honour the caller's RLS on
--                 job_runs / job_run_daily_logs / projects / invoices. Dropping
--                 that option would run the view as owner and bypass RLS; it is
--                 preserved verbatim. The three functions keep SECURITY DEFINER
--                 SET search_path = public exactly as before.
--   Idempotency   Untouched. No idempotency_keys change.
--   Audit log     Untouched. No audit_log change.
--
-- Behaviour change: computed cents values that land on an exact half-cent
-- boundary now round to the nearest even cent instead of away from zero. The
-- affected paths are the project-to-invoice conversion (future conversions),
-- the project budget rollup (future recomputes), the billing-review actual
-- cost snapshot (future approvals), and the job-profitability view (read-time,
-- derived, not stored). Already-stored amounts are not rewritten. The only
-- numerical difference is at most one cent on values whose pre-rounding
-- fractional part is exactly 0.5.
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   Re-run the 0060 / 0059 / 0102 / 0122 definitions of
--   convert_project_to_invoice, recompute_project_totals,
--   approve_billing_review, and view_job_profitability with their original
--   round() calls, then: DROP FUNCTION IF EXISTS public.round_half_even(numeric);
--
-- All DDL is idempotent (CREATE OR REPLACE).
-- =============================================================================

-- 1. Banker's-rounding helper. Pure numeric math, no table access. Mirrors the
--    TS roundHalfEven exactly so the SQL and SPA money layers agree at the tie.
create or replace function public.round_half_even(p_value numeric)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_value - floor(p_value) < 0.5 then floor(p_value)
    when p_value - floor(p_value) > 0.5 then floor(p_value) + 1
    when floor(p_value) % 2 = 0 then floor(p_value)
    else floor(p_value) + 1
  end;
$$;

comment on function public.round_half_even(numeric) is
  'Banker''s rounding to the nearest integer (half to even). Byte-for-byte tie-break parity with apps/web/src/lib/money.ts roundHalfEven. Use for all SQL money-cents arithmetic; the built-in Postgres numeric rounding is half-away-from-zero, which the constitution forbids for money.';

revoke all on function public.round_half_even(numeric) from public;
grant execute on function public.round_half_even(numeric) to authenticated, service_role;

-- 2. convert_project_to_invoice: replace the three discount/gross round() calls.
--    Body is the live 0060 definition with round( -> public.round_half_even(.
create or replace function public.convert_project_to_invoice(p_project_id uuid, p_caller_org_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  select org_id, state, customer_id, currency_code, source_quote_id
    into v_org_id, v_state, v_customer_id, v_currency, v_quote_id
    from public.projects
   where id = p_project_id;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: project not found' using errcode = 'P0001';
  end if;

  if v_state not in ('ready_to_ship', 'completed') then
    raise exception 'STATE_CONFLICT: project not in billable state (was %)', v_state
      using errcode = 'P0001';
  end if;

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
    public.round_half_even((pli.quantity * pli.unit_price_cents * pli.discount_percent / 100.0))::bigint,
    public.round_half_even((pli.quantity * pli.unit_price_cents)::numeric)::bigint -
      public.round_half_even((pli.quantity * pli.unit_price_cents * pli.discount_percent / 100.0))::bigint,
    pli.position,
    p_actor,
    p_actor
  from public.project_line_items pli
  where pli.project_id = p_project_id
  order by pli.position;

  perform public.recompute_invoice_totals(v_invoice_id);

  return v_invoice_id;
end;
$function$;

-- 3. recompute_project_totals: replace the gross/discount round() calls. Body
--    is the live 0059 definition with round( -> public.round_half_even(.
create or replace function public.recompute_project_totals(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_budget bigint;
begin
  select coalesce(sum(
    public.round_half_even((pli.quantity * pli.unit_price_cents)::numeric)::bigint
    - public.round_half_even((pli.quantity * pli.unit_price_cents * pli.discount_percent / 100.0))::bigint
  ), 0)
    into v_budget
    from public.project_line_items pli
   where pli.project_id = p_project_id;

  update public.projects
     set budget_cents = v_budget,
         updated_at = now()
   where id = p_project_id;
end;
$function$;

-- 4. approve_billing_review: replace the labor and material sum round() calls.
--    Body is the live 0102 definition with round( -> public.round_half_even(.
create or replace function public.approve_billing_review(p_review_id uuid, p_actor uuid, p_caller_org_id uuid, p_invoice_number text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org_id uuid;
  v_status text;
  v_job_run_id uuid;
  v_project_id uuid;
  v_account_id uuid;
  v_invoice_id uuid;
  v_currency_code text;
  v_currency text;
  v_customer_id uuid;
  v_invoice_number text;
  v_estimate_cents bigint;
  v_actual_cents bigint;
begin
  select org_id, status, job_run_id, project_id, account_id, invoice_id, currency_code
    into v_org_id, v_status, v_job_run_id, v_project_id, v_account_id,
         v_invoice_id, v_currency_code
    from public.billing_reviews where id = p_review_id;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: billing review not found' using errcode = 'P0001';
  end if;

  if v_status in ('approved', 'invoiced') then
    return p_review_id; -- idempotent
  end if;
  if v_status <> 'draft' then
    raise exception 'STATE_CONFLICT: billing review not in draft state (was %)', v_status
      using errcode = 'P0001';
  end if;

  if v_account_id is not null then
    select customer_id into v_customer_id
      from public.three_pl_accounts
     where id = v_account_id and org_id = v_org_id;
  end if;
  if v_customer_id is null and v_project_id is not null then
    select customer_id into v_customer_id
      from public.projects
     where id = v_project_id and org_id = v_org_id;
  end if;

  v_currency := coalesce(v_currency_code, 'USD');

  v_invoice_number := coalesce(
    nullif(trim(p_invoice_number), ''),
    public.next_doc_number(v_org_id, 'invoice'));

  insert into public.invoices (
    org_id, invoice_number, customer_id, project_id,
    currency_code, status, created_by, updated_by
  ) values (
    v_org_id, v_invoice_number, v_customer_id, v_project_id,
    v_currency, 'draft', p_actor, p_actor
  )
  returning id into v_invoice_id;

  if v_account_id is not null then
    insert into public.invoice_line_items (
      invoice_id, description, quantity, unit_price_cents,
      tax_rate_snapshot, tax_amount_cents, discount_cents, line_total_cents,
      sort_order, created_by, updated_by
    )
    select
      v_invoice_id, asd.name, 1, coalesce(asd.rate_cents, 0),
      0, 0, 0, coalesce(asd.rate_cents, 0),
      asd.position, p_actor, p_actor
    from public.account_service_definitions asd
    where asd.org_id = v_org_id
      and asd.account_id = v_account_id
      and (asd.effective_from is null or asd.effective_from <= now())
      and (asd.effective_to   is null or asd.effective_to   >= now())
    order by asd.position;
  end if;

  perform public.recompute_invoice_totals(v_invoice_id);

  if v_project_id is not null then
    select budget_cents into v_estimate_cents
      from public.projects
     where id = v_project_id and org_id = v_org_id;
  end if;

  if v_job_run_id is not null then
    select
      coalesce((
        select sum(public.round_half_even(dl.labor_hours * coalesce(dl.labor_rate_cents, 0)))
          from public.job_run_daily_logs dl
         where dl.org_id = v_org_id
           and dl.job_run_id = v_job_run_id
           and dl.status = 'posted'
      ), 0)
      + coalesce((
        select sum(public.round_half_even(cli.quantity * coalesce(cli.unit_cost_cents, 0)))
          from public.job_run_daily_log_consumed_line_items cli
          join public.job_run_daily_logs dl
            on dl.id = cli.job_run_daily_log_id and dl.org_id = cli.org_id
         where cli.org_id = v_org_id
           and dl.job_run_id = v_job_run_id
           and dl.status = 'posted'
      ), 0)
    into v_actual_cents;
  end if;

  update public.billing_reviews
     set status = 'approved',
         invoice_id = v_invoice_id,
         currency_code = v_currency,
         estimate_total_cents = v_estimate_cents,
         actual_total_cents = v_actual_cents,
         approved_at = now(),
         updated_by = p_actor
   where id = p_review_id;

  return p_review_id;
end;
$function$;

-- 5. view_job_profitability: replace the six labor/material round() calls.
--    Body is the live 0122 definition with round( -> public.round_half_even(.
--    security_invoker = true preserved verbatim (RLS is enforced by the
--    caller's grants on the underlying tables, not by the view owner).
create or replace view public.view_job_profitability
with (security_invoker = true)
as
 SELECT jr.org_id,
    jr.id AS job_run_id,
    jr.project_id,
    jr.account_id,
    COALESCE(p.budget_cents, 0::bigint) AS estimate_total_cents,
    COALESCE(( SELECT sum(public.round_half_even(dl.labor_hours * COALESCE(dl.labor_rate_cents, 0::bigint)::numeric)) AS sum
           FROM job_run_daily_logs dl
          WHERE dl.org_id = jr.org_id AND dl.job_run_id = jr.id AND dl.status = 'posted'::text), 0::numeric)::bigint AS actual_labor_cents,
    COALESCE(( SELECT sum(
                CASE
                    WHEN COALESCE(cli.supply_source, it.supply_source) = ANY (ARRAY['customer_supplied'::text, 'third_party_consigned'::text]) THEN 0::numeric
                    ELSE public.round_half_even(cli.quantity * COALESCE(cli.unit_cost_cents, 0::bigint)::numeric)
                END) AS sum
           FROM job_run_daily_log_consumed_line_items cli
             JOIN job_run_daily_logs dl ON dl.id = cli.job_run_daily_log_id AND dl.org_id = cli.org_id
             LEFT JOIN items it ON it.id = cli.item_id AND it.org_id = cli.org_id
          WHERE cli.org_id = jr.org_id AND dl.job_run_id = jr.id AND dl.status = 'posted'::text), 0::numeric)::bigint AS actual_material_cents,
    (COALESCE(( SELECT sum(public.round_half_even(dl.labor_hours * COALESCE(dl.labor_rate_cents, 0::bigint)::numeric)) AS sum
           FROM job_run_daily_logs dl
          WHERE dl.org_id = jr.org_id AND dl.job_run_id = jr.id AND dl.status = 'posted'::text), 0::numeric) + COALESCE(( SELECT sum(
                CASE
                    WHEN COALESCE(cli.supply_source, it.supply_source) = ANY (ARRAY['customer_supplied'::text, 'third_party_consigned'::text]) THEN 0::numeric
                    ELSE public.round_half_even(cli.quantity * COALESCE(cli.unit_cost_cents, 0::bigint)::numeric)
                END) AS sum
           FROM job_run_daily_log_consumed_line_items cli
             JOIN job_run_daily_logs dl ON dl.id = cli.job_run_daily_log_id AND dl.org_id = cli.org_id
             LEFT JOIN items it ON it.id = cli.item_id AND it.org_id = cli.org_id
          WHERE cli.org_id = jr.org_id AND dl.job_run_id = jr.id AND dl.status = 'posted'::text), 0::numeric))::bigint AS actual_total_cents,
    COALESCE(( SELECT sum(i.total_cents) AS sum
           FROM invoices i
          WHERE i.org_id = jr.org_id AND i.project_id = jr.project_id AND i.status <> 'cancelled'::text AND i.deleted_at IS NULL), 0::numeric)::bigint AS billed_revenue_cents,
    (COALESCE(( SELECT sum(i.total_cents) AS sum
           FROM invoices i
          WHERE i.org_id = jr.org_id AND i.project_id = jr.project_id AND i.status <> 'cancelled'::text AND i.deleted_at IS NULL), 0::numeric) - (COALESCE(( SELECT sum(public.round_half_even(dl.labor_hours * COALESCE(dl.labor_rate_cents, 0::bigint)::numeric)) AS sum
           FROM job_run_daily_logs dl
          WHERE dl.org_id = jr.org_id AND dl.job_run_id = jr.id AND dl.status = 'posted'::text), 0::numeric) + COALESCE(( SELECT sum(
                CASE
                    WHEN COALESCE(cli.supply_source, it.supply_source) = ANY (ARRAY['customer_supplied'::text, 'third_party_consigned'::text]) THEN 0::numeric
                    ELSE public.round_half_even(cli.quantity * COALESCE(cli.unit_cost_cents, 0::bigint)::numeric)
                END) AS sum
           FROM job_run_daily_log_consumed_line_items cli
             JOIN job_run_daily_logs dl ON dl.id = cli.job_run_daily_log_id AND dl.org_id = cli.org_id
             LEFT JOIN items it ON it.id = cli.item_id AND it.org_id = cli.org_id
          WHERE cli.org_id = jr.org_id AND dl.job_run_id = jr.id AND dl.status = 'posted'::text), 0::numeric)))::bigint AS margin_cents
   FROM job_runs jr
     LEFT JOIN projects p ON p.id = jr.project_id AND p.org_id = jr.org_id
  WHERE jr.deleted_at IS NULL;
