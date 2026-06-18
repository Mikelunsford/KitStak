-- ============================================================================
-- Migration: 0122_job_profitability_supply_source.sql
-- Wave: 13
-- Phase: B. Catalog deepening, supply-source costing. The Job Profitability view
--   (0104) sums actual material as quantity * unit_cost_cents over a run's posted
--   daily-log consumed lines. With supply_source (0120) and the per-line override
--   (0121), material the org neither owns nor pays for must roll up as zero org
--   cost. This forward migration replaces the view so actual_material_cents (and
--   the actual_total / margin sums that include it) zero any consumed line whose
--   effective source is customer_supplied or third_party_consigned. in_house and
--   vendor_consigned keep their captured cost. Everything else about the view is
--   carried over verbatim from 0104.
-- Closes: F-UIUX-ENTITYPICKER-SUPPLY-SOURCE-01
-- Date: 2026-06-17
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   Re-apply 0104 verbatim to restore the source-agnostic material sum:
--   CREATE OR REPLACE VIEW public.view_job_profitability ... (see 0104).
--
-- Constitutional alignment:
--   Money rules        Every total stays BIGINT cents with the _cents suffix.
--                      The only change is a CASE that substitutes 0 for a
--                      not-org-owned consumed line before the round/sum; no float,
--                      no new column, banker's rounding unchanged (Postgres
--                      numeric round half to even).
--   Effective source   COALESCE(line.supply_source, item.supply_source): the
--                      per-line override (0121) wins, else the item default (0120).
--                      The items join is a LEFT JOIN so an RLS-hidden item never
--                      drops a row and never silently zeros cost (null falls
--                      through to normal cost).
--   RLS rules          security_invoker = true carried over from 0104; base-table
--                      RLS (Pattern A on items, projects, job_runs, the daily-log
--                      tables, and invoices) applies as the querying user. No
--                      SECURITY DEFINER, no re-applied org filter.
--   Audit rules        Untouched. A view never writes audit_log.
--   Migration rules    Forward-only. Idempotent (CREATE OR REPLACE VIEW). Does
--                      not edit 0104.
--   Fan-out            The consumed-line subqueries stay correlated scalar
--                      subqueries, and the added items LEFT JOIN is one-to-one on
--                      the line's item_id, so revenue and labor are still free of
--                      the consumed-line fan-out.
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
    -- quantity * unit_cost_cents, with not-org-owned material zeroed. The
    -- effective source is the line override (0121) else the item default (0120).
    -- Correlated so the consumed-line fan-out never multiplies labor.
    coalesce((
      select sum(
        case
          when coalesce(cli.supply_source, it.supply_source)
               in ('customer_supplied', 'third_party_consigned')
            then 0
          else round(cli.quantity * coalesce(cli.unit_cost_cents, 0))
        end
      )
        from public.job_run_daily_log_consumed_line_items cli
        join public.job_run_daily_logs dl
          on dl.id = cli.job_run_daily_log_id and dl.org_id = cli.org_id
        left join public.items it
          on it.id = cli.item_id and it.org_id = cli.org_id
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
        select sum(
          case
            when coalesce(cli.supply_source, it.supply_source)
                 in ('customer_supplied', 'third_party_consigned')
              then 0
            else round(cli.quantity * coalesce(cli.unit_cost_cents, 0))
          end
        )
          from public.job_run_daily_log_consumed_line_items cli
          join public.job_run_daily_logs dl
            on dl.id = cli.job_run_daily_log_id and dl.org_id = cli.org_id
          left join public.items it
            on it.id = cli.item_id and it.org_id = cli.org_id
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
          select sum(
            case
              when coalesce(cli.supply_source, it.supply_source)
                   in ('customer_supplied', 'third_party_consigned')
                then 0
              else round(cli.quantity * coalesce(cli.unit_cost_cents, 0))
            end
          )
            from public.job_run_daily_log_consumed_line_items cli
            join public.job_run_daily_logs dl
              on dl.id = cli.job_run_daily_log_id and dl.org_id = cli.org_id
            left join public.items it
              on it.id = cli.item_id and it.org_id = cli.org_id
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
  '3PL Job Profitability read model (Wave 12 / A7, supply-source aware as of Wave 13 / 0122). One row per non-deleted job_run: estimate_total_cents (project budget) vs actual_labor_cents + actual_material_cents = actual_total_cents (the run''s POSTED daily-log labor + consumed material cost, with customer_supplied and third_party_consigned material zeroed by effective source COALESCE(line, item)) vs billed_revenue_cents (the project''s non-cancelled, non-deleted invoices), with margin_cents = revenue - actual (may be negative). security_invoker = true so base-table RLS scopes each caller to their org; the threepl.profitability.read cap gates the edge route. Correlated scalar subqueries keep revenue and labor free of the daily-log / consumed-line fan-out.';

grant select on public.view_job_profitability to authenticated;
