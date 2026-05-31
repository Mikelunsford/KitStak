-- ============================================================================
-- Migration: 0075_copack_kitting_emit_movements.sql
-- Wave: 10
-- Phase: Pillar 3 (Co-Pack and Ecom) foundation, step 3 of 4
-- Closes: builds on 0074 (kitting_jobs + line items). Implements the
--   started -> completed stock_movements trigger from section 3.5 of
--   03-workspace/specs/copack-ecom-pillar-spec.md (APPROVED 2026-05-31).
--   Mirrors migration 0053 (manufacturing emit_movements) exactly.
-- Date: 2026-05-31
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   drop trigger if exists kitting_jobs_emit_movements on public.kitting_jobs;
--   drop function if exists public.tg_kitting_jobs_emit_movements();
--   Ready-to-run only while no kitting_jobs row has yet transitioned to
--   `completed` in production. Once at least one job has emitted
--   stock_movements via this trigger, reverting leaves those rows orphaned.
--   Operator must verify zero `kitting_job` source_entity_type rows exist in
--   stock_movements before reverting.
--
-- Constitutional alignment:
--   Migration rules    Forward-only. Idempotent via create or replace function
--                      and drop trigger if exists + create trigger. New
--                      numbered file; no existing migration edited.
--   Money rules        unit_cost_cents flows BIGINT cents end-to-end. NULL on
--                      the line surfaces as a 0-cent cost via coalesce(...,0),
--                      preserving the 0048 / 0051 / 0053 semantics. quantity
--                      flows through as numeric(18,4). No floats.
--   RLS rules          Untouched. SECURITY DEFINER with set search_path =
--                      public, mirroring tg_manufacturing_runs_emit_movements.
--   Audit rules        Untouched. emit_movements writes to stock_movements, not
--                      audit_log. The kitting_jobs status-transition audit
--                      trigger from 0074 captures the completion transition.
--   Idempotency rules  Untouched.
--
-- movement_type codes (reuse the production codes verbatim, mirroring 0053):
--   Consumed components -> 'production_consumed' (leaves inventory).
--   Produced kits       -> 'production_produced' (enters inventory).
--   Pillar 3 kitting jobs are distinguished at the ledger from Pillar 1
--   production_runs and Pillar 2 manufacturing_runs by source_entity_type
--   ('kitting_job').
--
-- Schema-driven guards (identical to 0053):
--   kitting_job_consumed_line_items.item_id is NOT NULL -> no guard needed on
--   the consumed-side SELECT.
--   kitting_job_produced_line_items.item_id is NULLABLE -> the produced-side
--   SELECT carries `where li.item_id is not null` so descriptive-only outputs
--   are skipped and the NOT NULL contract on stock_movements.item_id holds.
--   kitting_jobs.warehouse_id is NULLABLE -> the outer guard
--   `if new.warehouse_id is null then return new` short-circuits emission for
--   jobs that complete without a warehouse assignment.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Trigger function: kitting_jobs status -> completed emits stock_movements
-- rows from the two normalised child tables. Mirrors 0053 exactly with the
-- table names and source_entity_type swapped.
-- ---------------------------------------------------------------------------

create or replace function public.tg_kitting_jobs_emit_movements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is null
     or new.status = old.status
     or new.status <> 'completed' then
    return new;
  end if;

  if new.warehouse_id is null then
    return new;
  end if;

  -- Consumed components leave inventory.
  insert into public.stock_movements (
    org_id, warehouse_id, item_id,
    movement_type, quantity, unit_cost_cents,
    source_entity_type, source_entity_id,
    occurred_at, created_by
  )
  select
    new.org_id,
    new.warehouse_id,
    li.item_id,
    'production_consumed',
    li.quantity,
    coalesce(li.unit_cost_cents, 0),
    'kitting_job',
    new.id,
    coalesce(new.completed_at, now()),
    new.updated_by
  from public.kitting_job_consumed_line_items li
  where li.org_id = new.org_id
    and li.kitting_job_id = new.id
  order by li.position;

  -- Produced kits enter inventory. Skip lines without an item_id
  -- (descriptive-only outputs from the lenient produced-side schema).
  insert into public.stock_movements (
    org_id, warehouse_id, item_id,
    movement_type, quantity, unit_cost_cents,
    source_entity_type, source_entity_id,
    occurred_at, created_by
  )
  select
    new.org_id,
    new.warehouse_id,
    li.item_id,
    'production_produced',
    li.quantity,
    coalesce(li.unit_cost_cents, 0),
    'kitting_job',
    new.id,
    coalesce(new.completed_at, now()),
    new.updated_by
  from public.kitting_job_produced_line_items li
  where li.org_id = new.org_id
    and li.kitting_job_id = new.id
    and li.item_id is not null
  order by li.position;

  return new;
end;
$$;

revoke execute on function public.tg_kitting_jobs_emit_movements() from public, anon;

drop trigger if exists kitting_jobs_emit_movements on public.kitting_jobs;
create trigger kitting_jobs_emit_movements
  after update of status on public.kitting_jobs
  for each row execute function public.tg_kitting_jobs_emit_movements();

comment on function public.tg_kitting_jobs_emit_movements() is
  'Pillar 3 Co-Pack: on draft|started -> completed, emits production_consumed and production_produced stock_movements rows from the two normalised kitting line-item tables. source_entity_type = kitting_job distinguishes Pillar 3 jobs at the ledger. Mirrors the 0053 emit_movements shape.';
