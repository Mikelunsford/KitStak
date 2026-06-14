-- ============================================================================
-- Migration: 0101_supply_plan_fulfillment.sql
-- Wave: 12
-- Phase: 3PL commercial pivot, Phase A6 (Job Runs and Daily Progress), step 4 of
--   4 (the Supply Plan fulfillment link, folded into A6 per the handoff).
-- Closes: F-Wave12-SUPPLY-PLAN-JOB-RUN-LINK-01 and
--   03-workspace/specs/2026-06-13-3pl-a6-job-runs-handoff.md (decision 4). Adds
--   the supply_plans.job_run_id breadcrumb (a released plan's stock is consumed
--   by a job_run) and the fulfill_supply_plan RPC (released -> fulfilled), which
--   releases the remaining holds so the spine quantity_reserved is not left
--   stale once the operator marks the plan fulfilled. The finer per-consume
--   automatic draw-down stays the follow-up F-Wave12-SUPPLY-PLAN-FULFILL-CONSUME-01.
-- Date: 2026-06-14
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop function if exists public.fulfill_supply_plan(uuid, uuid, uuid);
--   drop index if exists public.supply_plans_job_run_idx;
--   alter table public.supply_plans drop column if exists job_run_id;
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column. The fulfill RPC moves
--                      quantity (reserve_release), not cost.
--   RLS rules          supply_plans keeps its 0096 Pattern A policies; the new
--                      nullable column inherits the table grants, no policy
--                      change. job_run_id -> job_runs (0098) ON DELETE SET NULL so
--                      deleting a run never blocks; the plan loses its breadcrumb.
--                      The RPC keeps the 0096 3-arg cross-tenant guard (NOT_FOUND,
--                      never 403).
--   Audit rules        Untouched. No new entity_type. fulfill_supply_plan's
--                      UPDATE fires the existing trg_audit_supply_plans (0096),
--                      recording released -> fulfilled. No new trigger.
--   Migration rules    Forward-only. DDL idempotent (add-column-if-not-exists,
--                      create-index-if-not-exists, create-or-replace function).
--                      Does not edit 0096 / 0098.
--   State machine      supply_plans FSM is unchanged (the 0096 CHECK already
--                      allows 'fulfilled'). fulfill is released -> fulfilled,
--                      stamping fulfilled_at, idempotent on an already-fulfilled
--                      plan.
--   Reservation        fulfill writes 'reserve_release' (0095) for each line that
--                      still holds a reservation and zeroes the line reserved_qty,
--                      restoring the spine quantity_reserved. Unlike cancel, it
--                      does NOT restore shortage_qty: the demand was met by the
--                      run that consumed the stock.
--   Out of scope       The automatic per-consume reservation draw-down stays the
--                      follow-up F-Wave12-SUPPLY-PLAN-FULFILL-CONSUME-01. The
--                      supply.plan.fulfill capability, the
--                      POST /supply-plans/:id/fulfill route, and the SPA Fulfill
--                      action are the A6 app layer (next slice).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Additive nullable job_run_id breadcrumb on supply_plans. Spine 3PL add-on
--    FK to job_runs (0098). ON DELETE SET NULL so removing a run never blocks;
--    the plan simply loses its breadcrumb. Nullable: a plan released without a
--    run leaves it null.
-- ---------------------------------------------------------------------------

alter table public.supply_plans
  add column if not exists job_run_id uuid
    references public.job_runs(id) on delete set null;

create index if not exists supply_plans_job_run_idx
  on public.supply_plans (job_run_id) where job_run_id is not null;

comment on column public.supply_plans.job_run_id is
  'Optional Job Run (Wave 12 / A6) whose floor execution consumes this plan''s reserved stock. Set by the handler when a plan is associated with a run. Nullable; ON DELETE SET NULL keeps the breadcrumb soft.';

-- ---------------------------------------------------------------------------
-- fulfill_supply_plan: released -> fulfilled. Releases the remaining holds by
-- writing a 'reserve_release' movement (0095) for each line that still holds a
-- reservation and zeroing the line reserved_qty, so the spine quantity_reserved
-- is restored once the run has consumed the stock. Unlike cancel_supply_plan it
-- does NOT restore shortage_qty (the demand was met). Same 0096 3-arg
-- cross-tenant guard. Idempotent on an already-fulfilled plan.
-- ---------------------------------------------------------------------------

create or replace function public.fulfill_supply_plan(
  p_plan_id uuid,
  p_actor uuid,
  p_caller_org_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_status text;
  v_warehouse_id uuid;
  v_line record;
begin
  select org_id, status, warehouse_id
    into v_org_id, v_status, v_warehouse_id
    from public.supply_plans
   where id = p_plan_id;

  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: supply plan not found' using errcode = 'P0001';
  end if;

  if v_status = 'fulfilled' then
    return p_plan_id; -- idempotent
  end if;
  if v_status <> 'released' then
    raise exception 'STATE_CONFLICT: supply plan not in released state (was %)', v_status
      using errcode = 'P0001';
  end if;

  if v_warehouse_id is not null then
    for v_line in
      select id, item_id, reserved_qty
        from public.supply_plan_lines
       where supply_plan_id = p_plan_id and reserved_qty > 0
    loop
      insert into public.stock_movements (
        org_id, warehouse_id, item_id, movement_type, quantity,
        source_entity_type, source_entity_id, created_by
      ) values (
        v_org_id, v_warehouse_id, v_line.item_id, 'reserve_release', v_line.reserved_qty,
        'supply_plan', p_plan_id, p_actor
      );

      update public.supply_plan_lines
         set reserved_qty = 0,
             updated_by = p_actor
       where id = v_line.id;
    end loop;
  end if;

  update public.supply_plans
     set status = 'fulfilled',
         fulfilled_at = now(),
         updated_by = p_actor
   where id = p_plan_id;

  return p_plan_id;
end;
$$;

revoke execute on function public.fulfill_supply_plan(uuid, uuid, uuid) from public, anon;
grant execute on function public.fulfill_supply_plan(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.fulfill_supply_plan(uuid, uuid, uuid) is
  'Fulfills a released Supply Plan (Wave 12 / A6): released -> fulfilled, stamps fulfilled_at, and writes 0095 reserve_release movements for each line that still holds a reservation (zeroing the line reserved_qty) so the spine quantity_reserved is restored after the run consumed the stock. Does NOT restore shortage_qty (demand was met). 3-arg cross-tenant guard (NOT_FOUND). Idempotent on an already-fulfilled plan.';
