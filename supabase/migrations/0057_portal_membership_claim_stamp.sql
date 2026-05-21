-- ============================================================================
-- Migration: 0057_portal_membership_claim_stamp.sql
-- Wave: 9
-- Phase: Path B operator-friendliness
-- Closes: F-Wave9-PORTAL-INVITE-CLAIM-STAMP-01
-- Date: 2026-05-21
--
-- Background:
--   The create_portal_membership RPC (migration 0055) inserts the
--   org_memberships row mapping a new customer_user to a customer, but
--   it does NOT stamp the kitstak_org_id / kitstak_org_role claims onto
--   the auth.users.raw_app_meta_data. The customer's JWT therefore lacks
--   the org claim. Every authenticated edge function call returns 401 at
--   `requireCaller` until an operator manually backfills the claims.
--
--   Discovered live on 2026-05-21 during Path B3 smoke: invited customer
--   landed at /portal, magic-link auth succeeded, but /portal/me
--   returned 401 because the JWT had no kitstak_org_id. Operator's user
--   was backfilled via direct UPDATE on auth.users; this migration is
--   the permanent fix so future invitees never hit the same gap.
--
--   This is the same pattern auth-api /sessions/switch-org uses
--   (auth.admin.updateUserById with app_metadata). Doing it inside the
--   RPC keeps invite + claim-stamp atomic.
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   create or replace function public.create_portal_membership(uuid, uuid, uuid)
--   -- restore from 0055_portal_invite_function.sql body
--
-- Constitutional alignment:
--   Money rules        Untouched.
--   RLS rules          The function remains SECURITY DEFINER. Caller
--                      authz still happens at the handler boundary via
--                      requireCap('customers.invite_to_portal'). The
--                      function's tenant guard (p_customer_id belongs
--                      to p_org_id) is preserved.
--   Audit rules        Same posture as 0055. org_memberships and
--                      auth.users.raw_app_meta_data writes happen
--                      inside the same SECURITY DEFINER call; no new
--                      audit_log entries needed (identity-layer
--                      operations).
--   Migration rules    Forward-only. Idempotent (CREATE OR REPLACE
--                      FUNCTION). The auth.users update uses jsonb
--                      `||` merge so existing claims on the row (if
--                      any) are preserved.
--   State machine     N/A.
--
--   Why this is safe: writes to auth.users.raw_app_meta_data do NOT
--   change the user's existing JWT-bearing sessions (those tokens are
--   already signed). They only affect NEW JWTs minted on the next
--   sign-in. So the customer's first magic-link click after invite
--   mints a JWT with the claims, and re-invites of an existing user
--   re-stamp without disturbing any live session.
-- ============================================================================

create or replace function public.create_portal_membership(
  p_customer_id uuid,
  p_user_id uuid,
  p_org_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_id uuid;
  v_membership_id uuid;
  v_customer_org uuid;
begin
  if p_customer_id is null or p_user_id is null or p_org_id is null then
    raise exception 'VALIDATION_ERROR: p_customer_id, p_user_id, p_org_id all required'
      using errcode = '22023';
  end if;

  -- Tenant guard (preserved from 0055).
  select org_id into v_customer_org
    from public.customers
   where id = p_customer_id
     and deleted_at is null;
  if v_customer_org is null then
    raise exception 'NOT_FOUND: customer %', p_customer_id
      using errcode = '22023';
  end if;
  if v_customer_org <> p_org_id then
    raise exception 'NOT_FOUND: customer % does not belong to org %', p_customer_id, p_org_id
      using errcode = '22023';
  end if;

  -- Resolve the customer_user role (preserved from 0055).
  select id into v_role_id
    from public.roles
   where code = 'customer_user';
  if v_role_id is null then
    raise exception 'INTERNAL_ERROR: customer_user role missing from roles table'
      using errcode = '22023';
  end if;

  -- Insert or update the membership (preserved from 0055).
  insert into public.org_memberships (
    org_id, user_id, role_id, customer_id, is_active, invited_at
  ) values (
    p_org_id, p_user_id, v_role_id, p_customer_id, true, now()
  )
  on conflict (org_id, user_id) do update
    set role_id = excluded.role_id,
        customer_id = excluded.customer_id,
        is_active = true,
        updated_at = now()
  returning id into v_membership_id;

  -- NEW: stamp the org claims onto auth.users.raw_app_meta_data so the
  -- customer's next-minted JWT carries kitstak_org_id and
  -- kitstak_org_role. Without this, requireCaller in every authenticated
  -- edge function returns 401 (no active org claim) and the portal
  -- /portal/me lookup cascades into a blank Welcome / empty sections
  -- render.
  --
  -- Uses jsonb `||` merge so any pre-existing claims on the row (e.g. a
  -- staff user being granted a customer_user role in another tenant)
  -- are preserved.
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) ||
       jsonb_build_object(
         'kitstak_org_id', p_org_id::text,
         'kitstak_org_role', 'customer_user'
       )
   where id = p_user_id;

  return v_membership_id;
end;
$$;

-- Grants (preserved from 0055).
revoke execute on function public.create_portal_membership(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_portal_membership(uuid, uuid, uuid)
  to service_role;

comment on function public.create_portal_membership(uuid, uuid, uuid) is
  'Atomically links an invited customer user to a customer record AND stamps kitstak_org_id + kitstak_org_role onto auth.users.raw_app_meta_data so the next-minted JWT carries the org claim. Called by the crm-api customers.invite_to_portal handler. Idempotent. SECURITY DEFINER; caller authz happens at the handler boundary.';
