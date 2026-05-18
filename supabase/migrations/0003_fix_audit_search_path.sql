-- ============================================================================
-- Migration: 0003_fix_audit_search_path.sql
-- Wave: 1
-- Phase: Hotfix
-- Closes: R-W1-FSM-02
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Revert the two functions to their 0002
--   bodies. Not auto-run.
--
-- Bug:
--   The trigger function trg_audit_organizations_status and the verifier
--   verify_audit_chain were authored with `set search_path = public`. The
--   pgcrypto extension lives in the `extensions` schema on Supabase, so
--   the bare digest() call inside both bodies fails with
--   "ERROR: 42883 function digest(text, unknown) does not exist".
--   Surfaced the first time provision_organization tried to transition an
--   organization from provisioning to active (the auto-state-transition
--   trigger fires here).
--
-- Fix:
--   Fully qualify the digest call as extensions.digest. Keeps the explicit
--   search_path narrow so future changes don't accidentally pull in
--   extension-schema functions implicitly.
--
-- Constitutional alignment:
--   Migration rules    Forward-only. No edit of 0002. CREATE OR REPLACE
--                      both function bodies.
--   Audit rules        The trigger remains the single writer for
--                      organizations.status transitions. Chain math is
--                      unchanged; only the digest call site moves.
--                      kitstak_audit_canonical is unchanged so the
--                      canonical-bytes contract holds.
-- ============================================================================

create or replace function public.trg_audit_organizations_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_hash text;
  v_payload   jsonb;
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

  v_lock_key := ('x' || substr(md5(new.id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select payload_hash
    into v_prev_hash
    from public.audit_log
   where org_id = new.id
   order by triggered_at desc, id desc
   limit 1;

  v_payload := jsonb_build_object(
    'org_id',       new.id,
    'entity_type',  'organization',
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
    new.id, 'organization', new.id,
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

revoke execute on function public.trg_audit_organizations_status() from public, anon;

create or replace function public.verify_audit_chain(p_org_id uuid)
returns table (
  broken_id           uuid,
  broken_triggered_at timestamptz,
  expected_hash       text,
  stored_hash         text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r           public.audit_log%rowtype;
  v_prev_hash text := null;
  v_payload   jsonb;
  v_expected  text;
begin
  for r in
    select * from public.audit_log
     where org_id = p_org_id
     order by triggered_at asc, id asc
  loop
    v_payload := jsonb_build_object(
      'org_id',       r.org_id,
      'entity_type',  r.entity_type,
      'entity_id',    r.entity_id,
      'from_state',   r.from_state,
      'to_state',     r.to_state,
      'action',       r.action,
      'triggered_by', r.triggered_by,
      'diff_json',    r.diff_json,
      'prev_hash',    v_prev_hash
    );
    v_expected := encode(
      extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'),
      'hex'
    );

    if r.payload_hash is distinct from v_expected
       or r.prev_hash  is distinct from v_prev_hash then
      broken_id           := r.id;
      broken_triggered_at := r.triggered_at;
      expected_hash       := v_expected;
      stored_hash         := r.payload_hash;
      return next;
      return;
    end if;

    v_prev_hash := r.payload_hash;
  end loop;
  return;
end;
$$;

revoke execute on function public.verify_audit_chain(uuid) from public, anon;
grant execute on function public.verify_audit_chain(uuid) to authenticated, service_role;
