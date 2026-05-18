-- ============================================================================
-- Migration: 0017_sales_audit_recompute_triggers.sql
-- Wave: 2
-- Phase: Sales chassis (audit triggers, state-timestamp stamping, quote
--        totals recompute, requires_approval flag RPC)
-- Closes: R-W2-AUDIT-QUOTES-01, R-W2-AUDIT-PROJECTS-01,
--         R-W2-AUDIT-PROJECT-PHASES-01, R-W2-RECOMPUTE-QUOTE-TOTALS-01
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop triggers, then trigger functions.
--   Not auto-run.
--
-- Constitutional alignment:
--   Workflow rules     Auto-state-transition triggers stamp <state>_at and
--                      write an audit_log row on every state change. No
--                      best-effort handler writes.
--   Audit rules        Hash chain extended by re-using the canonical
--                      kitstak_audit_canonical fn from 0002. Per-org advisory
--                      lock keyed on org_id serialises writers.
--   Money rules        recompute_quote_totals re-derives subtotal_cents,
--                      discount_cents, tax_cents, total_cents from line items
--                      using BIGINT arithmetic. No floats.
--   Migration rules    Forward-only. All DDL idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Shared audit append helper: takes entity_type, org_id, entity_id, from, to,
-- action, actor, diff. Chains the per-org payload_hash forward.
-- ---------------------------------------------------------------------------

create or replace function public.audit_append_state_change(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_from text,
  p_to text,
  p_action text,
  p_actor uuid,
  p_diff jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_lock_key bigint;
begin
  v_lock_key := ('x' || substr(md5(p_org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select payload_hash
    into v_prev_hash
    from public.audit_log
   where org_id = p_org_id
   order by triggered_at desc, id desc
   limit 1;

  v_payload := jsonb_build_object(
    'org_id',       p_org_id,
    'entity_type',  p_entity_type,
    'entity_id',    p_entity_id,
    'from_state',   p_from,
    'to_state',     p_to,
    'action',       p_action,
    'triggered_by', p_actor,
    'diff_json',    p_diff,
    'prev_hash',    v_prev_hash
  );

  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'),
    'hex'
  );

  insert into public.audit_log (
    org_id, entity_type, entity_id,
    from_state, to_state, action,
    triggered_by, diff_json,
    prev_hash, payload_hash
  ) values (
    p_org_id, p_entity_type, p_entity_id,
    p_from, p_to, p_action,
    p_actor, p_diff,
    v_prev_hash, v_payload_hash
  );
end;
$$;

revoke execute on function public.audit_append_state_change(
  uuid, text, uuid, text, text, text, uuid, jsonb
) from public, anon;
grant execute on function public.audit_append_state_change(
  uuid, text, uuid, text, text, text, uuid, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- Quote state-change trigger: stamps the paired timestamp, writes audit row,
-- snapshots a quote_version on submitted and approved transitions.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_quotes_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  if new.state is null or new.state = old.state then
    return new;
  end if;

  begin
    v_actor := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_actor := new.updated_by;
  end;

  -- Stamp the paired timestamp column.
  case new.state
    when 'submitted' then new.submitted_at := now();
    when 'revise_requested' then new.revise_requested_at := now();
    when 'approved' then new.approved_at := now();
    when 'project_pending' then new.project_pending_at := now();
    when 'cancelled' then new.cancelled_at := now();
    else null;
  end case;

  perform public.audit_append_state_change(
    new.org_id,
    'quote',
    new.id,
    old.state,
    new.state,
    'state_change',
    v_actor,
    jsonb_build_object(
      'state', jsonb_build_object('from', old.state, 'to', new.state),
      'total_cents', new.total_cents
    )
  );

  -- Snapshot a version on the meaningful transitions.
  if new.state in ('submitted', 'approved') then
    perform public.snapshot_quote_version(new.id, new.state, v_actor);
  end if;

  return new;
end;
$$;

revoke execute on function public.trg_audit_quotes_state() from public, anon;

drop trigger if exists audit_quotes_state on public.quotes;
create trigger audit_quotes_state
  before update of state on public.quotes
  for each row execute function public.trg_audit_quotes_state();

-- ---------------------------------------------------------------------------
-- Project state-change trigger: stamps paired timestamp, writes audit.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_projects_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  if new.state is null or new.state = old.state then
    return new;
  end if;

  begin
    v_actor := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_actor := new.updated_by;
  end;

  case new.state
    when 'pending' then new.pending_at := now();
    when 'ready_to_build' then new.ready_to_build_at := now();
    when 'in_production' then new.in_production_at := now();
    when 'ready_to_ship' then new.ready_to_ship_at := now();
    when 'completed' then new.completed_at := now();
    when 'cancelled' then new.cancelled_at := now();
    else null;
  end case;

  perform public.audit_append_state_change(
    new.org_id,
    'project',
    new.id,
    old.state,
    new.state,
    'state_change',
    v_actor,
    jsonb_build_object(
      'state', jsonb_build_object('from', old.state, 'to', new.state)
    )
  );

  return new;
end;
$$;

revoke execute on function public.trg_audit_projects_state() from public, anon;

drop trigger if exists audit_projects_state on public.projects;
create trigger audit_projects_state
  before update of state on public.projects
  for each row execute function public.trg_audit_projects_state();

-- Stamp pending_at on insert for new projects (initial state).
create or replace function public.trg_stamp_project_initial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pending_at is null and new.state = 'pending' then
    new.pending_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_project_initial on public.projects;
create trigger stamp_project_initial
  before insert on public.projects
  for each row execute function public.trg_stamp_project_initial();

-- ---------------------------------------------------------------------------
-- Project phase state-change trigger: stamps timestamp, writes audit using
-- the parent project's org_id.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_project_phases_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
begin
  if new.state is null or new.state = old.state then
    return new;
  end if;

  begin
    v_actor := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_actor := new.updated_by;
  end;

  select org_id into v_org_id
    from public.projects where id = new.project_id;
  if v_org_id is null then
    return new;
  end if;

  case new.state
    when 'pending' then new.pending_at := now();
    when 'active' then new.active_at := now();
    when 'completed' then new.completed_at := now();
    when 'cancelled' then new.cancelled_at := now();
    else null;
  end case;

  perform public.audit_append_state_change(
    v_org_id,
    'project_phase',
    new.id,
    old.state,
    new.state,
    'state_change',
    v_actor,
    jsonb_build_object(
      'project_id', new.project_id,
      'state', jsonb_build_object('from', old.state, 'to', new.state)
    )
  );

  return new;
end;
$$;

revoke execute on function public.trg_audit_project_phases_state()
  from public, anon;

drop trigger if exists audit_project_phases_state on public.project_phases;
create trigger audit_project_phases_state
  before update of state on public.project_phases
  for each row execute function public.trg_audit_project_phases_state();

-- ---------------------------------------------------------------------------
-- recompute_quote_totals: re-derives subtotal_cents, discount_cents,
-- tax_cents, total_cents from current quote_line_items. Pure BIGINT.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_quote_totals(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal bigint;
  v_discount bigint;
  v_tax bigint;
  v_total bigint;
begin
  select
    coalesce(sum(line_subtotal_cents), 0),
    coalesce(sum(line_discount_cents), 0),
    coalesce(sum(line_tax_cents), 0),
    coalesce(sum(line_total_cents), 0)
  into v_subtotal, v_discount, v_tax, v_total
  from public.quote_line_items
  where quote_id = p_quote_id;

  update public.quotes
     set subtotal_cents = v_subtotal,
         discount_cents = v_discount,
         tax_cents = v_tax,
         total_cents = v_total,
         updated_at = now()
   where id = p_quote_id;
end;
$$;

revoke execute on function public.recompute_quote_totals(uuid) from public, anon;
grant execute on function public.recompute_quote_totals(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- set_quote_requires_approval: toggle the flag with a single owner/admin RPC.
-- ---------------------------------------------------------------------------

create or replace function public.set_quote_requires_approval(
  p_quote_id uuid,
  p_value boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id
    from public.quotes where id = p_quote_id;
  if v_org_id is null then
    raise exception 'NOT_FOUND: quote not found' using errcode = 'P0001';
  end if;
  if v_org_id <> public.current_org_id() then
    raise exception 'FORBIDDEN: cross-tenant requires_approval flip'
      using errcode = '42501';
  end if;

  update public.quotes
     set requires_approval = p_value,
         updated_at = now()
   where id = p_quote_id;
end;
$$;

revoke execute on function public.set_quote_requires_approval(uuid, boolean)
  from public, anon;
grant execute on function public.set_quote_requires_approval(uuid, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Stamp pending_at on insert for new project_phases.
-- ---------------------------------------------------------------------------

create or replace function public.trg_stamp_project_phase_initial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pending_at is null and new.state = 'pending' then
    new.pending_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_project_phase_initial on public.project_phases;
create trigger stamp_project_phase_initial
  before insert on public.project_phases
  for each row execute function public.trg_stamp_project_phase_initial();

-- ---------------------------------------------------------------------------
-- Stamp pending_at on insert for new quotes (the only initial state).
-- ---------------------------------------------------------------------------

-- Quotes have no `pending_at` column; their initial state is `draft` which
-- has no paired timestamp. Created_at is the canonical "when did this quote
-- come into existence" value.
