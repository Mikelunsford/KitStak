-- ============================================================================
-- Migration: 0056_pg_cron_notifications_drain.sql
-- Wave: 9
-- Phase: Path B operator-friendliness
-- Closes: F-Wave9-NOTIFICATIONS-DRAIN-PG-CRON-01
-- Date: 2026-05-21
--
-- Background:
--   The GitHub Actions cron at `.github/workflows/notifications-drain.yml`
--   was the only trigger for /notifications-worker/drain. GitHub schedules
--   are documented as best-effort and routinely skip 30+ minute windows
--   during peak load. Observed in production on 2026-05-21: a customer
--   sign-in magic link sat queued for ~90 minutes between request and
--   drain, expiring the Supabase magic-link token (1h default) before the
--   customer could click it.
--
--   This migration moves the primary drain trigger onto `pg_cron` running
--   inside Supabase Postgres. Cadence: every 1 minute. The pg_cron job
--   reads its URL and worker secret from Supabase Vault (encrypted at
--   rest, gated to service_role) and POSTs to the same drain endpoint via
--   `pg_net.http_post`.
--
--   The GitHub Actions cron is retained at /30 cadence as a backstop; if
--   pg_cron ever errors, the workflow still drains eventually. Both paths
--   hit the same idempotent endpoint, so there's no harm in double-firing.
--
-- DOWN MIGRATION (operator-only; not auto-run):
--   select cron.unschedule('notifications-drain');
--   drop function if exists public.trigger_notifications_drain();
--   -- Vault entries are operator-managed; do not auto-delete on rollback.
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents column added.
--   RLS rules          The function is SECURITY DEFINER. Execute privilege
--                      revoked from public/anon/authenticated; granted only
--                      to service_role. pg_cron runs as the postgres
--                      superuser; the function is the seam.
--   Audit rules        Drain runs do not audit-log; the existing
--                      notifications.delivered_at stamping is the
--                      observability surface. Idempotent — repeat drains
--                      are no-ops on already-delivered rows.
--   Migration rules    Forward-only. Idempotent (CREATE EXTENSION IF NOT
--                      EXISTS, CREATE OR REPLACE FUNCTION, cron.schedule
--                      upserts on duplicate jobname). Re-runs safe.
--   Capability rules   No new caps. service_role bypasses all cap checks.
--   Secret handling    Vault is the canonical Supabase-encrypted store for
--                      this kind of cross-cutting cron secret. Do NOT
--                      fall back to current_setting or pg_settings —
--                      those are plaintext-visible.
--
-- Operator action required AFTER this migration applies:
--   Run the following SQL in the Supabase SQL editor (as the project
--   owner) to populate Vault. Without these entries, the cron job is a
--   no-op (silent skip), so the chassis fails closed cleanly:
--
--     select vault.create_secret(
--       'https://zmnvwhqjahwidprnjxrq.supabase.co/functions/v1/notifications-worker/drain',
--       'notifications_drain_url'
--     );
--     select vault.create_secret(
--       '<WORKER_SECRET value, same one set on Edge Function secrets>',
--       'notifications_worker_secret'
--     );
--
--   Verify via:
--     select name from vault.decrypted_secrets where name in (
--       'notifications_drain_url', 'notifications_worker_secret'
--     );
-- ============================================================================

-- Enable pg_cron and pg_net (both pre-installed on Supabase; the create
-- extension if not exists is a no-op when present).
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.trigger_notifications_drain()
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_url text;
  v_secret text;
begin
  -- Read URL and secret from Supabase Vault. If either is absent, no-op
  -- silently so the chassis fails closed during the operator-action window
  -- after this migration applies and before Vault is populated.
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'notifications_drain_url'
     limit 1;
  exception when others then
    v_url := null;
  end;

  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'notifications_worker_secret'
     limit 1;
  exception when others then
    v_secret := null;
  end;

  if v_url is null or v_secret is null then
    return;
  end if;

  -- Fire-and-forget. pg_net queues the request asynchronously; the function
  -- returns immediately. The HTTP call's result lands in
  -- net._http_response if we ever need to inspect it; we do not need to.
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'X-Worker-Secret', v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke execute on function public.trigger_notifications_drain()
  from public, anon, authenticated;
grant execute on function public.trigger_notifications_drain()
  to service_role;

comment on function public.trigger_notifications_drain() is
  'pg_cron callback. POSTs to /notifications-worker/drain every minute using URL + X-Worker-Secret stored in Supabase Vault. No-op when Vault entries absent so the chassis fails closed during the post-migration operator-action window.';

-- Schedule: every minute. cron.schedule upserts on duplicate jobname, so
-- re-applying this migration is safe.
select cron.schedule(
  'notifications-drain',
  '* * * * *',
  $$select public.trigger_notifications_drain();$$
);
