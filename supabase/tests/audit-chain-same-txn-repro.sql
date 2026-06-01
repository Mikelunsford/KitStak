-- ============================================================================
-- Repro + acceptance script for F-Wave9-AUDIT-CHAIN-SAME-TXN-01.
--
-- Proves that migration 0085 makes the per-org audit_log hash chain survive a
-- transaction that writes MORE THAN ONE audit row for the same org (same
-- triggered_at). Run AFTER a clean `supabase db reset` (which applies all
-- migrations through 0085) against the local stack:
--
--   supabase db reset
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/audit-chain-same-txn-repro.sql
--
-- Expected output (all checks must report 0 broken links / true):
--   same_txn_distinct_timestamps | 1
--   PASS same-transaction chain  | 0 broken
--   PASS provision_organization  | 0 broken
--
-- This script writes to a throwaway org and rolls everything back, so it leaves
-- no residue. It NEVER runs against prod or staging.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Case 1: many audit rows for one org in ONE transaction via the shared
-- audit_append_state_change helper (the path quote/project line-item triggers
-- and convert_quote_to_project take). Before 0085 this produced a broken link
-- at nearly every row; after 0085 it must produce zero.
-- ---------------------------------------------------------------------------

do $$
declare
  v_org uuid := gen_random_uuid();
  i int;
begin
  -- Seed a parent organization row so the audit_log.org_id FK is satisfied.
  insert into public.organizations (id, slug, display_name, status)
  values (v_org, 'audit-repro-' || substr(v_org::text, 1, 8), 'Audit Repro Org', 'active');

  for i in 1..25 loop
    perform public.audit_append_state_change(
      v_org, 'quote', gen_random_uuid(),
      'draft', 'submitted', 'state_change',
      null, jsonb_build_object('n', i)
    );
  end loop;

  -- Confirm all 25 rows shared one transaction timestamp (the hazard
  -- precondition). If this is not 1, the test environment is not exercising
  -- the same-transaction case and the result below is not meaningful.
  raise notice 'same_txn_distinct_timestamps | %',
    (select count(distinct triggered_at) from public.audit_log where org_id = v_org);

  -- verify_audit_chain returns the FIRST broken row, or no rows when intact.
  if exists (select 1 from public.verify_audit_chain(v_org)) then
    raise exception 'FAIL same-transaction chain: verify_audit_chain reported a break for org %', v_org;
  else
    raise notice 'PASS same-transaction chain  | 0 broken';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Case 2: provision_organization itself - it inserts an organization in
-- 'provisioning' status then transitions it to 'active' in the SAME
-- transaction, firing the organizations status trigger. Combined with the
-- created-symmetry triggers this is a real multi-row same-txn write. The
-- resulting chain for the new org must verify intact.
-- ---------------------------------------------------------------------------

do $$
declare
  v_org uuid;
  v_user uuid := gen_random_uuid();
begin
  v_org := public.provision_organization(
    'audit-repro-prov-' || substr(gen_random_uuid()::text, 1, 8),
    'Audit Repro Provision Org',
    v_user,
    'audit-repro@example.test'
  );

  if exists (select 1 from public.verify_audit_chain(v_org)) then
    raise exception 'FAIL provision_organization: verify_audit_chain reported a break for org %', v_org;
  else
    raise notice 'PASS provision_organization  | 0 broken';
  end if;
end $$;

-- Leave no residue.
rollback;
