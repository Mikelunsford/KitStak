-- ---------------------------------------------------------------------------
-- Migration: 0047_fix_project_line_item_audit.sql
-- Wave: 6
-- Phase: 6.5 hotfix (post Phase 6 chassis)
-- Closes: F-Wave6-AUDIT-01
-- Date: 2026-05-19
--
-- Problem.
-- 0044 introduced trg_audit_project_line_items() which calls
-- audit_append_state_change(..., null, null, v_action, ...). The second
-- positional argument (to_state) is passed as null, but audit_log.to_state
-- is declared NOT NULL in 0001_foundation.sql. Every INSERT into
-- project_line_items therefore raises a not-null violation and rolls back
-- the surrounding transaction. The user-visible symptom is the convert
-- helper failing with:
--   "Convert failed: null value in column to_state of relation audit_log
--    violates not-null constraint"
-- for any approved quote that has at least one line item. This blocks the
-- F-Wave6-FLOW-01 quote-to-cash exercise.
--
-- Fix.
-- Redefine the trigger function via create or replace to pass the action
-- verb as to_state (created / updated / deleted) and null as from_state.
-- project_line_item is not a state-machine entity, so to_state acts as
-- an action label rather than a workflow state. Trigger registration
-- (audit_project_line_items) is untouched because the function signature
-- is unchanged. audit_log schema, audit_append_state_change, and
-- convert_quote_to_project are untouched.
--
-- DOWN MIGRATION (operator-only, not auto-run).
-- To revert, restore the 0044 function body via create or replace with
-- the two null arguments to audit_append_state_change (from_state = null,
-- to_state = null). This is NOT ready-to-run because audit_log.to_state
-- is still NOT NULL, so reverting would re-introduce the original failure
-- on the next project_line_items insert. Operator should not run the
-- revert without first relaxing the to_state NOT NULL constraint, which
-- would itself need a separate forward migration.
--
-- Constitutional alignment.
--   Audit rules.
--     Single-writer trigger pattern preserved: trg_audit_project_line_items
--     remains the only writer for project_line_item audit rows; no handler
--     does best-effort writes. For non-state-machine entities like
--     project_line_item we use the action verb as to_state so the
--     NOT NULL contract on audit_log is satisfied. Hash chain integrity
--     is preserved because verify_audit_chain treats to_state as opaque
--     bytes during canonicalisation; changing the value of to_state
--     between migrations does not invalidate previously sealed rows since
--     each row hashes its own snapshot, and no previously sealed
--     project_line_item rows exist (every prior insert rolled back).
--   Migration rules.
--     Forward-only. Idempotent via create or replace function. No edits
--     to numbered migrations on disk.
--   RLS rules.
--     Untouched. project_line_items RLS policies and audit_log RLS
--     policies remain as defined in 0001 and 0044.
--   Money rules.
--     Untouched. unit_price_cents column suffix and BIGINT cents storage
--     are preserved; the diff payload still emits cents fields verbatim.
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
    v_to_state := 'updated';
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
    v_to_state := 'deleted';
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

revoke execute on function public.trg_audit_project_line_items() from public, anon;
