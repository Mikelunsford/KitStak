# Deploy runbook

Operator runbook for shipping Kitstak to production. Read this before
merging anything that touches a migration or an edge function. The deploy
surface has three independent planes: the SPA on Vercel, the Postgres
schema via migrations, and the Supabase Edge Functions. They are wired so
that schema lands before the function code that depends on it.

## The three deploy planes

### 1. SPA deploy (Vercel)

`deploy-prod.yml` fires on every push to `main`. It runs
`vercel pull`, `vercel build --prod`, then `vercel deploy --prebuilt
--prod`, promoting the new build onto the production alias
(www.kitstak.com).

Two things to know:

- The workflow uses `concurrency: deploy-prod` with
  `cancel-in-progress: false`. Back-to-back merges queue rather than
  race, so the LAST merge wins the alias, never the last build to
  finish.
- Sensitive `VITE_*` env vars (`VITE_POSTHOG_KEY`, `VITE_SENTRY_DSN`)
  are injected from GitHub repo secrets at the build step, not from
  `vercel pull`. Vercel deliberately withholds Sensitive vars from
  `vercel pull` on third-party CI. A var that is Sensitive in Vercel
  but missing as a GitHub repo secret ships into the bundle as
  `undefined` and tree-shakes the code paths that read it.

### 2. Migration apply (Supabase Postgres)

`migrate.yml` fires on push to `main` when files under
`supabase/migrations/**` change. It is forward-only.

- Prod job (`push-migrations`): gated on the `production-db`
  environment. Configure required reviewers in repo Settings ->
  Environments so a human approves before any DDL hits prod. It lists
  pending migrations, runs `supabase db push`, then lists again to
  confirm the final count.
- Staging job (`push-migrations-staging`): runs after prod succeeds,
  no approval gate, `continue-on-error: true`. A staging failure does
  not mark the workflow red because prod has already shipped and
  forward-only migrations cannot be rolled back regardless.
- Both jobs route through the IPv4 session-mode pooler on `:5432`.
  GitHub runners are IPv4-only and the direct `db.<ref>.supabase.co`
  host resolves to IPv6, so the workflow passes `--db-url` on every
  step instead of `supabase link`.

### 3. Edge function deploy (Supabase Edge Functions)

`deploy-functions.yml` has three triggers:

1. Push to `main` on `supabase/functions/**` or `config.toml`. Fires
   immediately for changes that do not touch migrations.
2. `workflow_run` after `migrate.yml` completes successfully on
   `main`. This is the coordination point. Function code that depends
   on new schema deploys only AFTER the matching DDL is live. The
   checkout pins `github.event.workflow_run.head_sha` so the functions
   deployed match the migrations that were just applied. This closes
   the deploy-ordering race.
3. `workflow_dispatch` for manual redeploys.

The bundle list lives in the workflow-level `BUNDLES` env var. It is the
single source of truth read by both the prod job and the staging job, so
the two environments cannot drift. A new edge-function bundle that is not
added to `BUNDLES` never deploys. A new pillar route that returns
CORS or `ERR_FAILED` in the browser is almost always a missing bundle in
this list, not a CORS bug.

## Safe deploy ordering

The workflows already encode the safe order. The key invariant: schema
before the code that reads it.

1. A migration-only PR: `migrate.yml` applies the DDL, then
   `deploy-functions.yml` fires via `workflow_run` against the same
   `head_sha`. The SPA also redeploys via `deploy-prod.yml`.
2. A coordinated migration plus handler PR: merge them together. The
   `workflow_run` gate guarantees the handler bundle deploys after the
   migration applies, never before. Do not split a migration and the
   handler that needs it across two separate merges where the handler
   could land first.
3. A column drop: never drop in the same release that stops using it.
   Relax NOT NULL, redeploy the code that stops reading the column,
   then drop the column one release later. This is the multi-stage
   drop rule from the constitution.

## How to verify a deploy

After a merge to `main`, confirm all three planes are green:

1. Open the Actions tab. `deploy-prod`, `migrate` (if migrations
   changed), and `deploy-functions` should all be green for the merge
   commit. Confirm `deploy-functions` ran against the correct
   `head_sha` when it fired via `workflow_run`.
2. SPA: load www.kitstak.com, hard-refresh, confirm the build is the
   new one (check a changed surface). The production alias should point
   at the latest deploy.
3. Schema: the `migrate` prod job logs the final migration count. It
   should match the highest numbered file under
   `supabase/migrations/`. If a phantom timestamp-style version blocks
   the push, see the MCP `apply_migration` note in the team memory and
   reconcile `schema_migrations` by hand.
4. Edge functions: smoke a route that exercises a changed bundle.
   A 200 with the expected envelope confirms the deploy.
5. Invariants: the nightly probes (`nightly-rls-probe.yml`,
   `audit-chain-verify.yml`, `idempotency-gc.yml`) re-verify RLS, the
   audit hash chain, and idempotency hygiene the next morning. A green
   nightly is the durable confirmation that the deploy did not regress
   a constitutional invariant. See docs/operations/probes.md.

## When a deploy goes wrong

Stop here and switch to docs/operations/incidents.md. It carries the
rollback triggers and the response runbooks for a bad migration, an edge
regression, an RLS leak, and an auth outage.
