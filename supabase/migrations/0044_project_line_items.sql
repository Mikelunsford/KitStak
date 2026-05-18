-- ============================================================================
-- Migration: 0044_project_line_items.sql
-- Wave: 6
-- Phase: 6.5 (workflow integration remediation)
-- Closes: G-CONVERT-01 (convert_quote_to_project does not copy line items)
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop in reverse: convert_quote_to_project
--   (restoring the 0041 4-arg form without line-item copy), the audit and
--   stamp triggers, then the project_line_items table. Not auto-run.
--
-- Constitutional alignment:
--   Money rules        unit_price_cents stored as BIGINT cents with the
--                      _cents suffix. discount_percent uses numeric for
--                      operator-facing percent display; the math layer
--                      computes cents totals with banker's rounding when
--                      project totals are needed (recompute lives elsewhere).
--                      No floats for monetary storage.
--   RLS rules          Pattern A on project_line_items (org_id check plus
--                      role check) so the table follows the same shape as
--                      projects rather than parent-join Pattern B. The
--                      project_id is denormalized into the line for cheap
--                      filtering, with a redundant org_id alongside it so
--                      RLS evaluates without a parent lookup. ON DELETE
--                      CASCADE on project_id keeps lines and parent in sync.
--                      Cross-tenant reads return 200 + []; cross-tenant
--                      conversions (carryover RPC) preserve 404 NOT_FOUND.
--   Audit rules        Auto-state-transition trigger on every INSERT /
--                      UPDATE / DELETE writes an audit_log row via the
--                      existing audit_append_state_change helper (0017).
--                      entity_type 'project_line_item' is added to the
--                      audit_log CHECK constraint here.
--   Migration rules    Forward-only. All DDL idempotent (CREATE TABLE IF
--                      NOT EXISTS, do-block exception handlers on FK adds,
--                      CREATE OR REPLACE FUNCTION on the RPC). The RPC
--                      signature is unchanged from 0041 so the resolution
--                      target stays the same and the handler in
--                      quotes-api/index.ts does not need to update its
--                      rpc() call.
--
-- Side-car canon coordination:
--   _shared/types/sales.ts + apps/web/src/lib/types/sales.ts add
--   ProjectLineItemSchema, CreateProjectLineItemRequestSchema, and
--   UpdateProjectLineItemRequestSchema as the zod contract for this table.
--   _shared/capabilities/sales.ts + apps/web/src/lib/capabilities/sales.ts
--   add project.line_item.{create,read,update,delete} capabilities for the
--   per-bundle requireSalesCap shim.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend audit_log entity_type to include project_line_item.
-- The 0036 CHECK enumerates every entity that can write to audit_log; adding
-- a new auto-state-transition trigger means we must extend the enum first
-- via a forward migration (drop the old constraint, add the new one with
-- the extra value).
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
    'notification'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Extended in 0044 to add project_line_item.';

-- ---------------------------------------------------------------------------
-- project_line_items: normalized line items on a project. Carryover target
-- for convert_quote_to_project. source_quote_line_item_id preserves the
-- provenance link back to the source quote line for audit / breadcrumb UI.
-- ---------------------------------------------------------------------------

create table if not exists public.project_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  source_quote_line_item_id uuid references public.quote_line_items(id) on delete set null,
  name text not null,
  description text,
  quantity numeric(18, 4) not null default 0 check (quantity >= 0),
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  tax_rate_id uuid references public.taxes(id) on delete set null,
  discount_percent numeric(7, 4) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists project_line_items_project_idx
  on public.project_line_items (project_id, position);
create index if not exists project_line_items_org_idx
  on public.project_line_items (org_id);
create index if not exists project_line_items_source_quote_line_idx
  on public.project_line_items (source_quote_line_item_id);

alter table public.project_line_items enable row level security;

drop policy if exists project_line_items_select on public.project_line_items;
create policy project_line_items_select on public.project_line_items
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists project_line_items_write on public.project_line_items;
create policy project_line_items_write on public.project_line_items
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in
        ('org_owner', 'org_admin', 'sales', 'ops', 'accounting')
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in
        ('org_owner', 'org_admin', 'sales', 'ops', 'accounting')
  );

-- ---------------------------------------------------------------------------
-- updated_at stamping trigger. Plain BEFORE UPDATE; no audit.
-- ---------------------------------------------------------------------------

create or replace function public.trg_project_line_items_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists project_line_items_set_updated_at on public.project_line_items;
create trigger project_line_items_set_updated_at
  before update on public.project_line_items
  for each row execute function public.trg_project_line_items_set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-state-transition / audit trigger. Writes an audit_log row on every
-- INSERT / UPDATE / DELETE via the existing audit_append_state_change helper
-- from 0017. Per the constitution this is the single writer; no handler
-- best-effort writes are permitted.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_project_line_items()
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
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    v_org_id := new.org_id;
    v_entity_id := new.id;
    v_action := 'insert';
    begin
      v_actor := coalesce(auth.uid(), new.created_by);
    exception when others then
      v_actor := new.created_by;
    end;
    v_diff := jsonb_build_object(
      'project_id', new.project_id,
      'item_id', new.item_id,
      'source_quote_line_item_id', new.source_quote_line_item_id,
      'name', new.name,
      'quantity', new.quantity,
      'unit_price_cents', new.unit_price_cents,
      'position', new.position
    );
  elsif tg_op = 'UPDATE' then
    v_org_id := new.org_id;
    v_entity_id := new.id;
    v_action := 'update';
    begin
      v_actor := coalesce(auth.uid(), new.updated_by);
    exception when others then
      v_actor := new.updated_by;
    end;
    v_diff := jsonb_build_object(
      'project_id', new.project_id,
      'name', jsonb_build_object('from', old.name, 'to', new.name),
      'quantity', jsonb_build_object('from', old.quantity, 'to', new.quantity),
      'unit_price_cents', jsonb_build_object(
        'from', old.unit_price_cents, 'to', new.unit_price_cents),
      'discount_percent', jsonb_build_object(
        'from', old.discount_percent, 'to', new.discount_percent),
      'position', jsonb_build_object('from', old.position, 'to', new.position)
    );
  else -- DELETE
    v_org_id := old.org_id;
    v_entity_id := old.id;
    v_action := 'delete';
    begin
      v_actor := coalesce(auth.uid(), old.updated_by);
    exception when others then
      v_actor := old.updated_by;
    end;
    v_diff := jsonb_build_object(
      'project_id', old.project_id,
      'name', old.name,
      'quantity', old.quantity,
      'unit_price_cents', old.unit_price_cents
    );
  end if;

  perform public.audit_append_state_change(
    v_org_id,
    'project_line_item',
    v_entity_id,
    null,
    null,
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

revoke execute on function public.trg_audit_project_line_items() from public, anon;

drop trigger if exists audit_project_line_items on public.project_line_items;
create trigger audit_project_line_items
  after insert or update or delete on public.project_line_items
  for each row execute function public.trg_audit_project_line_items();

-- ---------------------------------------------------------------------------
-- Redefine convert_quote_to_project to copy quote_line_items into
-- project_line_items as part of the same SECURITY DEFINER transaction.
--
-- Signature preserved from 0041 (uuid, uuid, uuid, text) so the existing
-- quotes-api handler's rpc() call does not need to change. Idempotency:
-- on second call for the same quote (state already project_pending), the
-- early return short-circuits before any insert. For the first successful
-- conversion, the INSERT ... SELECT into project_line_items uses ON CONFLICT
-- DO NOTHING keyed on (project_id, source_quote_line_item_id) so a partial
-- retry inside an outer transaction cannot duplicate rows.
--
-- The unique key required for ON CONFLICT is created below as a partial
-- unique index (source_quote_line_item_id is nullable for hand-entered
-- lines; we only enforce uniqueness when both are present).
-- ---------------------------------------------------------------------------

create unique index if not exists project_line_items_carryover_uniq
  on public.project_line_items (project_id, source_quote_line_item_id)
  where source_quote_line_item_id is not null;

create or replace function public.convert_quote_to_project(
  p_quote_id uuid,
  p_actor uuid,
  p_caller_org_id uuid,
  p_project_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_state text;
  v_existing uuid;
  v_project_id uuid;
  v_customer_id uuid;
  v_currency text;
  v_name text;
  v_number text;
begin
  select org_id, state, converted_to_project_id, customer_id,
         currency_code, coalesce(title, 'Quote ' || number)
    into v_org_id, v_state, v_existing, v_customer_id, v_currency, v_name
    from public.quotes
   where id = p_quote_id;

  -- Cross-tenant or missing quote: surface as NOT_FOUND so the caller
  -- cannot distinguish. Constitutional 404, never 403 / 409.
  if v_org_id is null or v_org_id <> p_caller_org_id then
    raise exception 'NOT_FOUND: quote not found' using errcode = 'P0001';
  end if;

  if v_state = 'project_pending' and v_existing is not null then
    return v_existing;
  end if;

  if v_state <> 'approved' then
    raise exception 'STATE_CONFLICT: quote not in approved state (was %)', v_state
      using errcode = 'P0001';
  end if;

  v_number := coalesce(p_project_number,
    'PRJ-' || to_char(now(), 'YYYYMMDD') || '-' ||
    substr(replace(p_quote_id::text, '-', ''), 1, 8));

  insert into public.projects (
    org_id, number, name, customer_id, source_quote_id,
    state, currency_code,
    created_by, updated_by
  ) values (
    v_org_id, v_number, v_name, v_customer_id, p_quote_id,
    'pending', v_currency,
    p_actor, p_actor
  )
  returning id into v_project_id;

  -- Carryover: copy every quote_line_item to project_line_items. The
  -- discount_bps -> discount_percent translation divides by 100 (bps is
  -- basis points; percent is hundredths). unit_price_cents and quantity
  -- carry over byte-for-byte (quantity_e3 -> numeric quantity by /1000).
  -- ON CONFLICT DO NOTHING guards against partial-retry duplicates.
  insert into public.project_line_items (
    org_id, project_id, item_id, source_quote_line_item_id,
    name, description, quantity, unit_price_cents,
    tax_rate_id, discount_percent, position,
    created_by, updated_by
  )
  select
    v_org_id,
    v_project_id,
    qli.item_id,
    qli.id,
    qli.name,
    qli.description,
    (qli.quantity_e3::numeric / 1000.0),
    qli.unit_price_cents,
    qli.tax_id,
    (qli.discount_bps::numeric / 100.0),
    qli.position,
    p_actor,
    p_actor
  from public.quote_line_items qli
  where qli.quote_id = p_quote_id
  on conflict (project_id, source_quote_line_item_id)
    where source_quote_line_item_id is not null
    do nothing;

  update public.quotes
     set state = 'project_pending',
         converted_to_project_id = v_project_id,
         updated_at = now(),
         updated_by = p_actor
   where id = p_quote_id;

  return v_project_id;
end;
$$;

revoke execute on function public.convert_quote_to_project(uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.convert_quote_to_project(uuid, uuid, uuid, text)
  to authenticated, service_role;

comment on function public.convert_quote_to_project(uuid, uuid, uuid, text) is
  'Redefined in 0044 to copy quote_line_items into project_line_items at conversion. Preserves the 0041 4-arg cross-tenant guard.';
