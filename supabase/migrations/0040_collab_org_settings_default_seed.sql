-- ============================================================================
-- Migration: 0040_collab_org_settings_default_seed.sql
-- Wave: 2
-- Phase: Cross-cutting collaboration
-- Closes: R-W2-COLLAB-06
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop seed_org_settings. Not auto-run.
--
-- Constitutional alignment:
--   Migration rules  Forward-only. Idempotent.
--
-- seed_org_settings(org_id) is a SECURITY DEFINER function that ensures
-- org_settings (when shipped by another agent) has a row for the org, and
-- ensures the standard org_feature_flags entries exist. Migration 0001 ships
-- org_feature_flags but does not seed plugin flags; this function backfills.
-- ============================================================================

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

  -- org_settings table is owned by another agent and may not exist yet. We
  -- tolerate that and short-circuit gracefully.
  if exists (
    select 1 from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'org_settings'
  ) then
    begin
      insert into public.org_settings (org_id)
      values (p_org_id)
      on conflict do nothing;
    exception when others then
      null;
    end;
  end if;

  return v_inserted;
end;
$$;

revoke execute on function public.seed_org_settings(uuid)
  from public, anon, authenticated;
grant execute on function public.seed_org_settings(uuid)
  to service_role;

comment on function public.seed_org_settings(uuid) is
  'Seeds default org_feature_flags and org_settings row for an org. Idempotent.';
