-- ============================================================================
-- Migration: 0010_crm_audit_state_triggers.sql
-- Wave: 2
-- Phase: CRM core (Agent B)
-- Closes: R-W2-CRM-07 (auto-state-transition triggers for leads + opportunities)
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only.
--   drop trigger if exists audit_leads_status on public.leads;
--   drop trigger if exists audit_opportunities_stage on public.opportunities;
--   drop function if exists public.tg_lead_audit_state_change();
--   drop function if exists public.tg_opportunity_audit_stage_change();
--   Not auto-run.
--
-- Constitutional alignment:
--   RLS rules          The triggers are SECURITY DEFINER but write into
--                      audit_log under the row's own org_id. audit_log's
--                      RLS posture (service-role insert only; authenticated
--                      cannot insert) holds because the trigger function is
--                      definer-scoped and re-uses the same chain pattern as
--                      the organizations trigger.
--   Audit rules        Hash chain extended per entity using the same
--                      kitstak_audit_canonical helper and the per-org
--                      advisory lock. extensions.digest is fully qualified
--                      per the 0003 hotfix learning.
--   Migration rules    Forward-only. All DDL idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- tg_lead_audit_state_change: AFTER UPDATE OF status on public.leads.
-- ---------------------------------------------------------------------------

create or replace function public.tg_lead_audit_state_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash    text;
  v_payload      jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key     bigint;
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

  select payload_hash
    into v_prev_hash
    from public.audit_log
   where org_id = new.org_id
   order by triggered_at desc, id desc
   limit 1;

  v_payload := jsonb_build_object(
    'org_id',       new.org_id,
    'entity_type',  'lead',
    'entity_id',    new.id,
    'from_state',   old.status,
    'to_state',     new.status,
    'action',       'status_change',
    'triggered_by', v_triggered_by,
    'diff_json',    jsonb_build_object(
                       'status', jsonb_build_object(
                         'from', old.status,
                         'to',   new.status
                       )
                    ),
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
    new.org_id, 'lead', new.id,
    old.status, new.status, 'status_change',
    v_triggered_by,
    jsonb_build_object(
      'status', jsonb_build_object('from', old.status, 'to', new.status)
    ),
    v_prev_hash, v_payload_hash
  );

  return new;
end;
$$;

revoke execute on function public.tg_lead_audit_state_change() from public, anon;

drop trigger if exists audit_leads_status on public.leads;
create trigger audit_leads_status
  after update of status on public.leads
  for each row execute function public.tg_lead_audit_state_change();

-- ---------------------------------------------------------------------------
-- tg_opportunity_audit_stage_change: AFTER UPDATE OF stage on opportunities.
-- ---------------------------------------------------------------------------

create or replace function public.tg_opportunity_audit_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash    text;
  v_payload      jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key     bigint;
begin
  if new.stage is null or new.stage = old.stage then
    return new;
  end if;

  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by);
  exception when others then
    v_triggered_by := new.updated_by;
  end;

  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select payload_hash
    into v_prev_hash
    from public.audit_log
   where org_id = new.org_id
   order by triggered_at desc, id desc
   limit 1;

  v_payload := jsonb_build_object(
    'org_id',       new.org_id,
    'entity_type',  'opportunity',
    'entity_id',    new.id,
    'from_state',   old.stage,
    'to_state',     new.stage,
    'action',       'stage_change',
    'triggered_by', v_triggered_by,
    'diff_json',    jsonb_build_object(
                       'stage', jsonb_build_object(
                         'from', old.stage,
                         'to',   new.stage
                       ),
                       'close_reason', new.close_reason
                    ),
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
    prev_hash, payload_hash, notes
  ) values (
    new.org_id, 'opportunity', new.id,
    old.stage, new.stage, 'stage_change',
    v_triggered_by,
    jsonb_build_object(
      'stage', jsonb_build_object('from', old.stage, 'to', new.stage),
      'close_reason', new.close_reason
    ),
    v_prev_hash, v_payload_hash, new.close_reason
  );

  return new;
end;
$$;

revoke execute on function public.tg_opportunity_audit_stage_change()
  from public, anon;

drop trigger if exists audit_opportunities_stage on public.opportunities;
create trigger audit_opportunities_stage
  after update of stage on public.opportunities
  for each row execute function public.tg_opportunity_audit_stage_change();
