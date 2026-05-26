-- ============================================================================
-- Migration: 0065_staff_invite_function.sql
-- Wave: 9
-- Phase: Staff invite chassis (admin can invite teammates via email)
-- Closes: F-Wave9-STAFF-INVITE-CHASSIS-01 (DB portion). Adds the
--   create_staff_membership RPC that the auth-api members-invite handler
--   calls atomically after supabase.auth.admin.generateLink returns.
--   Handler change in supabase/functions/auth-api/index.ts lands in the
--   same PR as this migration.
-- Date: 2026-05-26
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   drop function if exists public.create_staff_membership(uuid, uuid, text, uuid);
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added.
--   RLS rules          The function is SECURITY DEFINER. Caller authorization
--                      happens in the edge handler via requireCap(
--                      'org.member.invite') plus a privilege-escalation guard
--                      that refuses an org_owner role grant from any caller
--                      whose own role is not org_owner. The function itself
--                      validates that p_org_id resolves to an active
--                      organization and that p_role_code is one of the six
--                      staff role codes (cannot be used to bind customer_user
--                      or vendor_user via this surface). The constitutional
--                      404 contract stays intact: the handler surfaces a
--                      missing org as NOT_FOUND at its boundary; this function
--                      raises NOT_FOUND so a service-role caller that fat-
--                      fingers a UUID does not silently create an orphan.
--   Audit rules        org_memberships is NOT in the audit_log entity_type
--                      enum today (it is identity-side, not business-data).
--                      Staff invite is a low-frequency operator action; the
--                      caller is captured via the requireCap check plus the
--                      surrounding respondWithIdempotency wrapper. Audit at
--                      the identity layer can be added later (the membership
--                      row stamps created_by / updated_by so the actor is
--                      recoverable).
--   Migration rules    Forward-only. Idempotent (CREATE OR REPLACE
--                      FUNCTION; INSERT ON CONFLICT DO NOTHING inside).
--                      Re-runs are safe.
--   State machine      N/A. org_memberships is a relationship table; no
--                      state.
-- ============================================================================

create or replace function public.create_staff_membership(
  p_org_id uuid,
  p_user_id uuid,
  p_role_code text,
  p_invited_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
  v_membership_id uuid;
  v_org_status text;
begin
  if p_org_id is null or p_user_id is null or p_role_code is null then
    raise exception 'VALIDATION_ERROR: p_org_id, p_user_id, p_role_code all required'
      using errcode = '22023';
  end if;

  -- Restrict the role grant surface to staff roles only. customer_user and
  -- vendor_user are intentionally excluded; they have their own provisioning
  -- paths (create_portal_membership in migration 0055 for customer_user; the
  -- vendor portal chassis ships separately). A handler bug that lets a bad
  -- role_code reach this function gets refused at the DB layer.
  if p_role_code not in (
    'org_owner', 'org_admin', 'sales', 'ops', 'accounting', 'viewer'
  ) then
    raise exception 'VALIDATION_ERROR: p_role_code % is not a staff role', p_role_code
      using errcode = '22023';
  end if;

  -- Tenant guard. The org must exist and be active. Suspended or archived
  -- orgs cannot accept new memberships via this surface.
  select status into v_org_status
    from public.organizations
   where id = p_org_id
     and deleted_at is null;
  if v_org_status is null then
    raise exception 'NOT_FOUND: organization %', p_org_id
      using errcode = 'P0002';
  end if;
  if v_org_status <> 'active' then
    raise exception 'NOT_FOUND: organization % is not active (status=%)',
      p_org_id, v_org_status
      using errcode = 'P0002';
  end if;

  -- Resolve the role id from the static roles table seeded in 0001.
  select id into v_role_id
    from public.roles
   where code = p_role_code;
  if v_role_id is null then
    raise exception 'INTERNAL_ERROR: role % missing from roles table', p_role_code
      using errcode = '22023';
  end if;

  -- Insert the membership row. ON CONFLICT (org_id, user_id) DO NOTHING keeps
  -- the surface idempotent: a re-invite of the same email (which resolves to
  -- the same auth.users.id) returns the existing membership id without
  -- changing role or activation state. To intentionally change role or
  -- reactivate, the operator hits a separate PATCH /members/:id route (out
  -- of scope for this chassis). The handler is responsible for telling the
  -- operator when no-op vs newly-created (return shape is the same).
  insert into public.org_memberships (
    org_id, user_id, role_id, is_active, joined_at, created_by, updated_by
  ) values (
    p_org_id, p_user_id, v_role_id, true, now(), p_invited_by, p_invited_by
  )
  on conflict (org_id, user_id) do nothing
  returning id into v_membership_id;

  -- ON CONFLICT DO NOTHING leaves v_membership_id null when the row already
  -- exists; resolve it explicitly so the caller always gets a real uuid back.
  if v_membership_id is null then
    select id into v_membership_id
      from public.org_memberships
     where org_id = p_org_id and user_id = p_user_id;
  end if;

  return v_membership_id;
end;
$$;

revoke execute on function public.create_staff_membership(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_staff_membership(uuid, uuid, text, uuid)
  to service_role;

comment on function public.create_staff_membership(uuid, uuid, text, uuid) is
  'Atomically links an invited staff user to an organization with the requested role. Called by the auth-api POST /members/invite handler after supabase.auth.admin.generateLink returns. Idempotent: re-invites of the same (org_id, user_id) return the existing membership without mutating role or activation state. SECURITY DEFINER; caller authz and privilege-escalation guard happen at the handler boundary.';
