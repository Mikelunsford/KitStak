-- ============================================================================
-- Migration: 0052_manufacturing_runs_schema.sql
-- Wave: 9
-- Phase: Pillar 2 (Manufacturing) foundation, Path A step A1
-- Closes: prerequisite for Path A2 (emit_movements trigger),
--   A3 (manufacturing-api bundle), A4 (capabilities), A5 (SPA pages),
--   A6 (feature flag flip). Decision-C (separate Manufacturing tables;
--   Pillar 1 production_runs stays untouched) and Decision-(b)
--   (new manufacturing-api bundle in a later PR) operator-approved
--   2026-05-20.
-- Date: 2026-05-20
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop trigger if exists audit_manufacturing_run_produced_line_items on public.manufacturing_run_produced_line_items;
--   drop trigger if exists audit_manufacturing_run_consumed_line_items on public.manufacturing_run_consumed_line_items;
--   drop trigger if exists audit_manufacturing_runs_status on public.manufacturing_runs;
--   drop trigger if exists manufacturing_run_produced_line_items_set_updated_at on public.manufacturing_run_produced_line_items;
--   drop trigger if exists manufacturing_run_consumed_line_items_set_updated_at on public.manufacturing_run_consumed_line_items;
--   drop trigger if exists manufacturing_runs_set_updated_at on public.manufacturing_runs;
--   drop function if exists public.trg_audit_manufacturing_run_produced_line_items();
--   drop function if exists public.trg_audit_manufacturing_run_consumed_line_items();
--   drop function if exists public.trg_audit_manufacturing_runs_status();
--   drop function if exists public.trg_manufacturing_run_produced_line_items_set_updated_at();
--   drop function if exists public.trg_manufacturing_run_consumed_line_items_set_updated_at();
--   drop function if exists public.trg_manufacturing_runs_set_updated_at();
--   drop policy if exists manufacturing_run_produced_line_items_write  on public.manufacturing_run_produced_line_items;
--   drop policy if exists manufacturing_run_produced_line_items_select on public.manufacturing_run_produced_line_items;
--   drop policy if exists manufacturing_run_consumed_line_items_write  on public.manufacturing_run_consumed_line_items;
--   drop policy if exists manufacturing_run_consumed_line_items_select on public.manufacturing_run_consumed_line_items;
--   drop policy if exists manufacturing_runs_write  on public.manufacturing_runs;
--   drop policy if exists manufacturing_runs_select on public.manufacturing_runs;
--   drop table if exists public.manufacturing_run_produced_line_items;
--   drop table if exists public.manufacturing_run_consumed_line_items;
--   drop table if exists public.manufacturing_runs;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores prior 0044 CHECK constraint by hand if needed).
--
-- Constitutional alignment:
--   Money rules        unit_cost_cents stored as BIGINT cents with the _cents
--                      suffix. quantity uses numeric(18,4) to mirror the
--                      receiving_order_line_items / shipment_line_items shape
--                      from 0050 and the project_line_items shape from 0044.
--                      No floats anywhere.
--   RLS rules          Pattern A on every new table from creation. org_id is
--                      denormalised onto the two child tables so RLS evaluates
--                      without a parent join, mirroring 0050 exactly. ON
--                      DELETE CASCADE on the parent FK keeps child rows in
--                      sync on physical delete. Cross-tenant reads return
--                      200 + []; cross-tenant writes hit the same NOT_FOUND
--                      surface as the parent (parent absent under the
--                      caller's org_id scope).
--   Audit rules        manufacturing_runs has an auto-state-transition audit
--                      trigger that fires AFTER UPDATE OF status, identical
--                      pattern to trg_audit_receiving_orders_status from
--                      0033 (SECURITY DEFINER, per-org advisory lock, hash
--                      chain via prev_hash, inline audit_log INSERT). Line
--                      item audit triggers follow the trg_audit_project_line_items
--                      pattern from 0044 as corrected in 0047: fire on
--                      INSERT / UPDATE / DELETE, route through the central
--                      audit_append_state_change helper, pass an action verb
--                      (created / updated / deleted) as to_state so the
--                      NOT NULL contract on audit_log.to_state holds.
--   Migration rules    Forward-only. All DDL idempotent (CREATE TABLE IF
--                      NOT EXISTS, drop-policy-if-exists before create,
--                      CREATE INDEX IF NOT EXISTS, drop-and-create on every
--                      trigger, CREATE OR REPLACE FUNCTION). The audit_log
--                      entity_type CHECK constraint extension uses a guarded
--                      DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT pair so
--                      a re-run does not error.
--   State machine     status text + CHECK constraint, not pg enum. Mirrors
--                     receiving_orders / production_runs / shipments from
--                     0032. Allowed transitions enforced by the audit trigger
--                     guard (fires only when new.status differs from
--                     old.status) plus the application layer (A3
--                     manufacturing-api). Timestamps started_at / completed_at
--                     / cancelled_at are handler-set (mirrors production_runs
--                     started_at / completed_at convention from 0032). No
--                     BEFORE UPDATE timestamp-stamping trigger; updated_at
--                     is the only auto-stamped column.
--   Out of scope      tg_manufacturing_runs_emit_movements lives in A2, not
--                     here. No stock_movements writes in this migration.
--                     No handler code, no SPA, no Zod canon, no capabilities
--                     side-car. Byte-mirror parity is unaffected because no
--                     types changed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include manufacturing entities.
-- Pattern mirrors 0044: guarded drop-then-add. The prior CHECK was added in
-- 0044 (and is the latest authoritative version on disk per 0046 / 0047 /
-- 0050 / 0051 which did not touch it). Re-add includes every existing value
-- plus the three new manufacturing entity_types.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.audit_log'::regclass
       and conname  = 'audit_log_entity_type_check'
  ) then
    alter table public.audit_log
      drop constraint audit_log_entity_type_check;
  end if;
end$$;

alter table public.audit_log
  add constraint audit_log_entity_type_check
  check (entity_type in (
    -- Wave 1 identity
    'organization',
    -- Sales / CRM
    'customer',
    'contact',
    'activity',
    'lead',
    'opportunity',
    -- Catalog
    'item',
    -- Sales chassis
    'quote',
    'quote_line_item',
    'project',
    'project_phase',
    'project_line_item',
    -- Billing / GL
    'invoice',
    'invoice_line_item',
    'payment',
    'credit_note',
    'journal_entry',
    'period_close',
    -- Procurement / Ops
    'vendor',
    'purchase_order',
    'po_line_item',
    'vendor_bill',
    'expense',
    'warehouse',
    'stock_movement',
    'receiving_order',
    'production_run',
    'shipment',
    -- Cross-cutting collab
    'attachment',
    'comment',
    'notification',
    -- Pillar 2 Manufacturing (this migration)
    'manufacturing_run',
    'manufacturing_run_consumed_line_item',
    'manufacturing_run_produced_line_item'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Extended in 0052 to add manufacturing_run, manufacturing_run_consumed_line_item, manufacturing_run_produced_line_item.';

-- ---------------------------------------------------------------------------
-- manufacturing_runs: parent table for the Pillar 2 manufacturing flow.
-- State machine: draft -> started -> completed; draft|started -> cancelled.
-- Status timestamps (started_at / completed_at / cancelled_at) are
-- handler-set, mirroring the production_runs convention from 0032.
-- run_number is operator-friendly identifier (e.g., MFG-001), nullable for
-- now because the org-scoped numbering service is not yet wired; uniqueness
-- within an org is enforced via a partial unique index so multiple draft
-- runs without a number can coexist.
-- ---------------------------------------------------------------------------

create table if not exists public.manufacturing_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  run_number text,
  status text not null default 'draft'
    check (status in ('draft', 'started', 'completed', 'cancelled')),
  warehouse_id uuid references public.warehouses(id),
  planned_start_at timestamptz,
  planned_complete_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create unique index if not exists manufacturing_runs_org_run_number_uniq
  on public.manufacturing_runs (org_id, run_number)
  where run_number is not null;

create index if not exists manufacturing_runs_org_idx
  on public.manufacturing_runs (org_id)
  where deleted_at is null;

create index if not exists manufacturing_runs_org_status_idx
  on public.manufacturing_runs (org_id, status)
  where deleted_at is null;

create index if not exists manufacturing_runs_org_warehouse_idx
  on public.manufacturing_runs (org_id, warehouse_id)
  where warehouse_id is not null and deleted_at is null;

alter table public.manufacturing_runs enable row level security;

drop policy if exists manufacturing_runs_select on public.manufacturing_runs;
create policy manufacturing_runs_select on public.manufacturing_runs
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists manufacturing_runs_write on public.manufacturing_runs;
create policy manufacturing_runs_write on public.manufacturing_runs
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  );

-- ---------------------------------------------------------------------------
-- manufacturing_run_consumed_line_items: materials consumed during a run.
-- Mirrors receiving_order_line_items shape from 0050 with the parent FK
-- swapped. item_id is REQUIRED (strict consumed-side schema, per the
-- F-Wave7-LINEFORM-VALIDATE-01 convention from PR #42): a consumed line
-- must identify what material was consumed.
-- ---------------------------------------------------------------------------

create table if not exists public.manufacturing_run_consumed_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  manufacturing_run_id uuid not null references public.manufacturing_runs(id) on delete cascade,
  item_id uuid not null references public.items(id),
  quantity numeric(18, 4) not null default 0 check (quantity >= 0),
  unit_cost_cents bigint check (unit_cost_cents is null or unit_cost_cents >= 0),
  uom text,
  reference text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists manufacturing_run_consumed_line_items_parent_idx
  on public.manufacturing_run_consumed_line_items (org_id, manufacturing_run_id, position);
create index if not exists manufacturing_run_consumed_line_items_org_idx
  on public.manufacturing_run_consumed_line_items (org_id);
create index if not exists manufacturing_run_consumed_line_items_item_idx
  on public.manufacturing_run_consumed_line_items (item_id);

alter table public.manufacturing_run_consumed_line_items enable row level security;

drop policy if exists manufacturing_run_consumed_line_items_select on public.manufacturing_run_consumed_line_items;
create policy manufacturing_run_consumed_line_items_select on public.manufacturing_run_consumed_line_items
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists manufacturing_run_consumed_line_items_write on public.manufacturing_run_consumed_line_items;
create policy manufacturing_run_consumed_line_items_write on public.manufacturing_run_consumed_line_items
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  );

-- ---------------------------------------------------------------------------
-- manufacturing_run_produced_line_items: outputs of a run. Same shape as
-- consumed EXCEPT item_id is NULLABLE. This mirrors the lenient produced
-- side from F-Wave7-LINEFORM-VALIDATE-01 (PR #42): the produced item may
-- not always be a known SKU at run-start (custom one-off output). Handlers
-- and SPA enforce business rules; the DB tolerates the looser shape.
-- ---------------------------------------------------------------------------

create table if not exists public.manufacturing_run_produced_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  manufacturing_run_id uuid not null references public.manufacturing_runs(id) on delete cascade,
  item_id uuid references public.items(id),
  quantity numeric(18, 4) not null default 0 check (quantity >= 0),
  unit_cost_cents bigint check (unit_cost_cents is null or unit_cost_cents >= 0),
  uom text,
  reference text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists manufacturing_run_produced_line_items_parent_idx
  on public.manufacturing_run_produced_line_items (org_id, manufacturing_run_id, position);
create index if not exists manufacturing_run_produced_line_items_org_idx
  on public.manufacturing_run_produced_line_items (org_id);
create index if not exists manufacturing_run_produced_line_items_item_idx
  on public.manufacturing_run_produced_line_items (item_id)
  where item_id is not null;

alter table public.manufacturing_run_produced_line_items enable row level security;

drop policy if exists manufacturing_run_produced_line_items_select on public.manufacturing_run_produced_line_items;
create policy manufacturing_run_produced_line_items_select on public.manufacturing_run_produced_line_items
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists manufacturing_run_produced_line_items_write on public.manufacturing_run_produced_line_items;
create policy manufacturing_run_produced_line_items_write on public.manufacturing_run_produced_line_items
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops')
  );

-- ---------------------------------------------------------------------------
-- updated_at stamping triggers. Plain BEFORE UPDATE; no audit side effect.
-- Mirrors the 0050 line-item stamp-trigger pattern.
-- ---------------------------------------------------------------------------

create or replace function public.trg_manufacturing_runs_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists manufacturing_runs_set_updated_at on public.manufacturing_runs;
create trigger manufacturing_runs_set_updated_at
  before update on public.manufacturing_runs
  for each row execute function public.trg_manufacturing_runs_set_updated_at();

create or replace function public.trg_manufacturing_run_consumed_line_items_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists manufacturing_run_consumed_line_items_set_updated_at
  on public.manufacturing_run_consumed_line_items;
create trigger manufacturing_run_consumed_line_items_set_updated_at
  before update on public.manufacturing_run_consumed_line_items
  for each row execute function public.trg_manufacturing_run_consumed_line_items_set_updated_at();

create or replace function public.trg_manufacturing_run_produced_line_items_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists manufacturing_run_produced_line_items_set_updated_at
  on public.manufacturing_run_produced_line_items;
create trigger manufacturing_run_produced_line_items_set_updated_at
  before update on public.manufacturing_run_produced_line_items
  for each row execute function public.trg_manufacturing_run_produced_line_items_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: manufacturing_runs status transitions. Identical pattern to
-- trg_audit_receiving_orders_status from 0033 (SECURITY DEFINER, per-org
-- advisory lock, hash chain via prev_hash, inline audit_log INSERT). Fires
-- only when status actually changed. State-machine entity, so to_state
-- carries the new status string (not an action verb).
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_manufacturing_runs_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  if new.status is null or new.status = old.status then
    return new;
  end if;
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  select payload_hash into v_prev_hash
    from public.audit_log
   where org_id = new.org_id
   order by triggered_at desc, id desc limit 1;
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'manufacturing_run',
    'entity_id', new.id,
    'from_state', old.status,
    'to_state', new.status,
    'action', 'status_change',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, prev_hash, payload_hash
  ) values (
    new.org_id, 'manufacturing_run', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

revoke execute on function public.trg_audit_manufacturing_runs_status() from public, anon;

drop trigger if exists audit_manufacturing_runs_status on public.manufacturing_runs;
create trigger audit_manufacturing_runs_status
  after update of status on public.manufacturing_runs
  for each row execute function public.trg_audit_manufacturing_runs_status();

-- ---------------------------------------------------------------------------
-- Audit trigger: manufacturing_run_consumed_line_items. Fires on every
-- INSERT / UPDATE / DELETE via the central audit_append_state_change helper.
-- Mirrors the trg_audit_project_line_items pattern from 0044 as corrected
-- in 0047 (pass an action verb as to_state so the NOT NULL audit_log
-- contract holds; line items are not state-machine entities).
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_manufacturing_run_consumed_line_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
  v_entity_id uuid;
  v_action text;
  v_to_state text;
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    v_org_id := new.org_id;
    v_entity_id := new.id;
    v_action := 'insert';
    v_to_state := 'created';
    begin
      v_actor := coalesce(auth.uid(), new.created_by);
    exception when others then
      v_actor := new.created_by;
    end;
    v_diff := jsonb_build_object(
      'manufacturing_run_id', new.manufacturing_run_id,
      'item_id', new.item_id,
      'quantity', new.quantity,
      'unit_cost_cents', new.unit_cost_cents,
      'uom', new.uom,
      'reference', new.reference,
      'position', new.position
    );
  elsif tg_op = 'UPDATE' then
    v_org_id := new.org_id;
    v_entity_id := new.id;
    v_action := 'update';
    v_to_state := 'updated';
    begin
      v_actor := coalesce(auth.uid(), new.updated_by);
    exception when others then
      v_actor := new.updated_by;
    end;
    v_diff := jsonb_build_object(
      'manufacturing_run_id', new.manufacturing_run_id,
      'item_id', jsonb_build_object('from', old.item_id, 'to', new.item_id),
      'quantity', jsonb_build_object('from', old.quantity, 'to', new.quantity),
      'unit_cost_cents', jsonb_build_object('from', old.unit_cost_cents, 'to', new.unit_cost_cents),
      'position', jsonb_build_object('from', old.position, 'to', new.position)
    );
  else -- DELETE
    v_org_id := old.org_id;
    v_entity_id := old.id;
    v_action := 'delete';
    v_to_state := 'deleted';
    begin
      v_actor := coalesce(auth.uid(), old.updated_by);
    exception when others then
      v_actor := old.updated_by;
    end;
    v_diff := jsonb_build_object(
      'manufacturing_run_id', old.manufacturing_run_id,
      'item_id', old.item_id,
      'quantity', old.quantity,
      'unit_cost_cents', old.unit_cost_cents
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'manufacturing_run_consumed_line_item',
    v_entity_id,
    null,
    v_to_state,
    v_action,
    v_actor,
    v_diff
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_manufacturing_run_consumed_line_items() from public, anon;

drop trigger if exists audit_manufacturing_run_consumed_line_items
  on public.manufacturing_run_consumed_line_items;
create trigger audit_manufacturing_run_consumed_line_items
  after insert or update or delete on public.manufacturing_run_consumed_line_items
  for each row execute function public.trg_audit_manufacturing_run_consumed_line_items();

-- ---------------------------------------------------------------------------
-- Audit trigger: manufacturing_run_produced_line_items. Same pattern as the
-- consumed-side trigger above; only the entity_type label differs.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_manufacturing_run_produced_line_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
  v_entity_id uuid;
  v_action text;
  v_to_state text;
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    v_org_id := new.org_id;
    v_entity_id := new.id;
    v_action := 'insert';
    v_to_state := 'created';
    begin
      v_actor := coalesce(auth.uid(), new.created_by);
    exception when others then
      v_actor := new.created_by;
    end;
    v_diff := jsonb_build_object(
      'manufacturing_run_id', new.manufacturing_run_id,
      'item_id', new.item_id,
      'quantity', new.quantity,
      'unit_cost_cents', new.unit_cost_cents,
      'uom', new.uom,
      'reference', new.reference,
      'position', new.position
    );
  elsif tg_op = 'UPDATE' then
    v_org_id := new.org_id;
    v_entity_id := new.id;
    v_action := 'update';
    v_to_state := 'updated';
    begin
      v_actor := coalesce(auth.uid(), new.updated_by);
    exception when others then
      v_actor := new.updated_by;
    end;
    v_diff := jsonb_build_object(
      'manufacturing_run_id', new.manufacturing_run_id,
      'item_id', jsonb_build_object('from', old.item_id, 'to', new.item_id),
      'quantity', jsonb_build_object('from', old.quantity, 'to', new.quantity),
      'unit_cost_cents', jsonb_build_object('from', old.unit_cost_cents, 'to', new.unit_cost_cents),
      'position', jsonb_build_object('from', old.position, 'to', new.position)
    );
  else -- DELETE
    v_org_id := old.org_id;
    v_entity_id := old.id;
    v_action := 'delete';
    v_to_state := 'deleted';
    begin
      v_actor := coalesce(auth.uid(), old.updated_by);
    exception when others then
      v_actor := old.updated_by;
    end;
    v_diff := jsonb_build_object(
      'manufacturing_run_id', old.manufacturing_run_id,
      'item_id', old.item_id,
      'quantity', old.quantity,
      'unit_cost_cents', old.unit_cost_cents
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'manufacturing_run_produced_line_item',
    v_entity_id,
    null,
    v_to_state,
    v_action,
    v_actor,
    v_diff
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_audit_manufacturing_run_produced_line_items() from public, anon;

drop trigger if exists audit_manufacturing_run_produced_line_items
  on public.manufacturing_run_produced_line_items;
create trigger audit_manufacturing_run_produced_line_items
  after insert or update or delete on public.manufacturing_run_produced_line_items
  for each row execute function public.trg_audit_manufacturing_run_produced_line_items();

-- ---------------------------------------------------------------------------
-- Table comments for operator discoverability.
-- ---------------------------------------------------------------------------

comment on table public.manufacturing_runs is
  'Pillar 2 Manufacturing run. State machine: draft -> started -> completed; draft|started -> cancelled. Separate from Pillar 1 production_runs (Decision-C, 2026-05-20). emit_movements trigger lands in A2.';

comment on table public.manufacturing_run_consumed_line_items is
  'Materials consumed by a manufacturing_run. item_id REQUIRED (strict consumed-side schema). Pattern A RLS via denormalised org_id.';

comment on table public.manufacturing_run_produced_line_items is
  'Outputs of a manufacturing_run. item_id NULLABLE (lenient produced-side schema, mirrors F-Wave7-LINEFORM-VALIDATE-01 pattern). Pattern A RLS via denormalised org_id.';
