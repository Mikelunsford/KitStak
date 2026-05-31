-- ============================================================================
-- Migration: 0074_copack_kitting_jobs.sql
-- Wave: 10
-- Phase: Pillar 3 (Co-Pack and Ecom) foundation, step 2 of 4
-- Closes: builds on 0073 (channels/orders). Prerequisite for 0075 (kitting
--   emit_movements trigger) and 0076 (fulfillments). Implements sections 3.4
--   and 3.5 of 03-workspace/specs/copack-ecom-pillar-spec.md (APPROVED
--   2026-05-31). Decision K1: a new kitting_jobs table distinct from
--   manufacturing_runs, mirroring the manufacturing run shape one-for-one.
-- Date: 2026-05-31
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop trigger if exists audit_kitting_job_produced_line_items on public.kitting_job_produced_line_items;
--   drop trigger if exists audit_kitting_job_consumed_line_items on public.kitting_job_consumed_line_items;
--   drop trigger if exists audit_kitting_jobs_status on public.kitting_jobs;
--   drop trigger if exists kitting_job_produced_line_items_set_updated_at on public.kitting_job_produced_line_items;
--   drop trigger if exists kitting_job_consumed_line_items_set_updated_at on public.kitting_job_consumed_line_items;
--   drop trigger if exists kitting_jobs_set_updated_at on public.kitting_jobs;
--   drop function if exists public.trg_audit_kitting_job_produced_line_items();
--   drop function if exists public.trg_audit_kitting_job_consumed_line_items();
--   drop function if exists public.trg_audit_kitting_jobs_status();
--   drop function if exists public.trg_kitting_job_produced_line_items_set_updated_at();
--   drop function if exists public.trg_kitting_job_consumed_line_items_set_updated_at();
--   drop function if exists public.trg_kitting_jobs_set_updated_at();
--   drop policy if exists kitting_job_produced_line_items_write  on public.kitting_job_produced_line_items;
--   drop policy if exists kitting_job_produced_line_items_select on public.kitting_job_produced_line_items;
--   drop policy if exists kitting_job_consumed_line_items_write  on public.kitting_job_consumed_line_items;
--   drop policy if exists kitting_job_consumed_line_items_select on public.kitting_job_consumed_line_items;
--   drop policy if exists kitting_jobs_write  on public.kitting_jobs;
--   drop policy if exists kitting_jobs_select on public.kitting_jobs;
--   drop table if exists public.kitting_job_produced_line_items;
--   drop table if exists public.kitting_job_consumed_line_items;
--   drop table if exists public.kitting_jobs;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0073 CHECK constraint by hand if needed).
--
-- Constitutional alignment:
--   Money rules        unit_cost_cents stored as BIGINT cents with the _cents
--                      suffix (kitting consumes/produces at cost, mirroring
--                      manufacturing). quantity uses numeric(18,4). No floats.
--   RLS rules          Pattern A on every new table from creation. org_id
--                      denormalised onto child tables. Kitting write policy is
--                      ('org_owner','org_admin','ops') per Decision C1.
--   Audit rules        kitting_jobs has the AFTER UPDATE OF status audit
--                      trigger (manufacturing pattern). Line items use the
--                      central audit_append_state_change helper with an action
--                      verb in to_state.
--   Migration rules    Forward-only. All DDL idempotent. The audit_log CHECK
--                      extension re-adds the full list authoritative as of 0073
--                      plus the three new kitting entity_types.
--   State machine      status text + CHECK. draft -> started -> completed;
--                      draft|started -> cancelled. Identical to
--                      manufacturing_runs. emit_movements lands in 0075.
--   Out of scope       The started -> completed stock_movements trigger lives
--                      in 0075, not here. No stock_movements writes in this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include the kitting entities.
-- Guarded drop-then-add. Re-adds the full list (through 0073) plus
-- kitting_job, kitting_job_consumed_line_item, kitting_job_produced_line_item.
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
    'org_membership',
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
    -- Pillar 2 Manufacturing
    'manufacturing_run',
    'manufacturing_run_consumed_line_item',
    'manufacturing_run_produced_line_item',
    -- Pillar 3 Co-Pack and Ecom (channels/orders, 0073)
    'sales_channel',
    'sales_order',
    'sales_order_line_item',
    -- Pillar 3 Co-Pack and Ecom (kitting, this migration)
    'kitting_job',
    'kitting_job_consumed_line_item',
    'kitting_job_produced_line_item'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Extended in 0074 to add kitting_job, kitting_job_consumed_line_item, kitting_job_produced_line_item.';

-- ---------------------------------------------------------------------------
-- kitting_jobs: parent table for the Co-Pack build flow. Mirrors
-- manufacturing_runs one-for-one (Decision K1). State machine:
-- draft -> started -> completed; draft|started -> cancelled.
-- sales_order_id is nullable (build-to-order or build-to-stock).
-- job_number is org-scoped, nullable, filled by the numbering chassis (KIT-).
-- ---------------------------------------------------------------------------

create table if not exists public.kitting_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_number text,
  sales_order_id uuid references public.sales_orders(id),
  warehouse_id uuid references public.warehouses(id),
  status text not null default 'draft'
    check (status in ('draft', 'started', 'completed', 'cancelled')),
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

create unique index if not exists kitting_jobs_org_job_number_uniq
  on public.kitting_jobs (org_id, job_number)
  where job_number is not null;

create index if not exists kitting_jobs_org_idx
  on public.kitting_jobs (org_id)
  where deleted_at is null;

create index if not exists kitting_jobs_org_status_idx
  on public.kitting_jobs (org_id, status)
  where deleted_at is null;

create index if not exists kitting_jobs_org_warehouse_idx
  on public.kitting_jobs (org_id, warehouse_id)
  where warehouse_id is not null and deleted_at is null;

create index if not exists kitting_jobs_org_order_idx
  on public.kitting_jobs (org_id, sales_order_id)
  where sales_order_id is not null and deleted_at is null;

alter table public.kitting_jobs enable row level security;

drop policy if exists kitting_jobs_select on public.kitting_jobs;
create policy kitting_jobs_select on public.kitting_jobs
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists kitting_jobs_write on public.kitting_jobs;
create policy kitting_jobs_write on public.kitting_jobs
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
-- kitting_job_consumed_line_items: components consumed by a kitting job.
-- item_id REQUIRED (strict consumed-side schema, mirrors 0052).
-- ---------------------------------------------------------------------------

create table if not exists public.kitting_job_consumed_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kitting_job_id uuid not null references public.kitting_jobs(id) on delete cascade,
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

create index if not exists kitting_job_consumed_line_items_parent_idx
  on public.kitting_job_consumed_line_items (org_id, kitting_job_id, position);
create index if not exists kitting_job_consumed_line_items_org_idx
  on public.kitting_job_consumed_line_items (org_id);
create index if not exists kitting_job_consumed_line_items_item_idx
  on public.kitting_job_consumed_line_items (item_id);

alter table public.kitting_job_consumed_line_items enable row level security;

drop policy if exists kitting_job_consumed_line_items_select on public.kitting_job_consumed_line_items;
create policy kitting_job_consumed_line_items_select on public.kitting_job_consumed_line_items
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists kitting_job_consumed_line_items_write on public.kitting_job_consumed_line_items;
create policy kitting_job_consumed_line_items_write on public.kitting_job_consumed_line_items
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
-- kitting_job_produced_line_items: finished kits/outputs of a kitting job.
-- Same shape as consumed EXCEPT item_id is NULLABLE (lenient produced-side
-- schema, mirrors 0052 and F-Wave7-LINEFORM-VALIDATE-01).
-- ---------------------------------------------------------------------------

create table if not exists public.kitting_job_produced_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kitting_job_id uuid not null references public.kitting_jobs(id) on delete cascade,
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

create index if not exists kitting_job_produced_line_items_parent_idx
  on public.kitting_job_produced_line_items (org_id, kitting_job_id, position);
create index if not exists kitting_job_produced_line_items_org_idx
  on public.kitting_job_produced_line_items (org_id);
create index if not exists kitting_job_produced_line_items_item_idx
  on public.kitting_job_produced_line_items (item_id)
  where item_id is not null;

alter table public.kitting_job_produced_line_items enable row level security;

drop policy if exists kitting_job_produced_line_items_select on public.kitting_job_produced_line_items;
create policy kitting_job_produced_line_items_select on public.kitting_job_produced_line_items
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists kitting_job_produced_line_items_write on public.kitting_job_produced_line_items;
create policy kitting_job_produced_line_items_write on public.kitting_job_produced_line_items
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
-- updated_at stamping triggers.
-- ---------------------------------------------------------------------------

create or replace function public.trg_kitting_jobs_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists kitting_jobs_set_updated_at on public.kitting_jobs;
create trigger kitting_jobs_set_updated_at
  before update on public.kitting_jobs
  for each row execute function public.trg_kitting_jobs_set_updated_at();

create or replace function public.trg_kitting_job_consumed_line_items_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists kitting_job_consumed_line_items_set_updated_at
  on public.kitting_job_consumed_line_items;
create trigger kitting_job_consumed_line_items_set_updated_at
  before update on public.kitting_job_consumed_line_items
  for each row execute function public.trg_kitting_job_consumed_line_items_set_updated_at();

create or replace function public.trg_kitting_job_produced_line_items_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists kitting_job_produced_line_items_set_updated_at
  on public.kitting_job_produced_line_items;
create trigger kitting_job_produced_line_items_set_updated_at
  before update on public.kitting_job_produced_line_items
  for each row execute function public.trg_kitting_job_produced_line_items_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: kitting_jobs status transitions. Manufacturing pattern.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_kitting_jobs_status()
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
    'entity_type', 'kitting_job',
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
    new.org_id, 'kitting_job', new.id, old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

revoke execute on function public.trg_audit_kitting_jobs_status() from public, anon;

drop trigger if exists audit_kitting_jobs_status on public.kitting_jobs;
create trigger audit_kitting_jobs_status
  after update of status on public.kitting_jobs
  for each row execute function public.trg_audit_kitting_jobs_status();

-- ---------------------------------------------------------------------------
-- Audit trigger: kitting_job_consumed_line_items. Central helper, action verb.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_kitting_job_consumed_line_items()
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
      'kitting_job_id', new.kitting_job_id,
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
      'kitting_job_id', new.kitting_job_id,
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
      'kitting_job_id', old.kitting_job_id,
      'item_id', old.item_id,
      'quantity', old.quantity,
      'unit_cost_cents', old.unit_cost_cents
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'kitting_job_consumed_line_item',
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

revoke execute on function public.trg_audit_kitting_job_consumed_line_items() from public, anon;

drop trigger if exists audit_kitting_job_consumed_line_items
  on public.kitting_job_consumed_line_items;
create trigger audit_kitting_job_consumed_line_items
  after insert or update or delete on public.kitting_job_consumed_line_items
  for each row execute function public.trg_audit_kitting_job_consumed_line_items();

-- ---------------------------------------------------------------------------
-- Audit trigger: kitting_job_produced_line_items. Same pattern; label differs.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_kitting_job_produced_line_items()
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
      'kitting_job_id', new.kitting_job_id,
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
      'kitting_job_id', new.kitting_job_id,
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
      'kitting_job_id', old.kitting_job_id,
      'item_id', old.item_id,
      'quantity', old.quantity,
      'unit_cost_cents', old.unit_cost_cents
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'kitting_job_produced_line_item',
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

revoke execute on function public.trg_audit_kitting_job_produced_line_items() from public, anon;

drop trigger if exists audit_kitting_job_produced_line_items
  on public.kitting_job_produced_line_items;
create trigger audit_kitting_job_produced_line_items
  after insert or update or delete on public.kitting_job_produced_line_items
  for each row execute function public.trg_audit_kitting_job_produced_line_items();

-- ---------------------------------------------------------------------------
-- Table comments for operator discoverability.
-- ---------------------------------------------------------------------------

comment on table public.kitting_jobs is
  'Pillar 3 Co-Pack kitting job. State machine: draft -> started -> completed; draft|started -> cancelled. Distinct from manufacturing_runs (Decision K1, 2026-05-31). emit_movements trigger lands in 0075.';

comment on table public.kitting_job_consumed_line_items is
  'Components consumed by a kitting_job. item_id REQUIRED (strict consumed-side schema). Pattern A RLS via denormalised org_id.';

comment on table public.kitting_job_produced_line_items is
  'Finished kits produced by a kitting_job. item_id NULLABLE (lenient produced-side schema, mirrors F-Wave7-LINEFORM-VALIDATE-01). Pattern A RLS via denormalised org_id.';
