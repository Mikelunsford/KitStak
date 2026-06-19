# Incident runbook

Operator runbook for production incidents. Read the rollback triggers
before you deploy, not during the fire. Then use the per-class response
runbooks below. Each class has a detection signal, an immediate
mitigation, the rollback steps, and the post-incident follow-up.

Pair this with docs/operations/deploy.md (the deploy planes and safe
ordering) and docs/operations/probes.md (how to read a nightly probe
failure).

## Rollback triggers (write these before you deploy)

Decide the abort line before the deploy, not after. Roll back or halt if
any of these is true after a deploy to prod:

- A cross-tenant read returns another org's rows, or a cross-tenant
  workflow POST returns 403 where the constitution requires 404. This is
  a release blocker by definition.
- `audit-chain-verify` reports `broken_count` greater than 0 for any
  org. The append-only audit log has been violated.
- A migration failed mid-apply, or applied DDL that the running code
  cannot tolerate (a column the code still reads is gone, a NOT NULL
  the code still violates).
- An edge function bundle returns 5xx, or a route that worked before
  the deploy now returns CORS or `ERR_FAILED` in the browser.
- Login fails for real users (auth/login outage).
- A P0 customer-facing surface is down with no workaround.

The SPA and edge planes roll forward fast (redeploy the prior commit).
The schema plane is forward-only and cannot be rolled back: a bad
migration is fixed with a NEW forward migration, never by editing or
reverting an applied file.

## Class A. Cross-tenant RLS leak

Detection signal:

- `nightly-rls-probe.yml` fails and opens an `incident` / `probe-failure`
  issue. The assertion names the table and the violated invariant
  (`RLS leak: cross-tenant <table> read returned rows`, or
  `gate-miss MUST 404, never 403`).
- A customer reports seeing data that is not theirs.

Immediate mitigation:

- Treat as a release blocker. If a recent deploy introduced the leaking
  table or policy, roll the SPA and edge planes back to the prior commit
  to stop new writes against the broken surface.
- If the leak is read-only and contained to one route, you may disable
  the offending per-route feature flag (returns 403 FEATURE_DISABLED)
  while the policy is fixed.

Rollback steps:

- The leak is almost always a missing or wrong RLS policy on the table.
  Open the migration that created the table. Confirm the policy uses
  `org_id = public.current_org_id()` (Pattern A), the correct parent
  join (Pattern B), or `USING (true)` only for a true global table
  (Pattern C).
- Fix forward: write a new numbered migration that adds or corrects the
  policy. Never edit the applied file. Apply via `migrate.yml`.
- Re-run `nightly-rls-probe.yml` via `workflow_dispatch` against staging
  to confirm the probe matrix is green before declaring the incident
  closed.

Post-incident follow-up:

- Add the table to the probe matrix in
  `apps/web/playwright/rls-probe.spec.ts` if it was not already covered.
- File a regression probe entry so the exact leak cannot recur silently.

## Class B. Bad or failed migration on prod

Detection signal:

- The `migrate.yml` prod job (`push-migrations`) fails, or the final
  migration-count step shows the push did not complete.
- Post-deploy, the running code errors against the schema (a column it
  reads is gone, a constraint it violates).

Immediate mitigation:

- Migrations are forward-only. Do NOT edit or delete the applied
  migration file and do NOT attempt a manual down-migration on prod.
- If the new schema is incompatible with the running code, roll the SPA
  and edge planes back to the commit that matches the prior schema to
  stop the errors while you write the fix.

Rollback steps:

- Write a NEW forward migration that corrects the state (re-add a
  dropped column, relax a too-strict constraint, repair data). Give it
  the full header (Wave, Phase, Closes, DOWN MIGRATION block, date
  stamp, constitutional alignment) and make the DDL idempotent.
- Apply via `migrate.yml`. Confirm the prod job's final migration-count
  step matches the highest numbered file.
- If a phantom timestamp-style version in `schema_migrations` blocks the
  push (the MCP `apply_migration` gotcha), reconcile the row by hand:
  `UPDATE supabase_migrations.schema_migrations SET version = 'NNNN'`
  where the version matches the 14-digit timestamp pattern.

Post-incident follow-up:

- If the failure was a multi-stage-drop ordering mistake, document the
  correct relax -> redeploy -> drop sequence in the migration header.
- Confirm staging reconciled (the `push-migrations-staging` job runs
  `continue-on-error`, so a silent staging failure can leave drift;
  re-run it via `workflow_dispatch` if needed).

## Class C. Edge-function regression

Detection signal:

- A route returns 5xx, or a previously working pillar route returns CORS
  or `ERR_FAILED` in the browser.
- Sentry shows a spike in edge-function errors.

Immediate mitigation:

- If a route returns CORS / `ERR_FAILED` right after adding a new
  bundle, the bundle is almost certainly missing from the `BUNDLES`
  list in `deploy-functions.yml`, so it never deployed. Add it and
  redeploy. This is a deploy gap, not a CORS bug.
- For a regression in an existing bundle, redeploy the prior good commit
  of that bundle via `deploy-functions.yml` `workflow_dispatch`, or roll
  `main` back to the prior commit to trigger a full redeploy.

Rollback steps:

- Identify the commit that last had the route healthy. Re-run
  `deploy-functions.yml` against that ref (the checkout honors the
  `workflow_run` head_sha; for a manual dispatch it uses `github.sha`).
- Confirm the bundle deployed: the deploy step logs `Deploying <bundle>`
  per entry and a final count.

Post-incident follow-up:

- If the regression slipped past CI, note that
  `deno check` in `ci.yml` typechecks every bundle entry point but does
  not run the function. Add or extend a contract or e2e probe for the
  route if the failure was behavioral.
- Confirm the bundle is in `BUNDLES` so prod and staging stay in sync.

## Class D. Auth / login outage

Detection signal:

- Real users cannot log in. The SPA lands users in a NO_ACTIVE_ORG
  state, or auth calls return 401/500.
- Sentry shows an auth-flow error spike.

Immediate mitigation:

- Confirm scope. Check Supabase Auth status for the prod project and the
  `auth-api` edge bundle health. A Supabase platform incident is
  upstream; post status and wait it out rather than deploying.
- If a recent deploy broke the SPA auth path or the `auth-api` bundle,
  roll the SPA and edge planes back to the prior commit immediately.
  Login is a P0 surface.

Rollback steps:

- For a broken `auth-api` bundle, redeploy the prior good commit via
  `deploy-functions.yml`.
- For a broken SPA auth path, roll `main` back to the prior commit so
  `deploy-prod.yml` promotes the working build onto the alias.
- A common provisioning failure mode: a fresh user lands in
  NO_ACTIVE_ORG because `provision_organization` did not stamp the auth
  metadata. Confirm the provisioning path stamps the active org on the
  user.

Post-incident follow-up:

- If the outage was a missing auth-metadata stamp on provisioning, file
  a regression test that asserts a freshly provisioned user has an
  active org.
- Confirm the auth secrets and any SSO IdP configuration are intact.

## Escalation and tracking

- The nightly `nightly-rls-probe.yml` and `audit-chain-verify.yml`
  workflows open a durable GitHub issue labeled `incident` /
  `probe-failure` on any failure. Triage from that issue; it links the
  failing run and the relevant runbook.
- Escalate per docs/operations/probes.md: two consecutive probe failures
  with the same assertion, any `broken_count` greater than 0, or any P0
  surface down. File a release-blocker issue and pull the relevant
  migration plus handler for the failing route.
- A failed probe night also breaks the v1 "30 consecutive green nights"
  gate on RLS and the audit hash chain. Note the broken streak in the
  incident issue so the gate clock is tracked honestly.
