-- ============================================================================
-- Migration: 0139_audit_created_symmetry_extend.sql
-- Wave: Audit completeness (post-wave follow-up)
-- Phase: Extend the entity-creation audit symmetry from 0070 to the entities
--   added after it. 0061 covered manufacturing_runs; 0070 (2026-05-27) covered
--   18 core quote-to-cash entities via the shared kitstak_audit_created helper
--   plus per-table AFTER INSERT triggers. Every add-on pillar entity shipped
--   after 0070 (3PL commercial layer, Co-Pack, KitForce, WMS) plus the two
--   newest spine additions (quote_tiers from ADR 0004, recurring_schedules from
--   ADR 0005 Phase 2) never got a created trigger, so their birth event is
--   invisible to an auditor. This adds the missing triggers, reusing the 0070
--   helper unchanged.
-- Closes: F-Wave9-AUDIT-CREATED-SYMMETRY-01 (the remainder deferred from 0070,
--   which only covered the entities that existed on 2026-05-27).
-- Date: 2026-06-24
--
-- DOWN MIGRATION (operator-only; forward-only repo, do not auto-apply):
--   drop trigger if exists audit_three_pl_accounts_created on public.three_pl_accounts;
--   drop trigger if exists audit_job_templates_created on public.job_templates;
--   drop trigger if exists audit_supply_plans_created on public.supply_plans;
--   drop trigger if exists audit_job_runs_created on public.job_runs;
--   drop trigger if exists audit_billing_reviews_created on public.billing_reviews;
--   drop trigger if exists audit_sales_orders_created on public.sales_orders;
--   drop trigger if exists audit_kitting_jobs_created on public.kitting_jobs;
--   drop trigger if exists audit_fulfillments_created on public.fulfillments;
--   drop trigger if exists audit_shifts_created on public.shifts;
--   drop trigger if exists audit_work_assignments_created on public.work_assignments;
--   drop trigger if exists audit_time_entries_created on public.time_entries;
--   drop trigger if exists audit_workforce_members_created on public.workforce_members;
--   drop trigger if exists audit_workforce_teams_created on public.workforce_teams;
--   drop trigger if exists audit_putaway_tasks_created on public.putaway_tasks;
--   drop trigger if exists audit_lots_created on public.lots;
--   drop trigger if exists audit_warehouse_locations_created on public.warehouse_locations;
--   drop trigger if exists audit_warehouses_created on public.warehouses;
--   drop trigger if exists audit_recurring_schedules_created on public.recurring_schedules;
--   drop trigger if exists audit_quote_tiers_created on public.quote_tiers;
--   -- plus drop function on each public.trg_audit_<table>_created(). The shared
--   -- kitstak_audit_created helper is left in place (0070 owns it). Any
--   -- forward 'created' rows already written are intentional hash-chain history
--   -- and are NOT removed.
--
-- Constitutional alignment:
--   Money rules        Untouched. No money columns read or written.
--   RLS rules          Triggers are SECURITY DEFINER and write audit_log under
--                      the table-owner identity via kitstak_audit_created,
--                      preserving the append-only RLS posture (no authenticated
--                      INSERT/UPDATE/DELETE on audit_log). org_id comes from the
--                      inserting row directly, or from the parent quote for
--                      quote_tiers (Pattern B, no org_id column), mirroring how
--                      0070 derived project_phases from its parent project. No
--                      cross-tenant surface introduced.
--   Audit rules        This IS the audit-symmetry expansion the constitution's
--                      "auto-state-transition triggers on every entity with a
--                      state machine" implies: an INSERT is a state event
--                      (null -> initial). action='created', from_state=null,
--                      to_state=initial status (or null -> 'created' sentinel for
--                      entities with no state column). Hash chain + per-org
--                      advisory lock are entirely inside kitstak_audit_created
--                      (0070), reused here unchanged. Existing status-transition
--                      triggers keep their guards; this ADDS, never edits.
--   Migration rules    Forward-only. Four-digit zero-padded (0139, next after
--                      0138). All DDL idempotent (CREATE OR REPLACE FUNCTION,
--                      DROP TRIGGER IF EXISTS before CREATE TRIGGER). Re-runs
--                      are safe.
--   State machine      Untouched. No new states, no new transitions. Only a new
--                      audit row at the INSERT edge.
--   Grants             Each trigger function REVOKEs EXECUTE from public, anon
--                      (matching 0070). kitstak_audit_created stays service_role
--                      only (0070). Triggers fire as the table owner regardless.
--   Backfill           NONE. Forward-only coverage, matching 0070 (which did not
--                      backfill its 18 entities). Backfilling historical rows
--                      across 19 tables into the per-org hash chain is out of
--                      scope; existing rows simply carry no 'created' entry, the
--                      same treatment 0070 gave pre-2026-05-27 entities.
--   Constraint         Extends audit_log_entity_type_check to admit
--                      'recurring_schedule' and 'quote_tier' (the only two of
--                      the 19 entity types not already in the CHECK). Strict
--                      superset, so every existing row still validates. Without
--                      it the created trigger would fail the CHECK and abort the
--                      parent insert. Drop + re-add (idempotent), no data change.
--   Scope              19 entities: the 3PL commercial layer (three_pl_accounts,
--                      job_templates, supply_plans, job_runs, billing_reviews),
--                      Co-Pack (sales_orders, kitting_jobs, fulfillments),
--                      KitForce (shifts, work_assignments, time_entries,
--                      workforce_members, workforce_teams), WMS (putaway_tasks,
--                      lots, warehouse_locations, warehouses), and the spine
--                      additions (recurring_schedules, quote_tiers). Deliberately
--                      EXCLUDES child line-item tables, trigger-maintained rollups
--                      (bin_stock_levels, stock_levels), and config / reference
--                      tables (taxes, units, job_types, pricing_tiers, etc.), the
--                      same selectivity 0070 applied.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Extend the audit_log entity_type CHECK to admit the two spine entity types
--    added after 0070. Every OTHER entity type below ('three_pl_account' ...
--    'lot') is already in the constraint (the pillar tables registered theirs
--    when they shipped); only quote_tier (ADR 0004) and recurring_schedule
--    (ADR 0005 Phase 2) were never added. Without this, their created trigger's
--    audit_log insert fails the CHECK and aborts the PARENT insert (a hard
--    regression on every quote_tier / recurring_schedule create). Drop + re-add
--    because a CHECK cannot be altered in place; the new set is a strict
--    superset so every existing audit_log row still validates. Idempotent via
--    DROP CONSTRAINT IF EXISTS.
-- ---------------------------------------------------------------------------
alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
alter table public.audit_log
  add constraint audit_log_entity_type_check
  check (entity_type in (
    'organization', 'org_membership',
    'customer', 'contact', 'activity', 'lead', 'opportunity',
    'item',
    'quote', 'quote_line_item', 'project', 'project_phase', 'project_line_item',
    'invoice', 'invoice_line_item', 'payment', 'credit_note',
    'journal_entry', 'period_close',
    'vendor', 'purchase_order', 'po_line_item', 'vendor_bill', 'expense',
    'warehouse', 'stock_movement', 'receiving_order', 'production_run', 'shipment',
    'attachment', 'comment', 'notification',
    'manufacturing_run',
    'manufacturing_run_consumed_line_item', 'manufacturing_run_produced_line_item',
    'sales_channel', 'sales_order', 'sales_order_line_item',
    'kitting_job', 'kitting_job_consumed_line_item', 'kitting_job_produced_line_item',
    'fulfillment',
    'workforce_member', 'workforce_team', 'workforce_team_member',
    'shift', 'work_assignment', 'time_entry',
    'three_pl_account', 'account_service_definition',
    'job_template', 'job_template_line',
    'supply_plan', 'supply_plan_line',
    'job_run',
    'job_run_daily_log',
    'job_run_daily_log_consumed_line_item', 'job_run_daily_log_produced_line_item',
    'billing_review',
    'warehouse_location',
    'putaway_task',
    'lot',
    -- added by this migration (0139): the two spine entity types created after 0070
    'recurring_schedule', 'quote_tier'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Authoritative full list as of 0139, which adds recurring_schedule (ADR 0005 Phase 2) and quote_tier (ADR 0004) on top of the 0110 list. Update via forward migration when a new auditable entity ships, and never subset the prior list.';

-- ---------------------------------------------------------------------------
-- 3PL commercial layer: three_pl_accounts, job_templates, supply_plans,
-- job_runs, billing_reviews.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_three_pl_accounts_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'three_pl_account', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'account_number', new.account_number, 'name', new.name)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_three_pl_accounts_created() from public, anon;
drop trigger if exists audit_three_pl_accounts_created on public.three_pl_accounts;
create trigger audit_three_pl_accounts_created
  after insert on public.three_pl_accounts
  for each row execute function public.trg_audit_three_pl_accounts_created();

create or replace function public.trg_audit_job_templates_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'job_template', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'template_number', new.template_number, 'name', new.name)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_job_templates_created() from public, anon;
drop trigger if exists audit_job_templates_created on public.job_templates;
create trigger audit_job_templates_created
  after insert on public.job_templates
  for each row execute function public.trg_audit_job_templates_created();

create or replace function public.trg_audit_supply_plans_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'supply_plan', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'plan_number', new.plan_number, 'project_id', new.project_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_supply_plans_created() from public, anon;
drop trigger if exists audit_supply_plans_created on public.supply_plans;
create trigger audit_supply_plans_created
  after insert on public.supply_plans
  for each row execute function public.trg_audit_supply_plans_created();

create or replace function public.trg_audit_job_runs_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'job_run', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'run_number', new.run_number, 'project_id', new.project_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_job_runs_created() from public, anon;
drop trigger if exists audit_job_runs_created on public.job_runs;
create trigger audit_job_runs_created
  after insert on public.job_runs
  for each row execute function public.trg_audit_job_runs_created();

create or replace function public.trg_audit_billing_reviews_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'billing_review', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'review_number', new.review_number, 'job_run_id', new.job_run_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_billing_reviews_created() from public, anon;
drop trigger if exists audit_billing_reviews_created on public.billing_reviews;
create trigger audit_billing_reviews_created
  after insert on public.billing_reviews
  for each row execute function public.trg_audit_billing_reviews_created();

-- ---------------------------------------------------------------------------
-- Co-Pack: sales_orders, kitting_jobs, fulfillments.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_sales_orders_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'sales_order', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'order_number', new.order_number, 'customer_id', new.customer_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_sales_orders_created() from public, anon;
drop trigger if exists audit_sales_orders_created on public.sales_orders;
create trigger audit_sales_orders_created
  after insert on public.sales_orders
  for each row execute function public.trg_audit_sales_orders_created();

create or replace function public.trg_audit_kitting_jobs_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'kitting_job', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'warehouse_id', new.warehouse_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_kitting_jobs_created() from public, anon;
drop trigger if exists audit_kitting_jobs_created on public.kitting_jobs;
create trigger audit_kitting_jobs_created
  after insert on public.kitting_jobs
  for each row execute function public.trg_audit_kitting_jobs_created();

create or replace function public.trg_audit_fulfillments_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'fulfillment', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'warehouse_id', new.warehouse_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_fulfillments_created() from public, anon;
drop trigger if exists audit_fulfillments_created on public.fulfillments;
create trigger audit_fulfillments_created
  after insert on public.fulfillments
  for each row execute function public.trg_audit_fulfillments_created();

-- ---------------------------------------------------------------------------
-- KitForce: shifts, work_assignments, time_entries, workforce_members,
-- workforce_teams.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_shifts_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'shift', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'shift_number', new.shift_number, 'warehouse_id', new.warehouse_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_shifts_created() from public, anon;
drop trigger if exists audit_shifts_created on public.shifts;
create trigger audit_shifts_created
  after insert on public.shifts
  for each row execute function public.trg_audit_shifts_created();

create or replace function public.trg_audit_work_assignments_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'work_assignment', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'assignment_number', new.assignment_number)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_work_assignments_created() from public, anon;
drop trigger if exists audit_work_assignments_created on public.work_assignments;
create trigger audit_work_assignments_created
  after insert on public.work_assignments
  for each row execute function public.trg_audit_work_assignments_created();

create or replace function public.trg_audit_time_entries_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  -- time_entries has no status column (its lifecycle is clock_in / clock_out
  -- timestamps), so to_state is null (helper records the 'created' sentinel).
  perform public.kitstak_audit_created(
    new.org_id, 'time_entry', new.id, null, v_actor, '{}'::jsonb
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_time_entries_created() from public, anon;
drop trigger if exists audit_time_entries_created on public.time_entries;
create trigger audit_time_entries_created
  after insert on public.time_entries
  for each row execute function public.trg_audit_time_entries_created();

create or replace function public.trg_audit_workforce_members_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'workforce_member', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'display_name', new.display_name)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_workforce_members_created() from public, anon;
drop trigger if exists audit_workforce_members_created on public.workforce_members;
create trigger audit_workforce_members_created
  after insert on public.workforce_members
  for each row execute function public.trg_audit_workforce_members_created();

create or replace function public.trg_audit_workforce_teams_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'workforce_team', new.id, null, v_actor,
    jsonb_build_object('name', new.name)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_workforce_teams_created() from public, anon;
drop trigger if exists audit_workforce_teams_created on public.workforce_teams;
create trigger audit_workforce_teams_created
  after insert on public.workforce_teams
  for each row execute function public.trg_audit_workforce_teams_created();

-- ---------------------------------------------------------------------------
-- WMS: putaway_tasks, lots, warehouse_locations, warehouses.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_putaway_tasks_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'putaway_task', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'warehouse_id', new.warehouse_id, 'item_id', new.item_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_putaway_tasks_created() from public, anon;
drop trigger if exists audit_putaway_tasks_created on public.putaway_tasks;
create trigger audit_putaway_tasks_created
  after insert on public.putaway_tasks
  for each row execute function public.trg_audit_putaway_tasks_created();

create or replace function public.trg_audit_lots_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'lot', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'item_id', new.item_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_lots_created() from public, anon;
drop trigger if exists audit_lots_created on public.lots;
create trigger audit_lots_created
  after insert on public.lots
  for each row execute function public.trg_audit_lots_created();

create or replace function public.trg_audit_warehouse_locations_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'warehouse_location', new.id, null, v_actor,
    jsonb_build_object('code', new.code, 'warehouse_id', new.warehouse_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_warehouse_locations_created() from public, anon;
drop trigger if exists audit_warehouse_locations_created on public.warehouse_locations;
create trigger audit_warehouse_locations_created
  after insert on public.warehouse_locations
  for each row execute function public.trg_audit_warehouse_locations_created();

create or replace function public.trg_audit_warehouses_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'warehouse', new.id, null, v_actor,
    jsonb_build_object('code', new.code, 'display_name', new.display_name)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_warehouses_created() from public, anon;
drop trigger if exists audit_warehouses_created on public.warehouses;
create trigger audit_warehouses_created
  after insert on public.warehouses
  for each row execute function public.trg_audit_warehouses_created();

-- ---------------------------------------------------------------------------
-- Spine additions after 0070: recurring_schedules (ADR 0005 Phase 2),
-- quote_tiers (ADR 0004). quote_tiers has no org_id (Pattern B), so its org is
-- derived from the parent quote, exactly like project_phases in 0070.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_recurring_schedules_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;
  perform public.kitstak_audit_created(
    new.org_id, 'recurring_schedule', new.id, new.status, v_actor,
    jsonb_build_object('status', new.status, 'cadence', new.cadence, 'project_id', new.project_id)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_recurring_schedules_created() from public, anon;
drop trigger if exists audit_recurring_schedules_created on public.recurring_schedules;
create trigger audit_recurring_schedules_created
  after insert on public.recurring_schedules
  for each row execute function public.trg_audit_recurring_schedules_created();

create or replace function public.trg_audit_quote_tiers_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid;
  v_org_id uuid;
begin
  begin v_actor := coalesce(auth.uid(), new.created_by);
  exception when others then v_actor := new.created_by; end;

  select org_id into v_org_id from public.quotes where id = new.quote_id;
  if v_org_id is null then
    return new;  -- parent quote missing; cannot scope audit row to an org
  end if;

  perform public.kitstak_audit_created(
    v_org_id, 'quote_tier', new.id, null, v_actor,
    jsonb_build_object('quote_id', new.quote_id, 'label', new.label)
  );
  return new;
end;
$$;
revoke execute on function public.trg_audit_quote_tiers_created() from public, anon;
drop trigger if exists audit_quote_tiers_created on public.quote_tiers;
create trigger audit_quote_tiers_created
  after insert on public.quote_tiers
  for each row execute function public.trg_audit_quote_tiers_created();
