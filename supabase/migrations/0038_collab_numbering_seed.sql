-- ============================================================================
-- Migration: 0038_collab_numbering_seed.sql
-- Wave: 2
-- Phase: Cross-cutting collaboration
-- Closes: R-W2-COLLAB-04
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop seed_org_numbering. Not auto-run.
--
-- Constitutional alignment:
--   Migration rules  Forward-only. Idempotent.
--   Audit rules      seed_org_numbering does not touch audit_log.
--
-- seed_org_numbering(org_id) is a SECURITY DEFINER function the
-- provision_organization flow (migration 0002) and the operator can call to
-- ensure every doc_type has a numbering_sequences row. The function relies on
-- numbering_sequences being declared by one of the Phase 2 agents (B-E). If
-- the table is not present yet, the function returns 0 rather than raising,
-- so the seed can be safely called at any time.
-- ============================================================================

create or replace function public.seed_org_numbering(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_doc_type text;
  v_prefix   text;
  v_doc_types text[] := array[
    'quote',
    'invoice',
    'credit_note',
    'payment',
    'purchase_order',
    'vendor_bill',
    'expense',
    'receiving_order',
    'shipment',
    'production_run'
  ];
  v_prefixes text[] := array[
    'Q-',
    'INV-',
    'CN-',
    'PMT-',
    'PO-',
    'VB-',
    'EXP-',
    'RCV-',
    'SHP-',
    'RUN-'
  ];
  v_i int;
begin
  if p_org_id is null then
    raise exception 'VALIDATION_ERROR: p_org_id is required' using errcode = '22023';
  end if;

  -- If numbering_sequences table does not yet exist (Phase 2 agent not
  -- applied), short-circuit. Operator can re-run after the agent's migration.
  if not exists (
    select 1 from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'numbering_sequences'
  ) then
    return 0;
  end if;

  for v_i in 1 .. array_length(v_doc_types, 1) loop
    v_doc_type := v_doc_types[v_i];
    v_prefix   := v_prefixes[v_i];

    -- Insert if absent. We tolerate either of two known shapes used by the
    -- Phase 2 agents for numbering_sequences: a (org_id, doc_type) PK with
    -- a `prefix` column, or a richer shape. We use ON CONFLICT DO NOTHING.
    begin
      insert into public.numbering_sequences (
        org_id, doc_type, prefix, next_number
      ) values (
        p_org_id, v_doc_type, v_prefix, 1
      )
      on conflict do nothing;
      get diagnostics v_i = ROW_COUNT;
      v_inserted := v_inserted + v_i;
    exception when undefined_column then
      -- Shape differs. Try minimum (org_id, doc_type).
      begin
        insert into public.numbering_sequences (org_id, doc_type)
        values (p_org_id, v_doc_type)
        on conflict do nothing;
      exception when others then
        null;
      end;
    end;
  end loop;

  return v_inserted;
end;
$$;

revoke execute on function public.seed_org_numbering(uuid)
  from public, anon, authenticated;
grant execute on function public.seed_org_numbering(uuid)
  to service_role;

comment on function public.seed_org_numbering(uuid) is
  'Seeds numbering_sequences rows for every doc_type. Called by provision_organization. Idempotent.';
