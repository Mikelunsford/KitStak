-- ============================================================================
-- Migration: 0088_user_has_password.sql
-- Wave: 10
-- Phase: Post-Wave-10 follow-up (invite / password onboarding correctness)
-- Closes: F-Wave10-WELCOME-PASSWORD-SERVER-GATE-01
-- Date: 2026-06-02
--
-- Background:
--   The SPA "Welcome to Kitstak / set a password" prompt (the DashboardPage
--   redirect to /account/security?welcome=1) was gated only on a per-user
--   localStorage flag. A user who already has a password but signs in from a
--   fresh browser, an incognito window, or after clearing storage was shown
--   the prompt again. GET /auth-api/me carried no server signal for whether a
--   password is set, so the SPA could not make the correct decision.
--
--   This migration adds a read-only SECURITY DEFINER helper that reports
--   whether an auth.users row has an encrypted_password. getMe calls it and
--   returns the boolean as MeResponse.password_set; the SPA only shows the
--   nudge when password_set is false.
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   drop function if exists public.user_has_password(uuid);
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added.
--   RLS rules          SECURITY DEFINER, service_role-only (REVOKE from
--                      public / anon / authenticated). Reads auth.users, which
--                      is not exposed via PostgREST; this function is the only
--                      surface and it returns a single boolean, never the
--                      password hash itself.
--   Audit rules        Read-only. No state change, no audit_log entry expected.
--   Migration rules    Forward-only. CREATE OR REPLACE FUNCTION is idempotent;
--                      re-runs are safe.
--   Idempotency        N/A. Read-only function, no writes.
-- ============================================================================

create or replace function public.user_has_password(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from auth.users u
     where u.id = p_user_id
       and u.encrypted_password is not null
       and length(u.encrypted_password) > 0
  );
$$;

revoke execute on function public.user_has_password(uuid)
  from public, anon, authenticated;
grant execute on function public.user_has_password(uuid)
  to service_role;

comment on function public.user_has_password(uuid) is
  'Returns true when the given auth.users row has an encrypted_password set. Read-only; never returns the hash. service_role only. Called by GET auth-api/me to populate MeResponse.password_set so the SPA shows the set-password onboarding nudge only to users who have no password yet, instead of re-nagging on every fresh browser or cleared storage. F-Wave10-WELCOME-PASSWORD-SERVER-GATE-01.';
