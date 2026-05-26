-- ============================================================================
-- Migration: 0067_org_membership_audit.sql
-- Wave: 9
-- Phase: Staff invite chassis (post-ship gap close)
-- Closes: F-Wave9-STAFF-INVITE-AUDIT-01. The staff invite chassis shipped in
--         0065 inserts org_memberships rows via create_staff_membership RPC
--         but the audit_log.entity_type CHECK constraint (last extended in
--         0036) does not include 'org_membership'. No audit row fires today
--         for staff invites, leaving the identity layer outside the audit
--         coverage promised by the constitution. This migration extends the
--         enum and adds an AFTER INSERT trigger so every membership birth
--         lands in the per-org hash chain.
-- Date: 2026-05-27
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   drop trigger if exists audit_org_memberships_created on public.org_memberships;
--   drop function if exists public.trg_org_memberships_created_audit();
--   -- Reverting the entity_type CHECK requires a forward migration that drops
--   -- and recreates the constraint without 'org_membership', which would
--   -- orphan every audit_log row written by this trigger. Backfilled rows
--   -- stay in place (forward-only data; hash chain entries are intentional
--   -- history). The constitutional path is to leave both in place.
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column read or written.
--   RLS rules          Trigger function is SECURITY DEFINER, per-org advisory
--                      lock keyed off new.org_id, hash chain via prev_hash
--                      scoped to the same org. RLS on audit_log is unaffected
--                      because the function writes via table-owner identity,
--                      mirroring 0061:81-130 exactly. No cross-tenant read
--                      surface introduced.
--   Audit rules        This IS the audit-rule expansion for the identity
--                      layer. org_memberships is a relationship row; the
--                      INSERT event (null -> active) is treated as a state
--                      event for audit purposes, mirroring the pattern from
--                      0061 for manufacturing_runs. action='invited',
--                      from_state=null, to_state=new.is_active::text so the
--                      audit row is queryable by the same lifecycle shape as
--                      every other entity. Hash chain reuses
--                      kitstak_audit_canonical, matching every other audit
--                      trigger across the codebase. audit_log INSERTs are
--                      service-role-only via existing RLS (deny INSERT for
--                      authenticated); the SECURITY DEFINER trigger writes
--                      via table-owner identity which bypasses RLS by design.
--   Migration rules    Forward-only. Idempotent (DROP CONSTRAINT IF EXISTS
--                      before CREATE; CREATE OR REPLACE FUNCTION; DROP
--                      TRIGGER IF EXISTS before CREATE TRIGGER). The
--                      backfill DO-block uses NOT EXISTS so re-running is a
--                      no-op once every historical row carries an 'invited'
--                      audit entry.
--   State machine      org_memberships is a relationship table; no formal
--                      state machine. The 'invited' audit row is the
--                      identity equivalent of a 'created' lifecycle event,
--                      not a status transition.
--
-- Background:
--   The 0065_staff_invite_function header explicitly defers audit coverage
--   ("Audit at the identity layer can be added later"). This migration is
--   the deferred close. The auth-api postInviteStaffMember handler is
--   unchanged: the trigger fires inside the same transaction that the
--   create_staff_membership RPC opens, so no handler edit is required.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Extend audit_log_entity_type_check to allow 'org_membership'.
--    Mirrors the 0036 pattern exactly: drop the constraint if present, then
--    re-add with the full enumeration. The full enumeration here equals the
--    0036 list plus the entity_types added by subsequent migrations
--    (manufacturing_run, project_line_item) plus 'org_membership'.
--    Forward-only: if a later migration adds another entity_type it must
--    likewise rewrite the full enumeration in a new forward migration.
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
    -- Sales / CRM (Agent B)
    'customer',
    'contact',
    'activity',
    'lead',
    'opportunity',
    -- Catalog (cross-domain)
    'item',
    -- Sales chassis (Agent C)
    'quote',
    'quote_line_item',
    'project',
    'project_phase',
    'project_line_item',
    -- Billing / GL (Agent D)
    'invoice',
    'invoice_line_item',
    'payment',
    'credit_note',
    'journal_entry',
    'period_close',
    -- Procurement / Ops (Agent E)
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
    -- Cross-cutting collab (Agent F)
    'attachment',
    'comment',
    'notification',
    -- Pillar 2 Manufacturing (extended in 0052)
    'manufacturing_run',
    'manufacturing_run_consumed_line_item',
    'manufacturing_run_produced_line_item'
  ));

comment on constraint audit_log_entity_type_check on public.audit_log is
  'Enumerates every entity_type allowed in audit_log. Update via forward migration when a new state machine or audited entity ships.';

-- ---------------------------------------------------------------------------
-- 2) trg_org_memberships_created_audit — fires AFTER INSERT on
--    public.org_memberships. Writes one audit_log row with from_state=null,
--    to_state='active' (or 'inactive' if is_active=false at insert time),
--    action='invited'. The advisory lock + prev_hash lookup + payload hash
--    mirrors 0061:81-130 exactly.
-- ---------------------------------------------------------------------------

create or replace function public.trg_org_memberships_created_audit()
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
  v_to_state text;
  v_metadata jsonb;
begin
  begin
    v_triggered_by := coalesce(auth.uid(), new.created_by);
  exception when others then
    v_triggered_by := new.created_by;
  end;
  v_to_state := case when new.is_active then 'active' else 'inactive' end;
  v_metadata := jsonb_build_object(
    'user_id', new.user_id,
    'role_id', new.role_id
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
    'from_state', null,
    'to_state', v_to_state,
    'action', 'invited',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object(
      'is_active', jsonb_build_object('from', null, 'to', new.is_active)
    ),
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
    new.org_id, 'org_membership', new.id, null, v_to_state, 'invited',
    v_triggered_by,
    jsonb_build_object(
      'is_active', jsonb_build_object('from', null, 'to', new.is_active)
    ),
    v_metadata,
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

revoke execute on function public.trg_org_memberships_created_audit() from public, anon;

comment on function public.trg_org_memberships_created_audit() is
  'Emits an audit_log row with action=invited, from_state=null, to_state=is_active::text when an org_memberships row is inserted. Carries user_id + role_id in metadata so the actor + grant are queryable from the audit row alone. SECURITY DEFINER; per-org advisory lock; hash chain via prev_hash. Fires inside the same transaction that create_staff_membership (0065) opens.';

drop trigger if exists audit_org_memberships_created on public.org_memberships;
create trigger audit_org_memberships_created
  after insert on public.org_memberships
  for each row execute function public.trg_org_memberships_created_audit();

-- ---------------------------------------------------------------------------
-- 3) Backfill historical org_memberships rows that do NOT carry an
--    'invited' audit entry. Mirrors the 0061 backfill shape exactly:
--    iterate by created_at ascending so per-org hash chain entries are
--    appended in chronological order. NOT EXISTS guard makes the backfill a
--    no-op on re-run.
--
--    The advisory lock and prev_hash lookup inside the inline INSERT block
--    mirror the trigger body so the backfill rows are indistinguishable
--    from a forward-emitted 'invited' row except for the triggered_at
--    timestamp (which is now() — the system correcting the record, not the
--    original insert moment).
-- ---------------------------------------------------------------------------

do $$
declare
  v_row record;
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
  v_to_state text;
  v_metadata jsonb;
begin
  for v_row in
    select id, org_id, user_id, role_id, is_active, created_by, created_at
      from public.org_memberships
     where not exists (
       select 1
         from public.audit_log
        where entity_id = org_memberships.id
          and entity_type = 'org_membership'
          and action = 'invited'
     )
     order by created_at
  loop
    v_triggered_by := v_row.created_by;
    v_to_state := case when v_row.is_active then 'active' else 'inactive' end;
    v_metadata := jsonb_build_object(
      'user_id', v_row.user_id,
      'role_id', v_row.role_id
    );
    v_lock_key := ('x' || substr(md5(v_row.org_id::text), 1, 16))::bit(64)::bigint;
    perform pg_advisory_xact_lock(v_lock_key);
    select payload_hash into v_prev_hash
      from public.audit_log
     where org_id = v_row.org_id
     order by triggered_at desc, id desc limit 1;
    v_payload := jsonb_build_object(
      'org_id', v_row.org_id,
      'entity_type', 'org_membership',
      'entity_id', v_row.id,
      'from_state', null,
      'to_state', v_to_state,
      'action', 'invited',
      'triggered_by', v_triggered_by,
      'diff_json', jsonb_build_object(
        'is_active', jsonb_build_object('from', null, 'to', v_row.is_active)
      ),
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
      v_row.org_id, 'org_membership', v_row.id, null, v_to_state, 'invited',
      v_triggered_by,
      jsonb_build_object(
        'is_active', jsonb_build_object('from', null, 'to', v_row.is_active)
      ),
      v_metadata,
      v_prev_hash, v_payload_hash
    );
  end loop;
end$$;
