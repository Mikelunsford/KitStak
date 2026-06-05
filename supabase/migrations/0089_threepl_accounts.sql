-- ============================================================================
-- Migration: 0089_threepl_accounts.sql
-- Wave: 12
-- Phase: 3PL commercial pivot, Phase A1 (Accounts model), step 1 of 2
-- Closes: prerequisite for 0090 (accounts numbering), plus the three-pl-api
--   account routes, the threepl capabilities, the types/threepl side-car, and
--   the SPA Accounts pages. Implements the Accounts portion of
--   03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md
--   (Phase A1) and ADR 0002 (spine plus add-ons; 3PL gains the commercial layer).
-- Date: 2026-06-04
--
-- DOWN MIGRATION (operator-only; not auto-run). Drop in reverse:
--   drop trigger if exists audit_account_service_definitions on public.account_service_definitions;
--   drop trigger if exists audit_three_pl_accounts on public.three_pl_accounts;
--   drop trigger if exists account_service_definitions_set_updated_at on public.account_service_definitions;
--   drop trigger if exists three_pl_accounts_set_updated_at on public.three_pl_accounts;
--   drop function if exists public.trg_audit_account_service_definitions();
--   drop function if exists public.trg_audit_three_pl_accounts();
--   drop function if exists public.trg_account_service_definitions_set_updated_at();
--   drop function if exists public.trg_three_pl_accounts_set_updated_at();
--   drop policy if exists account_service_definitions_write  on public.account_service_definitions;
--   drop policy if exists account_service_definitions_select on public.account_service_definitions;
--   drop policy if exists three_pl_accounts_write  on public.three_pl_accounts;
--   drop policy if exists three_pl_accounts_select on public.three_pl_accounts;
--   drop table if exists public.account_service_definitions;
--   drop table if exists public.three_pl_accounts;
--   alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
--   (operator restores the prior 0083 CHECK constraint by hand if needed).
--
-- Constitutional alignment:
--   Money rules        account_service_definitions.rate_cents is BIGINT cents
--                      with the _cents suffix; currency_code is snapshotted by
--                      the handler at issuance. No floats anywhere.
--   RLS rules          Pattern A on both tables from creation. org_id is
--                      denormalised onto the child so RLS evaluates without a
--                      parent join, mirroring 0073. ON DELETE CASCADE on the
--                      parent FK keeps child rows in sync. Write policy is
--                      ('org_owner','org_admin','ops','sales'); selects are
--                      org-scoped only. Cross-tenant reads return 200 + [];
--                      cross-tenant writes hit the NOT_FOUND surface.
--   Audit rules        Both tables use the central audit_append_state_change
--                      helper on INSERT / UPDATE / DELETE with an action verb
--                      (created / updated / deleted) as to_state, identical to
--                      the sales_channels pattern from 0073. The audit_log
--                      entity_type CHECK is extended via a guarded
--                      drop-then-add that re-adds the full authoritative list
--                      (through 0083) plus three_pl_account and
--                      account_service_definition. Strict superset; never a
--                      subset of any prior enumeration.
--   Migration rules    Forward-only. All DDL idempotent (IF EXISTS / IF NOT
--                      EXISTS, guarded constraint drop-then-add).
--   State machine      three_pl_accounts.status is a simple active / inactive
--                      flag enforced by CHECK, not a registered FSM (like the
--                      Co-Pack channel library). No status-transition hash-chain
--                      trigger; the helper audit captures the change.
--   Out of scope       Accounts numbering (0090). No handler code, no SPA, no
--                      Zod canon, no capabilities in this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log.entity_type CHECK to include the 3PL commercial entities.
-- Guarded drop-then-add. Re-adds every value authoritative as of 0083 plus
-- three_pl_account, account_service_definition. Strict superset.
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
    -- 3PL commercial layer (this migration, 0089)
    'three_pl_account',
    'account_service_definition'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Authoritative full list as of 0089, which adds the 3PL commercial layer types three_pl_account and account_service_definition on top of the 0083 list. Update via forward migration when a new state machine ships, and never subset the prior list.';

-- ---------------------------------------------------------------------------
-- three_pl_accounts: the service-relationship layer over a CRM customer.
-- Parent table, no rich state machine (status active / inactive flag only).
-- account_number is org-scoped, nullable, filled by the numbering chassis (0090).
-- customer_id REQUIRED: an account names the CRM customer it serves; it never
-- copies the customer.
-- ---------------------------------------------------------------------------

create table if not exists public.three_pl_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  account_number text,
  name text not null,
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

create unique index if not exists three_pl_accounts_org_account_number_uniq
  on public.three_pl_accounts (org_id, account_number)
  where account_number is not null;

create index if not exists three_pl_accounts_org_idx
  on public.three_pl_accounts (org_id)
  where deleted_at is null;

create index if not exists three_pl_accounts_org_status_idx
  on public.three_pl_accounts (org_id, status)
  where deleted_at is null;

create index if not exists three_pl_accounts_org_customer_idx
  on public.three_pl_accounts (org_id, customer_id)
  where deleted_at is null;

alter table public.three_pl_accounts enable row level security;

drop policy if exists three_pl_accounts_select on public.three_pl_accounts;
create policy three_pl_accounts_select on public.three_pl_accounts
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists three_pl_accounts_write on public.three_pl_accounts;
create policy three_pl_accounts_write on public.three_pl_accounts
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
-- account_service_definitions: per-account service definitions and rates
-- (the Rate Card overlay). Child of three_pl_accounts, denormalised org_id for
-- Pattern A RLS. vas_id optionally links the spine value_added_services catalog;
-- it never copies it. rate_cents is BIGINT cents.
-- ---------------------------------------------------------------------------

create table if not exists public.account_service_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.three_pl_accounts(id) on delete cascade,
  vas_id uuid references public.value_added_services(id),
  service_kind text not null default 'custom'
    check (service_kind in (
      'copack', 'kit', 'rework', 'inspection', 'labeling', 'storage', 'custom'
    )),
  name text not null,
  rate_cents bigint check (rate_cents is null or rate_cents >= 0),
  rate_uom text,
  currency_code text,
  effective_from timestamptz,
  effective_to timestamptz,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists account_service_definitions_parent_idx
  on public.account_service_definitions (org_id, account_id, position);
create index if not exists account_service_definitions_org_idx
  on public.account_service_definitions (org_id);
create index if not exists account_service_definitions_vas_idx
  on public.account_service_definitions (vas_id)
  where vas_id is not null;

alter table public.account_service_definitions enable row level security;

drop policy if exists account_service_definitions_select on public.account_service_definitions;
create policy account_service_definitions_select on public.account_service_definitions
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists account_service_definitions_write on public.account_service_definitions;
create policy account_service_definitions_write on public.account_service_definitions
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

create or replace function public.trg_three_pl_accounts_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists three_pl_accounts_set_updated_at on public.three_pl_accounts;
create trigger three_pl_accounts_set_updated_at
  before update on public.three_pl_accounts
  for each row execute function public.trg_three_pl_accounts_set_updated_at();

create or replace function public.trg_account_service_definitions_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists account_service_definitions_set_updated_at
  on public.account_service_definitions;
create trigger account_service_definitions_set_updated_at
  before update on public.account_service_definitions
  for each row execute function public.trg_account_service_definitions_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trigger: three_pl_accounts. INSERT / UPDATE / DELETE via the central
-- audit_append_state_change helper. Action verb in to_state.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_three_pl_accounts()
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
      'customer_id', new.customer_id,
      'name', new.name,
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
      'customer_id', old.customer_id,
      'name', old.name,
      'status', old.status
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'three_pl_account',
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

revoke execute on function public.trg_audit_three_pl_accounts() from public, anon;

drop trigger if exists audit_three_pl_accounts on public.three_pl_accounts;
create trigger audit_three_pl_accounts
  after insert or update or delete on public.three_pl_accounts
  for each row execute function public.trg_audit_three_pl_accounts();

-- ---------------------------------------------------------------------------
-- Audit trigger: account_service_definitions. INSERT / UPDATE / DELETE via the
-- central helper with an action verb as to_state.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_account_service_definitions()
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
      'account_id', new.account_id,
      'vas_id', new.vas_id,
      'service_kind', new.service_kind,
      'name', new.name,
      'rate_cents', new.rate_cents,
      'rate_uom', new.rate_uom,
      'currency_code', new.currency_code,
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
      'service_kind', jsonb_build_object('from', old.service_kind, 'to', new.service_kind),
      'name', jsonb_build_object('from', old.name, 'to', new.name),
      'rate_cents', jsonb_build_object('from', old.rate_cents, 'to', new.rate_cents),
      'currency_code', jsonb_build_object('from', old.currency_code, 'to', new.currency_code),
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
      'account_id', old.account_id,
      'service_kind', old.service_kind,
      'name', old.name,
      'rate_cents', old.rate_cents
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'account_service_definition',
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

revoke execute on function public.trg_audit_account_service_definitions() from public, anon;

drop trigger if exists audit_account_service_definitions
  on public.account_service_definitions;
create trigger audit_account_service_definitions
  after insert or update or delete on public.account_service_definitions
  for each row execute function public.trg_audit_account_service_definitions();

-- ---------------------------------------------------------------------------
-- Table comments for operator discoverability.
-- ---------------------------------------------------------------------------

comment on table public.three_pl_accounts is
  '3PL commercial layer: the service-relationship account over a CRM customer (customer_id REQUIRED, never copied). status is an active / inactive flag, not a registered FSM. account_number filled by the numbering chassis (ACC- prefix, 0090). Pattern A RLS via denormalised org_id.';

comment on table public.account_service_definitions is
  'Per-account service definitions and rates (the Rate Card overlay). Child of three_pl_accounts. vas_id optionally links the spine value_added_services catalog. rate_cents is BIGINT cents. Pattern A RLS via denormalised org_id.';
