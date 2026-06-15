-- ============================================================================
-- Migration: 0104_job_profitability_view.sql
-- Wave: 12
-- Phase: 3PL commercial pivot, Phase A7 (Billing Review and Job Profitability),
--   step 3 of 3.
-- Closes: the Job Profitability read model from
--   03-workspace/specs/2026-06-14-3pl-a7-billing-profitability-handoff.md (Job
--   Profitability: a derived view, NOT a new write table) and the parent plan
--   03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md
--   (section 6.1 Job Profitability). One row per non-deleted job_run: quote
--   estimate (project budget) vs job-run actuals (posted daily-log labor +
--   consumed material cost) vs billed revenue (the project's non-cancelled
--   invoices), with margin = revenue - actual. Exposed as a SQL view that the
--   threepl.profitability.read cap gates at the edge.
-- Date: 2026-06-14
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   drop view if exists public.view_job_profitability;
--
-- Constitutional alignment:
--   Money rules        Every total is BIGINT cents with the _cents suffix.
--                      estimate_total_cents from projects.budget_cents;
--                      actual_labor_cents / actual_material_cents rounded from
--                      numeric quantity-times-cents products (round half to even
--                      is Postgres numeric default rounding); actual_total_cents
--                      and margin_cents are integer sums / differences. margin can
--                      be negative (a loss), so it is a plain bigint with no
--                      non-negative CHECK. No floats.
--   RLS rules          The view is created with security_invoker = true so the
--                      base-table RLS (Pattern A on projects, job_runs, the
--                      daily-log tables, and invoices) applies as the querying
--                      user. No SECURITY DEFINER wrapper, no re-applied org filter
--                      in the body: a cross-tenant caller simply sees no rows for
--                      another org. Mirrors quote_attachments (0039). SELECT
--                      granted to authenticated.
--   Audit rules        Untouched. A view is a read model; it never writes
--                      audit_log and carries no entity_type.
--   Migration rules    Forward-only. Idempotent (CREATE OR REPLACE VIEW). Does
--                      not edit any prior migration.
--   State machine      Untouched.
--   Fan-out            Revenue and the per-day actuals are computed as correlated
--                      scalar subqueries so the daily-log fan-out never multiplies
--                      the project's invoice revenue and the consumed-line fan-out
--                      never multiplies labor. One clean row per job_run.
--   Out of scope       The job_profitability_snapshots freeze table is the
--                      named-not-built later option (F-Wave12-JOB-PROFITABILITY-
--                      SNAPSHOT-01). The /3pl-operations/profitability page and the
--                      threepl.profitability.read cap are the A7 app layer.
-- ============================================================================

create or replace view public.view_job_profitability
with (security_invoker = true)
as
  select
    jr.org_id,
    jr.id as job_run_id,
    jr.project_id,
    jr.account_id,
    -- Estimate: the project budget (rolled up from quote line items). 0 when the
    -- run is not project-scoped.
    coalesce(p.budget_cents, 0) as estimate_total_cents,
    -- Actual labor: over the run's POSTED daily logs, labor_hours * labor_rate_cents.
    coalesce((
      select sum(round(dl.labor_hours * coalesce(dl.labor_rate_cents, 0)))
        from public.job_run_daily_logs dl
       where dl.org_id = jr.org_id
         and dl.job_run_id = jr.id
         and dl.status = 'posted'
    ), 0)::bigint as actual_labor_cents,
    -- Actual material: over the run's POSTED daily logs, the consumed lines'
    -- quantity * unit_cost_cents. Correlated so the consumed-line fan-out never
    -- multiplies labor.
    coalesce((
      select sum(round(cli.quantity * coalesce(cli.unit_cost_cents, 0)))
        from public.job_run_daily_log_consumed_line_items cli
        join public.job_run_daily_logs dl
          on dl.id = cli.job_run_daily_log_id and dl.org_id = cli.org_id
       where cli.org_id = jr.org_id
         and dl.job_run_id = jr.id
         and dl.status = 'posted'
    ), 0)::bigint as actual_material_cents,
    -- Actual total: labor + material.
    (
      coalesce((
        select sum(round(dl.labor_hours * coalesce(dl.labor_rate_cents, 0)))
          from public.job_run_daily_logs dl
         where dl.org_id = jr.org_id
           and dl.job_run_id = jr.id
           and dl.status = 'posted'
      ), 0)
      + coalesce((
        select sum(round(cli.quantity * coalesce(cli.unit_cost_cents, 0)))
          from public.job_run_daily_log_consumed_line_items cli
          join public.job_run_daily_logs dl
            on dl.id = cli.job_run_daily_log_id and dl.org_id = cli.org_id
         where cli.org_id = jr.org_id
           and dl.job_run_id = jr.id
           and dl.status = 'posted'
      ), 0)
    )::bigint as actual_total_cents,
    -- Billed revenue: the project's non-cancelled, non-deleted invoices'
    -- total_cents. Keyed by invoices.project_id (not the daily logs) so the
    -- daily-log fan-out never multiplies it. 0 when the run is not project-scoped
    -- or the project has no invoices.
    coalesce((
      select sum(i.total_cents)
        from public.invoices i
       where i.org_id = jr.org_id
         and i.project_id = jr.project_id
         and i.status <> 'cancelled'
         and i.deleted_at is null
    ), 0)::bigint as billed_revenue_cents,
    -- Margin: revenue - actual. May be negative (a loss).
    (
      coalesce((
        select sum(i.total_cents)
          from public.invoices i
         where i.org_id = jr.org_id
           and i.project_id = jr.project_id
           and i.status <> 'cancelled'
           and i.deleted_at is null
      ), 0)
      - (
        coalesce((
          select sum(round(dl.labor_hours * coalesce(dl.labor_rate_cents, 0)))
            from public.job_run_daily_logs dl
           where dl.org_id = jr.org_id
             and dl.job_run_id = jr.id
             and dl.status = 'posted'
        ), 0)
        + coalesce((
          select sum(round(cli.quantity * coalesce(cli.unit_cost_cents, 0)))
            from public.job_run_daily_log_consumed_line_items cli
            join public.job_run_daily_logs dl
              on dl.id = cli.job_run_daily_log_id and dl.org_id = cli.org_id
           where cli.org_id = jr.org_id
             and dl.job_run_id = jr.id
             and dl.status = 'posted'
        ), 0)
      )
    )::bigint as margin_cents
  from public.job_runs jr
  left join public.projects p
    on p.id = jr.project_id and p.org_id = jr.org_id
  where jr.deleted_at is null;

comment on view public.view_job_profitability is
  '3PL Job Profitability read model (Wave 12 / A7). One row per non-deleted job_run: estimate_total_cents (project budget) vs actual_labor_cents + actual_material_cents = actual_total_cents (the run''s POSTED daily-log labor + consumed material cost) vs billed_revenue_cents (the project''s non-cancelled, non-deleted invoices), with margin_cents = revenue - actual (may be negative). security_invoker = true so base-table RLS scopes each caller to their org; the threepl.profitability.read cap gates the edge route. Correlated scalar subqueries keep revenue and labor free of the daily-log / consumed-line fan-out.';

grant select on public.view_job_profitability to authenticated;
