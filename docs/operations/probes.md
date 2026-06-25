# Probes and observability runbook

Operator runbook for the three nightly workflows that guard the
constitutional invariants in production. Read this before triaging a
probe failure.

## What the nightly probes do

### nightly-rls-probe

Runs the Playwright spec at `apps/web/playwright/rls-probe.spec.ts` against
the staging Supabase preview branch every day at 09:00 UTC. The spec:

1. Creates two ephemeral orgs (A and B) via the service role and the
   `provision_organization` RPC.
2. Seeds one row per primary entity into org A. The authoritative entity
   set is the one enumerated in `apps/web/playwright/rls-probe.spec.ts`
   itself; read the spec for the current list. The set grows with each new
   tenant-scoped table, so this runbook does not duplicate it (the 3PL
   commercial layer added `three_pl_accounts`, `job_templates`,
   `supply_plans`, `job_runs`, `job_run_daily_logs`, `billing_reviews`; the
   WMS add-on added `warehouse_locations`, `putaway_tasks`, `lots`).
3. Authenticates as the org B owner and asserts every cross-tenant read
   returns 200 plus empty array, every cross-tenant workflow POST returns
   404 (never 403), bundle gates 404 when off, per-route flags return 403
   FEATURE_DISABLED with details.flag set, and Pattern C global tables
   stay readable.
4. Tears down both orgs via service role on the way out.

The spec tags every test with `@rls` so the `pnpm test:rls` script picks
it up. Failure conditions:

- A cross-tenant read returns a row. RLS leak. Release blocker.
- A workflow POST returns 403 where the constitution says 404. Existence
  leak. Release blocker.
- A bundle gate returns 403 or 200 with the flag off. Release blocker.
- A per-route flag returns 200 with the flag off. Release blocker.

### audit-chain-verify

Hits the `audit-chain-verify` edge function nightly. The function calls
the Postgres `verify_audit_chain(org_id)` helper across every active org
and returns a JSON envelope with `broken_count` plus per-org details.
Anything other than `broken_count: 0` is an alert.

Two pre-0085 residue breaks are baselined out of `broken_count` and
reported separately under `baselined` (see `BASELINED_BROKEN_IDS` in the
edge function): one in the internal "Kitstak" org (2026-05-22) and one in
"Cowork Smoke Test Co." (2026-05-27). Both predate migration 0085 (audit
chain same-transaction ordering), live in internal and smoke orgs not a
customer org, and cannot be repaired without rewriting append-only
audit_log history. Baselining keeps the alert meaningful: a new break is
an id not in that set, so `broken_count` goes above zero and the job
fails. If you ever need a clean slate, retire the two source orgs rather
than mutating audit_log.

### idempotency-gc

Hits the `idempotency-gc` edge function nightly. The function deletes
`idempotency_keys` rows older than seven days. The endpoint always
returns 200 with the deleted-row count; there is no failure mode worth
alerting on beyond a non-200 response (handled by the workflow's curl
exit code).

## How to read a failure

### nightly-rls-probe failed

1. Open the failed run from the Actions tab.
2. Download the `playwright-rls-report` artifact. It contains the full
   Playwright HTML report plus traces.
3. Read the first failure. The assertion message tells you which
   invariant tripped. Common signatures:
   - `gate-miss MUST 404, never 403` -> a workflow POST returned 403
     instead of 404. Look at the route's handler for an `ApiError(...,
     403, ...)` where the row lookup should 404 instead.
   - `RLS leak: cross-tenant <table> read returned rows` -> the RLS
     policy on `<table>` is missing or wrong. Inspect the migration that
     created the table; check the policy uses
     `org_id = public.current_org_id()`.
4. The fixture teardown is best-effort. If the run died mid-setup, look
   for `rls_probe_org_*` rows in `organizations` and clean them up by
   hand. The fixture suffix is `YYYYMMDD_xxxxxx` so they are easy to
   spot.

### audit-chain-verify failed

1. The workflow logs the JSON envelope. `broken_count > 0` means one or
   more orgs have a hash-chain break NOT in the baseline. The envelope
   lists which under `broken` (the two known residue rows appear under
   `baselined` and never count toward `broken_count`).
2. A break means an `audit_log` row was tampered with, deleted, or
   inserted out of band of the trigger. This is a constitutional
   emergency: the audit log is append-only via RLS, so the most likely
   cause is direct service-role access that bypassed the trigger. Open
   the operator playbook.

### idempotency-gc failed

1. The workflow only checks the HTTP status. A non-2xx means the edge
   function is unhealthy. Check the Supabase function logs.
2. Idempotency rows are GC'd weekly only for hygiene; a single missed
   night does not affect correctness.

## How to re-run on demand

Each workflow exposes `workflow_dispatch`. From the Actions tab:

1. Open the workflow run page (e.g. nightly-rls-probe).
2. Click the "Run workflow" dropdown.
3. Pick the `main` branch and confirm.

The same env-gating applies: a re-run skips cleanly if the staging
secrets are unset.

## Staging secret list

All three workflows live under the `staging` GitHub Actions environment.
Source the values from the Supabase CLI:

```
supabase branches get staging
```

Required secrets:

| Secret | Source | Used by |
|---|---|---|
| `STAGING_SUPABASE_URL` | `db_url` of the staging branch | nightly-rls-probe |
| `STAGING_SUPABASE_ANON_KEY` | `anon_key` of the staging branch | nightly-rls-probe |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | `service_role_key` of the staging branch | nightly-rls-probe |
| `STAGING_URL` | Vercel preview URL for the staging branch | nightly-rls-probe (PLAYWRIGHT_BASE_URL), smoke spec |
| `AUDIT_VERIFY_SECRET` | shared secret stamped into the edge function | audit-chain-verify |
| `SUPABASE_FUNCTION_URL` | `${STAGING_SUPABASE_URL}/functions/v1` | audit-chain-verify, idempotency-gc |
| `GC_TRIGGER_SECRET` | shared secret stamped into the edge function | idempotency-gc |

Optional (smoke spec only):

| Secret | Source | Used by |
|---|---|---|
| `SMOKE_USER_EMAIL` | staging seed | smoke spec |
| `SMOKE_USER_PASSWORD` | staging seed | smoke spec |
| `SMOKE_SECONDARY_ORG_NAME` | staging seed | smoke spec (org-switch leg) |

## How the workflows skip

When a staging secret is absent the nightly-rls-probe workflow emits a
notice ("STAGING_SUPABASE_URL not configured ... Skipping nightly RLS
probe") and exits 0. The probe spec itself also calls `test.skip` with a
clear message at the suite level if any of the three Supabase secrets
are missing, so a partial wire-up (e.g. `STAGING_URL` set but
`SUPABASE_SERVICE_ROLE_KEY` empty) still skips cleanly rather than
red-failing.

The audit-chain-verify and idempotency-gc workflows use curl with the
shared secrets; if either secret is missing the curl call exits non-zero
and the workflow fails. This is intentional: those two workflows must
either be fully configured or removed from the schedule.

## When to escalate

- Two consecutive nightly-rls-probe failures with the same assertion.
- Any `broken_count > 0` from audit-chain-verify.
- Any non-2xx response from idempotency-gc for more than one night.

Escalation path: file a release-blocker issue, page the on-call operator,
and pull the relevant migration plus handler for the failing route.
