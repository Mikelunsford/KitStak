-- ============================================================================
-- Migration: 0064_provision_organization_completeness.sql
-- Wave: 9
-- Phase: Provisioning hygiene (post-Audit-v3, pre-checklist-UI)
-- Closes: F-Wave9-PROVISION-NUMBERING-SEED-01,
--         F-Wave9-PROVISION-COA-SEED-01,
--         F-Wave9-PROVISION-WAREHOUSE-SEED-01,
--         F-Wave9-SEED-ORG-SETTINGS-SILENT-FAIL-01
-- Date: 2026-05-25
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   -- 1) Restore the 0043 body of provision_organization (drop the three
--   --    PERFORM calls added below). Copy the body from migration 0043.
--   -- 2) Restore the 0040 body of seed_org_settings (the version with the
--   --    broken org_settings insert wrapped in `when others then null`).
--   --    Operator copies from 0040 verbatim.
--   -- The backfill loop has no down-migration because the rows it created
--   -- are idempotent ON CONFLICT DO NOTHING inserts; rolling them back would
--   -- require a manual review of what was operator-created vs seed-created.
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added.
--   RLS rules          Untouched. seed_org_default_warehouse / _chart_of_accounts
--                      / _numbering / _settings are all SECURITY DEFINER and
--                      already grant-controlled to service_role only. The
--                      seeded rows inherit Pattern A from their parent tables
--                      (organizations / warehouses / chart_of_accounts /
--                      numbering_sequences / org_feature_flags).
--   Audit rules        provision_organization continues to write the org-status
--                      audit row via trg_audit_organizations_status (installed
--                      in 0002). The new PERFORM calls do not bypass audit;
--                      seed_* functions write metadata rows that do not have
--                      audit triggers installed.
--   Migration rules    Forward-only. CREATE OR REPLACE FUNCTION is idempotent.
--                      The backfill DO block is idempotent via ON CONFLICT
--                      DO NOTHING inside the seed functions.
--   Idempotency        All three seed functions use ON CONFLICT DO NOTHING
--                      patterns so re-running provision_organization (via
--                      the slug short-circuit) or re-running the backfill
--                      loop produces no duplicate rows.
--
-- Root cause: migration 0043 added seed_org_settings to provision_organization
-- but the other three seed functions (seed_org_numbering, _chart_of_accounts,
-- _default_warehouse) were defined in earlier migrations and never wired in.
-- Result: every org provisioned via the canonical RPC ships missing:
--   - numbering_sequences rows for 11 doc types (next_doc_number's fallback
--     insert auto-heals on first call, but loses the configured prefix /
--     pad_width / reset_period)
--   - chart_of_accounts rows for 13 system accounts (any COA-gated feature
--     fails open until an operator manually runs seed_org_chart_of_accounts)
--   - a default warehouse row (HARD blocker for receiving, shipments, and
--     manufacturing runs which all require warehouse_id)
--
-- The seed_org_settings org_settings branch (0040) was also silently broken:
-- it tries `insert into org_settings (org_id) values (...)` against a table
-- whose primary key is (org_id, group_key, setting_key) with NOT NULL on all
-- three columns. The `when others then null` exception block swallowed the
-- error so it appeared to succeed. We remove that branch entirely; the
-- feature-flag seeding portion (which is the function's primary purpose)
-- continues to work unchanged.
--
-- Out of scope (deliberate, filed as follow-ups for later waves):
--   F-Wave9-PROVISION-TIER-FLAGS-01     tier-aware feature flag defaults
--                                       based on plan_code (today all flags
--                                       are seeded as false regardless).
--   F-Wave9-PROVISION-TAX-SEED-01      operator chose to skip tax seeding
--                                       (empty tax list is graceful in the
--                                       SPA today; verified pre-merge).
--   F-Wave9-STAFF-INVITE-CHASSIS-01    no staff invite handler exists;
--                                       capability declared but unwired.
--   F-Wave9-SELF-SERVE-SIGNUP-01       no SignupPage / wrapping Edge
--                                       Function for provision_organization;
--                                       parked behind Stripe milestone.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Fix seed_org_settings: remove the broken org_settings insert branch.
--
--    The branch tried `insert into org_settings (org_id) values (...)` but the
--    table requires (org_id, group_key, setting_key) and the insert silently
--    failed inside `when others then null`. We delete the dead branch so the
--    function does exactly what it documents: seed feature flags. Operators
--    who want pre-populated org_settings rows can call a future
--    seed_org_settings_keys(...) function (not in this migration's scope).
-- ---------------------------------------------------------------------------

create or replace function public.seed_org_settings(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_flag text;
  v_flags text[] := array[
    'plugins.three_pl',
    'plugins.manufacturing',
    'plugins.copack_ecom',
    'plugins.kitforce',
    'plugins.kitcost',
    'feature.collaboration',
    'feature.global_search',
    'feature.imports',
    'feature.exports',
    'feature.customer_portal'
  ];
begin
  if p_org_id is null then
    raise exception 'VALIDATION_ERROR: p_org_id is required' using errcode = '22023';
  end if;

  foreach v_flag in array v_flags loop
    insert into public.org_feature_flags (org_id, flag_key, is_enabled, config)
    values (p_org_id, v_flag, false, '{}'::jsonb)
    on conflict (org_id, flag_key) do nothing;
    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  -- Note: the prior body in 0040 attempted to insert into org_settings here,
  -- but the table's (org_id, group_key, setting_key) PK with NOT NULL on all
  -- three columns made the insert fail. The error was swallowed by a
  -- `when others then null` block. Removed in 0064 because the branch was
  -- dead code. A future seed_org_settings_keys(p_org_id) function can ship
  -- the canonical (group_key, setting_key, value) defaults when the product
  -- needs them; today no consumer reads org_settings on a virgin org.

  return v_inserted;
end;
$$;

revoke execute on function public.seed_org_settings(uuid)
  from public, anon, authenticated;
grant execute on function public.seed_org_settings(uuid)
  to service_role;

comment on function public.seed_org_settings(uuid) is
  'Seeds default org_feature_flags (10 canonical flags, all disabled). Idempotent. Called by provision_organization.';

-- ---------------------------------------------------------------------------
-- 2) Extend provision_organization to call the three missing seed functions.
--
--    Order is intentional and matches data-dependency order:
--      a) seed_org_settings        feature flags (already wired in 0043)
--      b) seed_org_numbering       11 doc-type sequences (Q-, INV-, etc.)
--      c) seed_org_chart_of_accounts  13 system accounts
--      d) seed_org_default_warehouse  one DEFAULT warehouse
--
--    All four are SECURITY DEFINER and idempotent. The slug short-circuit
--    at the top of provision_organization still returns the existing org_id
--    before any seed call fires, so re-provisioning is a no-op.
--
--    Signature `(text, text, uuid, text)` matches 0002 / 0043; no overload
--    is created, no GRANT changes are required.
-- ---------------------------------------------------------------------------

create or replace function public.provision_organization(
  p_slug           text,
  p_display_name   text,
  p_owner_user_id  uuid,
  p_owner_email    text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id  uuid;
  v_role_id uuid;
begin
  if p_slug is null or length(trim(p_slug)) = 0 then
    raise exception 'VALIDATION_ERROR: p_slug is required' using errcode = '22023';
  end if;
  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'VALIDATION_ERROR: p_display_name is required' using errcode = '22023';
  end if;
  if p_owner_user_id is null then
    raise exception 'VALIDATION_ERROR: p_owner_user_id is required' using errcode = '22023';
  end if;
  if p_owner_email is null or length(trim(p_owner_email)) = 0 then
    raise exception 'VALIDATION_ERROR: p_owner_email is required' using errcode = '22023';
  end if;

  select id into v_org_id
    from public.organizations
   where slug = p_slug
   limit 1;

  if v_org_id is not null then
    return v_org_id;
  end if;

  select id into v_role_id from public.roles where code = 'org_owner' limit 1;
  if v_role_id is null then
    raise exception 'INTERNAL_ERROR: org_owner role missing'
      using errcode = 'P0001';
  end if;

  insert into public.organizations (
    slug, display_name, status, created_by, updated_by
  ) values (
    p_slug, p_display_name, 'provisioning', p_owner_user_id, p_owner_user_id
  )
  returning id into v_org_id;

  insert into public.profiles (user_id, email, display_name, is_active)
  values (p_owner_user_id, p_owner_email, p_display_name, true)
  on conflict (user_id) do nothing;

  insert into public.org_memberships (
    org_id, user_id, role_id, is_active, joined_at, created_by, updated_by
  ) values (
    v_org_id, p_owner_user_id, v_role_id, true, now(), p_owner_user_id, p_owner_user_id
  )
  on conflict (org_id, user_id) do nothing;

  insert into public.org_branding (org_id, created_by, updated_by)
  values (v_org_id, p_owner_user_id, p_owner_user_id)
  on conflict (org_id) do nothing;

  update public.organizations
     set status     = 'active',
         updated_at = now(),
         updated_by = p_owner_user_id
   where id = v_org_id;

  -- ----- 0064 additions: complete the new-org seed surface ------------------

  -- Feature flags (10 canonical entries, disabled). Already wired in 0043.
  perform public.seed_org_settings(v_org_id);

  -- Numbering sequences for all 11 doc types (quote / invoice / credit_note /
  -- payment / purchase_order / vendor_bill / expense / receiving_order /
  -- shipment / production_run / manufacturing_run). Without this, the first
  -- next_doc_number(...) call auto-heals via a fallback insert but loses
  -- the configured prefix, pad_width, and reset_period.
  perform public.seed_org_numbering(v_org_id);

  -- 13 system chart-of-accounts rows (Cash / AR / Inventory / AP / Equity /
  -- Revenue / COGS / etc.). Required for any COA-gated finance feature.
  perform public.seed_org_chart_of_accounts(v_org_id);

  -- A single DEFAULT warehouse. HARD blocker for receiving orders,
  -- shipments, and manufacturing runs without it.
  perform public.seed_org_default_warehouse(v_org_id);

  -- --------------------------------------------------------------------------

  return v_org_id;
end;
$$;

revoke execute on function public.provision_organization(text, text, uuid, text)
  from public, anon, authenticated;
grant  execute on function public.provision_organization(text, text, uuid, text)
  to service_role;

comment on function public.provision_organization(text, text, uuid, text) is
  'Atomic org provisioning. Seeds org row, owner profile, owner membership, branding, feature flags, numbering sequences, chart of accounts, and default warehouse. Idempotent via slug short-circuit. service_role only.';

-- ---------------------------------------------------------------------------
-- 3) Backfill: for every existing organization, call all four seed functions
--    to bring them to parity with what a fresh org provisioned by the updated
--    function will receive. Idempotent via ON CONFLICT DO NOTHING inside each
--    seed function; safe to re-run.
--
--    Includes seed_org_settings even though 0042 already ran a one-time
--    backfill, because that migration ran before the 10-flag canon was
--    finalized (some orgs in the wild carry partial flag sets). The function
--    is idempotent so re-running on already-complete orgs is a no-op.
--
--    Skips orgs that already have a default warehouse so we never overwrite
--    operator-chosen names; seed_org_default_warehouse already does this by
--    returning the existing default's id before inserting.
-- ---------------------------------------------------------------------------

do $$
declare
  v_org_id uuid;
begin
  for v_org_id in
    select id from public.organizations order by created_at
  loop
    perform public.seed_org_settings(v_org_id);
    perform public.seed_org_numbering(v_org_id);
    perform public.seed_org_chart_of_accounts(v_org_id);
    perform public.seed_org_default_warehouse(v_org_id);
  end loop;
end$$;
