# pg_cron notifications drain — reliable cadence on Supabase infra

**Date:** 2026-05-21
**Decision:** F-Wave9-NOTIFICATIONS-DRAIN-PG-CRON-01 closed. The primary trigger for `/notifications-worker/drain` is now `pg_cron` running inside Supabase Postgres at 1-minute cadence. The GitHub Actions cron is retained at 30-minute cadence as a defense-in-depth backstop.
**Driven by:** Real production failure observed during Path B2.5a smoke on 2026-05-21. A customer sign-in magic link sat queued for ~90 minutes between request and drain; by the time GitHub Actions actually fired the cron and Resend shipped the email, the Supabase magic-link token had already passed its 1-hour TTL. The customer clicked, landed on `kitstak.com/portal#error=access_denied&error_code=otp_expired`, and the SPA rendered `WELCOME, .` with a 401 on `/portal/me`.

## What changed

### Migration `0056_pg_cron_notifications_drain.sql`

- Enables `pg_cron` and `pg_net` extensions (both pre-installed by Supabase; `create extension if not exists` is a no-op when present).
- Adds `public.trigger_notifications_drain()` — a SECURITY DEFINER plpgsql function that:
  - Reads `notifications_drain_url` and `notifications_worker_secret` from `vault.decrypted_secrets`.
  - No-ops silently when either Vault entry is absent (chassis fails closed during the operator-action window after the migration applies but before Vault is populated).
  - Calls `net.http_post()` to fire the request asynchronously. The function returns immediately; `pg_net` queues the request and lands the response in `net._http_response` if anyone needs to inspect it.
- Revokes execute from public/anon/authenticated; grants only to service_role. pg_cron itself runs as the postgres superuser; the function is the seam.
- Schedules the job: `select cron.schedule('notifications-drain', '* * * * *', $$select public.trigger_notifications_drain();$$);` — every minute. `cron.schedule` upserts on duplicate jobname, so the migration is idempotent.

### `.github/workflows/notifications-drain.yml` demoted to backstop

- Cron changed from `*/5 * * * *` (every 5 min) to `*/30 * * * *` (every 30 min).
- Header comment rewritten to declare it the backstop, with the history of why and reference to F-Wave9-NOTIFICATIONS-DRAIN-PG-CRON-01.
- The endpoint is idempotent (the worker uses a transactional row-lock + `delivered_at IS NULL` filter) so double-firing pg_cron + GH Actions is harmless.

## Why Vault, not `current_setting` or env vars

`current_setting('app.notifications_worker_secret')` reads from `pg_settings`, which is queryable by any authenticated user (`select * from pg_settings`). That would leak the worker secret to any tenant who could craft a query, breaking the constitutional secret-management rule.

Supabase Vault is encrypted at rest with a project-scoped master key, and decryption is gated to the `service_role` JWT (which pg_cron-via-SECURITY-DEFINER inherits). It is the canonical Supabase pattern for cron secrets.

## Operator action required AFTER deploy

The migration applies as part of the normal deploy pipeline. After it lands, the operator must populate Vault once via the Supabase SQL editor (project owner role):

```sql
select vault.create_secret(
  'https://zmnvwhqjahwidprnjxrq.supabase.co/functions/v1/notifications-worker/drain',
  'notifications_drain_url'
);
select vault.create_secret(
  '<WORKER_SECRET value, same one set on Edge Function secrets>',
  'notifications_worker_secret'
);
```

Verification:

```sql
select name from vault.decrypted_secrets where name in (
  'notifications_drain_url', 'notifications_worker_secret'
);
-- expect 2 rows
```

Until both rows exist, `trigger_notifications_drain()` no-ops silently. The 30-minute GitHub Actions backstop continues to deliver in the meantime.

## Verification (what we can check before the operator-action window)

| Gate | Result |
|---|---|
| Migration SQL parses (idempotent re-apply check) | Validates locally; will be enforced again on staging deploy |
| `pnpm --filter web lint` | clean |
| No SPA, edge-function, or test surface changes | confirmed |
| `pnpm test:contract` | untouched (no mirror-paired surface changed) |
| Regression suite | untouched (no handler / mock change) |

## Constitutional invariants verified

| Invariant | Status |
|---|---|
| Forward-only migrations | Yes. Migration is idempotent. DOWN block documented in header (operator-only). |
| RLS Pattern A on notifications | Untouched. The drain function calls the existing /notifications-worker/drain endpoint which already enforces tenant scope per row. |
| Money rules | Untouched. No `_cents` surface changed. |
| Idempotency | The /notifications-worker/drain endpoint is already idempotent (row-lock + `delivered_at IS NULL` filter). Double-firing pg_cron + GH Actions cron is harmless. |
| Audit log | Untouched. Drain runs do not audit-log. |
| Capabilities | Untouched. The new function is service_role-only. |
| Secret handling | Vault used per the canonical Supabase pattern. No plaintext leak via `pg_settings`. |
| Zod canon / Mirror parity | Untouched. |
| Branding | No user-facing copy. |

## Companion follow-ups filed

- **`F-Wave9-PORTAL-EXPIRED-LINK-UX-01`** (spawned from the same incident that motivated this fix): when the URL hash carries `#error=access_denied&error_code=otp_expired` (or `&error_code=otp_invalid`), the SPA should detect it on `PortalRoute` mount and bounce to `/portal/signin` with an inline banner *"Your sign-in link expired. Request a new one."* — instead of rendering the bare portal with `WELCOME, .` empty state. ~30 LOC SPA-only. Deferred to a polish pass.

## Closes

- **`F-Wave9-NOTIFICATIONS-DRAIN-PG-CRON-01`** — primary drain trigger now on Supabase pg_cron; GH Actions retained as 30-min backstop.

## Spawns

- **`F-Wave9-PORTAL-EXPIRED-LINK-UX-01`** as above.
