-- ============================================================================
-- Migration: 0055_portal_invite_function.sql
-- Wave: 9
-- Phase: Path B2 (Customer portal invite flow)
-- Closes: F-Wave9-PORTAL-B2-INVITE-01 (DB portion). Adds the
--   create_portal_membership RPC that the crm-api invite-to-portal
--   handler calls atomically after supabase.auth.admin.inviteUserByEmail
--   returns. Handler change in supabase/functions/crm-api/handlers/customers.ts
--   lands in the same PR as this migration.
-- Date: 2026-05-21
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   drop function if exists public.create_portal_membership(uuid, uuid, uuid);
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added.
--   RLS rules          The function is SECURITY DEFINER. Caller authorization
--                      happens in the edge handler via requireCap(
--                      'customers.invite_to_portal'). The function itself
--                      validates that p_customer_id belongs to p_org_id
--                      before linking, so even if a privileged caller fat-
--                      fingers a UUID from another org, the function refuses
--                      (raise exception). The constitutional 404 contract
--                      stays intact: cross-tenant probes surface as
--                      NOT_FOUND at the handler boundary.
--   Audit rules        org_memberships is NOT in the audit_log entity_type
--                      enum today (it's identity-side, not business-data).
--                      Portal invite is a low-frequency operator action;
--                      caller is captured in the standard handler audit
--                      chain via the requireCap check + the surrounding
--                      respondWithIdempotency wrapper. Audit at the
--                      identity layer can be added later if needed.
--   Migration rules    Forward-only. Idempotent (CREATE OR REPLACE
--                      FUNCTION; INSERT ON CONFLICT DO UPDATE inside).
--                      Re-runs are safe.
--   State machine     N/A. org_memberships is a relationship table; no
--                     state.
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

  -- Tenant guard. The customer must belong to the org we are linking the
  -- user into. Prevents an invite handler bug from creating cross-tenant
  -- memberships even though the surrounding cap check would normally catch
  -- it. Pattern A check at the DB layer.
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

  -- Resolve the customer_user role.
  select id into v_role_id
    from public.roles
   where code = 'customer_user';
  if v_role_id is null then
    raise exception 'INTERNAL_ERROR: customer_user role missing from roles table'
      using errcode = '22023';
  end if;

  -- Insert or update the membership. The unique constraint is
  -- (org_id, user_id), so a re-invite (same email -> same auth.users.id
  -- -> same user_id) overwrites the role+customer_id mapping without
  -- creating duplicates. This is the right shape for an idempotent
  -- "ensure this user is mapped to this customer in this org".
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

  return v_membership_id;
end;
$$;

revoke execute on function public.create_portal_membership(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_portal_membership(uuid, uuid, uuid)
  to service_role;

comment on function public.create_portal_membership(uuid, uuid, uuid) is
  'Atomically links an invited customer user to a customer record. Called by the crm-api customers.invite_to_portal handler after supabase.auth.admin.inviteUserByEmail returns. Idempotent. SECURITY DEFINER; caller authz happens at the handler boundary.';
