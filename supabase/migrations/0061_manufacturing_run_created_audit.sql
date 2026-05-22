-- ============================================================================
-- Migration: 0061_manufacturing_run_created_audit.sql
-- Wave: 9
-- Phase: E2E smoke test follow-ups (B10 — deferred from 2026-05-21 smoke walk)
-- Closes: F-Wave9-MFG-CREATED-AUDIT-01 (B10 from 2026-05-21 E2E smoke).
--         Operator's smoke walk created MFG-2026-00002 in 'draft' state and
--         the History panel rendered "No history yet" because the existing
--         audit trigger from 0052 fires AFTER UPDATE OF status only.
-- Date: 2026-05-22
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   drop trigger if exists audit_manufacturing_runs_created on public.manufacturing_runs;
--   drop function if exists public.trg_audit_manufacturing_runs_created();
--   -- Backfilled 'created' audit rows stay in place (forward-only data; the
--   -- hash chain entries are intentional history). To physically remove them
--   -- the operator must delete by entity_id under SECURITY DEFINER, which
--   -- breaks the chain and is intentionally not scripted here.
--
-- Constitutional alignment:
--   Money rules        Untouched. No money columns read or written.
--   RLS rules          Trigger function is SECURITY DEFINER, per-org advisory
--                      lock keyed off new.org_id, hash chain via prev_hash
--                      scoped to the same org. RLS on audit_log is unaffected
--                      because the function writes via table-owner identity,
--                      mirroring 0052:385-437 exactly. No cross-tenant read
--                      surface introduced.
--   Audit rules        This IS the audit-rule expansion. The constitution's
--                      "auto-state-transition triggers on every entity with
--                      a state machine; no best-effort handler writes" reads
--                      against the entity's lifecycle, and an INSERT IS a
--                      state event (null -> initial). The existing
--                      trg_audit_manufacturing_runs_status keeps its
--                      UPDATE-only guard so this migration adds, not edits,
--                      coverage. action='created', from_state=null,
--                      to_state=new.status. Hash chain reuses
--                      kitstak_audit_canonical for the payload hash, matching
--                      every other audit trigger across the codebase.
--   Migration rules    Forward-only. Idempotent (CREATE OR REPLACE FUNCTION,
--                      DROP TRIGGER IF EXISTS before CREATE TRIGGER). The
--                      backfill DO-block uses NOT EXISTS so re-running is a
--                      no-op once every historical row carries a 'created'
--                      audit entry.
--   State machine      Untouched. No new states. No new transitions. Only a
--                      new audit row at the INSERT edge (null -> initial),
--                      which the constitution treats as a first-class state
--                      event.
--   Scope              Manufacturing-only. The other 14 audit triggers
--                      (receiving / shipment / invoice / quote / project /
--                      etc.) keep their existing UPDATE-only guards.
--                      Symmetric coverage across the rest of the audit
--                      surface is filed as F-Wave9-AUDIT-CREATED-SYMMETRY-01
--                      and should be tackled in a dedicated audit-completeness
--                      pass, not here.
--
-- Background (B10 from the 2026-05-21 E2E smoke walk):
--   Operator created a manufacturing run in 'draft' state. The History panel
--   rendered "No history yet" because trg_audit_manufacturing_runs_status
--   (defined 0052:385-437) writes to audit_log only when status changes
--   (line 398: "if new.status is null or new.status = old.status then
--   return new; end if;"). The trigger is wired AFTER UPDATE OF status
--   (line 443). New rows in 'draft' state never trigger an UPDATE OF
--   status, so they never get a 'created' audit row.
--
--   Receiving orders and shipments LOOK like they log creation only because
--   the smoke test advanced them through created -> in_progress / picking
--   quickly. Their audit rows are also status-change rows, not true
--   creation events. Symmetric coverage across those 14 triggers is filed
--   as F-Wave9-AUDIT-CREATED-SYMMETRY-01.
--
-- Investigation: 03-workspace/journal/2026-05-21-e2e-smoke-investigation.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) trg_audit_manufacturing_runs_created — fires AFTER INSERT on the
--    manufacturing_runs table. Writes one audit_log row with
--    from_state=null, to_state=new.status, action='created'. The advisory
--    lock + prev_hash lookup + payload hash mirrors the existing
--    trg_audit_manufacturing_runs_status function from 0052:385-437.
-- ---------------------------------------------------------------------------

create or replace function public.trg_audit_manufacturing_runs_created()
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
  begin
    v_triggered_by := coalesce(auth.uid(), new.created_by);
  exception when others then
    v_triggered_by := new.created_by;
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
    'from_state', null,
    'to_state', new.status,
    'action', 'created',
    'triggered_by', v_triggered_by,
    'diff_json', jsonb_build_object('status', jsonb_build_object('from', null, 'to', new.status)),
    'prev_hash', v_prev_hash
  );
  v_payload_hash := encode(
    extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
  );
  insert into public.audit_log (
    org_id, entity_type, entity_id, from_state, to_state, action,
    triggered_by, diff_json, prev_hash, payload_hash
  ) values (
    new.org_id, 'manufacturing_run', new.id, null, new.status, 'created',
    v_triggered_by,
    jsonb_build_object('status', jsonb_build_object('from', null, 'to', new.status)),
    v_prev_hash, v_payload_hash
  );
  return new;
end;
$$;

revoke execute on function public.trg_audit_manufacturing_runs_created() from public, anon;

comment on function public.trg_audit_manufacturing_runs_created() is
  'Emits an audit_log row with action=created, from_state=null, to_state=new.status when a manufacturing_run is inserted. Pairs with trg_audit_manufacturing_runs_status (0052) which fires on UPDATE OF status only. SECURITY DEFINER; per-org advisory lock; hash chain via prev_hash.';

drop trigger if exists audit_manufacturing_runs_created on public.manufacturing_runs;
create trigger audit_manufacturing_runs_created
  after insert on public.manufacturing_runs
  for each row execute function public.trg_audit_manufacturing_runs_created();

-- ---------------------------------------------------------------------------
-- 2) Backfill historical manufacturing_runs rows that do NOT carry a
--    'created' audit entry. Mirrors the recompute_invoice_paid backfill
--    shape from 0058:187-204: iterate by id, perform an idempotent action.
--
--    NOT EXISTS guard makes the backfill a no-op on re-run. We sort
--    candidates by created_at so the per-org hash chain entries are
--    appended in the chronological order the rows were actually born.
--
--    The advisory lock and prev_hash lookup inside the inline INSERT block
--    mirror the trigger body so the backfill rows are indistinguishable
--    from a forward-emitted 'created' row except for the triggered_at
--    timestamp (which is now() — the system correcting the record, not
--    the original insert moment).
-- ---------------------------------------------------------------------------

do $$
declare
  v_row record;
  v_prev_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_triggered_by uuid;
  v_lock_key bigint;
begin
  for v_row in
    select id, org_id, status, created_by, created_at
      from public.manufacturing_runs
     where not exists (
       select 1
         from public.audit_log
        where entity_id = manufacturing_runs.id
          and entity_type = 'manufacturing_run'
          and action = 'created'
     )
     order by created_at
  loop
    v_triggered_by := v_row.created_by;
    v_lock_key := ('x' || substr(md5(v_row.org_id::text), 1, 16))::bit(64)::bigint;
    perform pg_advisory_xact_lock(v_lock_key);
    select payload_hash into v_prev_hash
      from public.audit_log
     where org_id = v_row.org_id
     order by triggered_at desc, id desc limit 1;
    v_payload := jsonb_build_object(
      'org_id', v_row.org_id,
      'entity_type', 'manufacturing_run',
      'entity_id', v_row.id,
      'from_state', null,
      'to_state', v_row.status,
      'action', 'created',
      'triggered_by', v_triggered_by,
      'diff_json', jsonb_build_object('status', jsonb_build_object('from', null, 'to', v_row.status)),
      'prev_hash', v_prev_hash
    );
    v_payload_hash := encode(
      extensions.digest(public.kitstak_audit_canonical(v_payload), 'sha256'), 'hex'
    );
    insert into public.audit_log (
      org_id, entity_type, entity_id, from_state, to_state, action,
      triggered_by, diff_json, prev_hash, payload_hash
    ) values (
      v_row.org_id, 'manufacturing_run', v_row.id, null, v_row.status, 'created',
      v_triggered_by,
      jsonb_build_object('status', jsonb_build_object('from', null, 'to', v_row.status)),
      v_prev_hash, v_payload_hash
    );
  end loop;
end$$;
