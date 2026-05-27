-- ============================================================================
-- Migration: 0068_org_membership_update_audit.sql
-- Wave: 9
-- Phase: Staff invite chassis (per-row patch + resend close)
-- Closes: F-Wave9-STAFF-INVITE-PATCH-01 audit coverage. The PATCH handler in
--         auth-api updates org_memberships rows (role change, deactivate,
--         reactivate). Migration 0067 wires an AFTER INSERT audit trigger
--         only, so UPDATE-style edits land outside the per-org hash chain.
--         This migration adds a second trigger AFTER UPDATE on
--         org_memberships that emits one audit_log row per change with
--         action='updated', from_state and to_state set to the is_active
--         transition (or both equal when only role changed), and metadata
--         carrying user_id, role_id, and the prior role_id so the audit
--         reader can see the role transition without back-joining to
--         org_memberships.
-- Date: 2026-05-27
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   drop trigger if exists audit_org_memberships_updated on public.org_memberships;
--   drop function if exists public.trg_org_memberships_updated_audit();
--   -- Existing audit_log rows written by this trigger stay in place
--   -- (forward-only data; the hash chain entries are intentional history).
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column read or written.
--   RLS rules          New trigger function is SECURITY DEFINER, per-org
--                      advisory lock keyed off new.org_id, hash chain via
--                      prev_hash scoped to the same org. RLS on audit_log
--                      is unaffected because the function writes via
--                      table-owner identity, mirroring 0061 and 0067 exactly.
--                      No cross-tenant read surface introduced.
--   Audit rules        Extends the identity-layer audit coverage opened by
--                      0067. action='updated' is the verb chosen to match
--                      the 'invited' verb 0067 uses; the pair matches the
--                      established 'created'/'transitioned' vocabulary used
--                      across business entities. Hash chain reuses
--                      kitstak_audit_canonical exactly as 0067 does. Trigger
--                      skips emission when neither role_id nor is_active
--                      changed so a no-op UPDATE (only updated_by /
--                      updated_at) does not pollute the audit chain.
--   Migration rules    Forward-only. Idempotent (CREATE OR REPLACE FUNCTION;
--                      DROP TRIGGER IF EXISTS before CREATE TRIGGER). No
--                      backfill: historical UPDATEs predating this trigger
--                      are not recoverable (Postgres has no UPDATE history
--                      log) and the constitutional posture is to start the
--                      chain at trigger-attach time.
--   State machine      org_memberships has no formal status column with a
--                      transitions table, but is_active functions as a
--                      binary state for audit purposes. from_state and
--                      to_state are derived from old.is_active and
--                      new.is_active so the audit row remains queryable
--                      with the same shape every other audited entity uses.
--
-- Background:
--   0067 was scoped to INSERT-only (the staff invite chassis only inserted
--   org_memberships). PATCH coverage was deferred until the per-row admin
--   surface shipped. This migration is that deferred close, landing in the
--   same PR as the PATCH handler so the trigger and the handler ship
--   atomically.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) trg_org_memberships_updated_audit. Fires AFTER UPDATE on
--    public.org_memberships. Mirrors the 0067 trigger body but reads
--    old.is_active for from_state and emits diff_json with both old and new
--    role_id + is_active so the audit reader sees the full transition. Skips
--    emission when neither role_id nor is_active changed (a touch-only
--    UPDATE that bumps updated_at / updated_by is not auditable).
-- ---------------------------------------------------------------------------

create or replace function public.trg_org_memberships_updated_audit()
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
  v_from_state text;
  v_to_state text;
  v_metadata jsonb;
  v_diff jsonb;
  v_changed boolean;
begin
  v_changed := (new.is_active is distinct from old.is_active)
            or (new.role_id   is distinct from old.role_id);
  if not v_changed then
    return new;
  end if;
  begin
    v_triggered_by := coalesce(auth.uid(), new.updated_by, new.created_by);
  exception when others then
    v_triggered_by := coalesce(new.updated_by, new.created_by);
  end;
  v_from_state := case when old.is_active then 'active' else 'inactive' end;
  v_to_state   := case when new.is_active then 'active' else 'inactive' end;
  v_metadata := jsonb_build_object(
    'user_id',     new.user_id,
    'role_id',     new.role_id,
    'old_role_id', old.role_id
  );
  v_diff := jsonb_build_object(
    'is_active', jsonb_build_object('from', old.is_active, 'to', new.is_active),
    'role_id',   jsonb_build_object('from', old.role_id,   'to', new.role_id)
  );
  v_lock_key := ('x' || substr(md5(new.org_id::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);
  select payload_hash into v_prev_hash
    from public.audit_log
   where org_id = new.org_id
   order by triggered_at desc, id desc limit 1;
  v_payload := jsonb_build_object(
    'org_id', new.org_id,
    'entity_type', 'org_membership',
    'entity_id', new.id,
    'from_state', v_from_state,
    'to_state', v_to_state,
    'action', 'updated',
    'triggered_by', v_triggered_by,
    'diff_json', v_diff,
    'metadata', v_metadata,
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, metadata, prev_hash, payload_hash
  ) values (
    new.org_id, 'org_membership', new.id, v_from_state, v_to_state, 'updated',
    v_triggered_by, v_diff, v_metadata,
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

revoke execute on function public.trg_org_memberships_updated_audit() from public, anon;

comment on function public.trg_org_memberships_updated_audit() is
  'Emits an audit_log row with action=updated, from_state=old.is_active::text, to_state=new.is_active::text when an org_memberships row is updated. Carries user_id, role_id, and old_role_id in metadata so role transitions are queryable without back-joining. SECURITY DEFINER; per-org advisory lock; hash chain via prev_hash. Skips emission when neither role_id nor is_active changed.';

drop trigger if exists audit_org_memberships_updated on public.org_memberships;
create trigger audit_org_memberships_updated
  after update on public.org_memberships
  for each row execute function public.trg_org_memberships_updated_audit();
