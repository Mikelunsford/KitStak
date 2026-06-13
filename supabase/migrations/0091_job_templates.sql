-- ============================================================================
-- Migration: 0091_job_templates.sql
-- Wave: 12
-- Phase: 3PL commercial pivot, Phase A2 (Job Builder foundation), step 1 of 2
-- Closes: prerequisite for 0092 (job_template numbering), plus the three-pl-api
--   job-template routes, the threepl.job_template capabilities, the
--   types/threepl side-car additions, and the SPA Job Builder pages. Implements
--   the Job Builders portion of
--   03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md
--   (Phase A2, section 6.1) and ADR 0002 (spine plus add-ons; the 3PL add-on
--   gains the Job Builder engine on top of the Accounts layer from 0089).
-- Date: 2026-06-13
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop trigger if exists audit_job_template_lines on public.job_template_lines;
--   drop trigger if exists audit_job_templates on public.job_templates;
--   drop trigger if exists job_template_lines_set_updated_at on public.job_template_lines;
--   drop trigger if exists job_templates_set_updated_at on public.job_templates;
--   drop function if exists public.trg_audit_job_template_lines();
--   drop function if exists public.trg_audit_job_templates();
--   drop function if exists public.trg_job_template_lines_set_updated_at();
--   drop function if exists public.trg_job_templates_set_updated_at();
--   drop policy if exists job_template_lines_write  on public.job_template_lines;
--   drop policy if exists job_template_lines_select on public.job_template_lines;
--   drop policy if exists job_templates_write  on public.job_templates;
--   drop policy if exists job_templates_select on public.job_templates;
--   drop table if exists public.job_template_lines;
--   drop table if exists public.job_templates;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0089 CHECK constraint by hand if needed).
--
-- Constitutional alignment:
--   Money rules        job_template_lines.rate_cents is BIGINT cents with the
--                      _cents suffix; currency_code is snapshotted by the
--                      handler at issuance. No floats. Quantities are
--                      numeric(18,4) per the chassis convention.
--   RLS rules          Pattern A on both tables from creation. org_id is
--                      denormalised onto the child so RLS evaluates without a
--                      parent join, mirroring 0089. ON DELETE CASCADE on the
--                      parent FK keeps child rows in sync. Write policy is
--                      ('org_owner','org_admin','ops','sales'); selects are
--                      org-scoped only. Cross-tenant reads return 200 + [];
--                      cross-tenant writes hit the NOT_FOUND surface.
--   Audit rules        Both tables use the central audit_append_state_change
--                      helper on INSERT / UPDATE / DELETE with an action verb
--                      (created / updated / deleted) as to_state, identical to
--                      the 0089 accounts pattern. The audit_log entity_type
--                      CHECK is extended via a guarded drop-then-add that re-adds
--                      the full authoritative list (through 0089) plus
--                      job_template and job_template_line. Strict superset.
--   Migration rules    Forward-only. All DDL idempotent (IF EXISTS / IF NOT
--                      EXISTS, guarded constraint drop-then-add).
--   State machine      job_templates.status is a simple active / inactive flag
--                      enforced by CHECK, not a registered FSM (like the 0089
--                      account). The deactivate / reactivate routes set it.
--   Spine references   job_type_id references the spine job_types. default
--                      BOM is item-keyed: BOMs have no standalone table (they
--                      are bom_items rows under a parent item), so
--                      default_bom_item_id references items(id), the parent item
--                      whose bom_items compose the default BOM. Both nullable,
--                      validated in-org by the handler (assertRefInOrg).
--   Out of scope       Job-template numbering (0092). No handler code, no SPA,
--                      no Zod canon, no capabilities in this file. Job runs,
--                      supply plans, and billing reviews are later A-phases.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include the Job Builder entities.
-- Guarded drop-then-add. Re-adds every value authoritative as of 0089 plus
-- job_template, job_template_line. Strict superset.
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
    -- Pillar 3 Co-Pack and Ecom (kitting, 0074)
    'kitting_job',
    'kitting_job_consumed_line_item',
    'kitting_job_produced_line_item',
    -- Pillar 3 Co-Pack and Ecom (fulfillment, 0076)
    'fulfillment',
    -- Pillar 4 KitForce workforce (0078)
    'workforce_member',
    'workforce_team',
    'workforce_team_member',
    -- Pillar 4 KitForce shifts (0079)
    'shift',
    -- Pillar 4 KitForce assignments (0080)
    'work_assignment',
    -- Pillar 4 KitForce time entries (0081)
    'time_entry',
    -- 3PL commercial layer accounts (0089)
    'three_pl_account',
    'account_service_definition',
    -- 3PL commercial layer Job Builder (this migration, 0091)
    'job_template',
    'job_template_line'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Authoritative full list as of 0091, which adds the Job Builder types job_template and job_template_line on top of the 0089 list. Update via forward migration when a new state machine ships, and never subset the prior list.';

-- ---------------------------------------------------------------------------
-- job_templates: the Job Builders engine. Parent table, no rich state machine
-- (status active / inactive flag only). template_number is org-scoped, nullable,
-- filled by the numbering chassis (0092, JB- prefix). variant brands the preset
-- (kit, sidekick, repack, ...). job_type_id and default_bom_item_id reference
-- spine catalog rows and are validated in-org by the handler.
-- ---------------------------------------------------------------------------

create table if not exists public.job_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  template_number text,
  name text not null,
  variant text not null default 'custom'
    check (variant in (
      'kit', 'sidekick', 'repack', 'labeling', 'inspection', 'custom'
    )),
  job_type_id uuid references public.job_types(id),
  -- BOMs are item-keyed (bom_items under a parent item); there is no standalone
  -- boms table, so the default BOM is the parent item whose bom_items compose it.
  default_bom_item_id uuid references public.items(id),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create unique index if not exists job_templates_org_template_number_uniq
  on public.job_templates (org_id, template_number)
  where template_number is not null;

create index if not exists job_templates_org_idx
  on public.job_templates (org_id)
  where deleted_at is null;

create index if not exists job_templates_org_status_idx
  on public.job_templates (org_id, status)
  where deleted_at is null;

create index if not exists job_templates_org_variant_idx
  on public.job_templates (org_id, variant)
  where deleted_at is null;

create index if not exists job_templates_job_type_idx
  on public.job_templates (job_type_id)
  where job_type_id is not null;

alter table public.job_templates enable row level security;

drop policy if exists job_templates_select on public.job_templates;
create policy job_templates_select on public.job_templates
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists job_templates_write on public.job_templates;
create policy job_templates_write on public.job_templates
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'sales')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'sales')
  );

-- ---------------------------------------------------------------------------
-- job_template_lines: the builder definition lines. Child of job_templates,
-- denormalised org_id for Pattern A RLS. line_kind partitions component
-- (item_id), service (vas_id), and step (instruction / labor) lines. rate_cents
-- is BIGINT cents; quantity is numeric(18,4).
-- ---------------------------------------------------------------------------

create table if not exists public.job_template_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.job_templates(id) on delete cascade,
  line_kind text not null default 'component'
    check (line_kind in ('component', 'service', 'step')),
  item_id uuid references public.items(id),
  vas_id uuid references public.value_added_services(id),
  name text not null,
  quantity numeric(18,4),
  rate_cents bigint check (rate_cents is null or rate_cents >= 0),
  rate_uom text,
  currency_code text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists job_template_lines_parent_idx
  on public.job_template_lines (org_id, template_id, position);
create index if not exists job_template_lines_org_idx
  on public.job_template_lines (org_id);
create index if not exists job_template_lines_item_idx
  on public.job_template_lines (item_id)
  where item_id is not null;
create index if not exists job_template_lines_vas_idx
  on public.job_template_lines (vas_id)
  where vas_id is not null;

alter table public.job_template_lines enable row level security;

drop policy if exists job_template_lines_select on public.job_template_lines;
create policy job_template_lines_select on public.job_template_lines
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists job_template_lines_write on public.job_template_lines;
create policy job_template_lines_write on public.job_template_lines
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'sales')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in ('org_owner', 'org_admin', 'ops', 'sales')
  );

-- ---------------------------------------------------------------------------
-- updated_at stamping triggers. Plain BEFORE UPDATE; no audit side effect.
-- ---------------------------------------------------------------------------

create or replace function public.trg_job_templates_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists job_templates_set_updated_at on public.job_templates;
create trigger job_templates_set_updated_at
  before update on public.job_templates
  for each row execute function public.trg_job_templates_set_updated_at();

create or replace function public.trg_job_template_lines_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists job_template_lines_set_updated_at
  on public.job_template_lines;
create trigger job_template_lines_set_updated_at
  before update on public.job_template_lines
  for each row execute function public.trg_job_template_lines_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: job_templates. INSERT / UPDATE / DELETE via the central
-- audit_append_state_change helper. Action verb in to_state.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_job_templates()
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
      'name', new.name,
      'variant', new.variant,
      'status', new.status
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
      'name', jsonb_build_object('from', old.name, 'to', new.name),
      'variant', jsonb_build_object('from', old.variant, 'to', new.variant),
      'status', jsonb_build_object('from', old.status, 'to', new.status),
      'deleted_at', jsonb_build_object('from', old.deleted_at, 'to', new.deleted_at)
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
      'name', old.name,
      'variant', old.variant,
      'status', old.status
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'job_template',
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

revoke execute on function public.trg_audit_job_templates() from public, anon;

drop trigger if exists audit_job_templates on public.job_templates;
create trigger audit_job_templates
  after insert or update or delete on public.job_templates
  for each row execute function public.trg_audit_job_templates();

-- ---------------------------------------------------------------------------
-- Audit trigger: job_template_lines. INSERT / UPDATE / DELETE via the central
-- helper with an action verb as to_state.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_job_template_lines()
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
      'template_id', new.template_id,
      'line_kind', new.line_kind,
      'name', new.name,
      'quantity', new.quantity,
      'rate_cents', new.rate_cents,
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
      'line_kind', jsonb_build_object('from', old.line_kind, 'to', new.line_kind),
      'name', jsonb_build_object('from', old.name, 'to', new.name),
      'quantity', jsonb_build_object('from', old.quantity, 'to', new.quantity),
      'rate_cents', jsonb_build_object('from', old.rate_cents, 'to', new.rate_cents),
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
      'template_id', old.template_id,
      'line_kind', old.line_kind,
      'name', old.name
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'job_template_line',
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

revoke execute on function public.trg_audit_job_template_lines() from public, anon;

drop trigger if exists audit_job_template_lines on public.job_template_lines;
create trigger audit_job_template_lines
  after insert or update or delete on public.job_template_lines
  for each row execute function public.trg_audit_job_template_lines();

-- ---------------------------------------------------------------------------
-- Table comments for operator discoverability.
-- ---------------------------------------------------------------------------

comment on table public.job_templates is
  '3PL Job Builder engine: a reusable job template (variant kit / sidekick / repack / labeling / inspection / custom). job_type_id references the spine job_types; default_bom_item_id references items(id), the parent item whose bom_items compose the default BOM (BOMs are item-keyed, no standalone table). status is an active / inactive flag, not a registered FSM. template_number filled by the numbering chassis (JB- prefix, 0092). Pattern A RLS via denormalised org_id.';

comment on table public.job_template_lines is
  'Builder definition lines for a job_template. line_kind partitions component (item_id), service (vas_id), and step lines. rate_cents is BIGINT cents; quantity is numeric(18,4). Child of job_templates. Pattern A RLS via denormalised org_id.';
