# Wave 2 Hotfix: CI pooler hostname, CLI version, bundle list

Date: 2026-05-18
Wave: 2 (post-merge hotfix)
Status: Closed
Branch: `claude/wave-2-ci-hotfix`

## What broke

Two GitHub Actions runs failed within minutes of PR #4 merging to `main`:

1. **`migrate / supabase db push` (run #10)**. Failed at the `List pending migrations` step. The connection string targeted `aws-1-us-west-2.pooler.supabase.com`. Error: `(ENOTFOUND) tenant/user postgres.*** not found (SQLSTATE XX000)`.
2. **`deploy-functions / supabase functions deploy` (run #2)**. Failed at the `Deploy each bundle` step on the first bundle (`audit-chain-verify`). Error: `Failed reading config: Invalid db.major_version: 17.`

A third issue surfaced on review of the same workflow: the BUNDLES array in `deploy-functions.yml` still only listed Wave 1's two scheduled functions; Wave 2's 21 new bundles were not registered for deploy.

A fourth issue (operator-tracked follow-up `F-Wave2-AGENT-A-06`) was bundled into the same hotfix: `tenants-api/resolve-host` must serve pre-auth, which requires `verify_jwt = false` at the bundle level in `supabase/config.toml`.

## Diagnosis

### Pooler hostname

Verified via Supabase Management API (MCP `get_project`):

```
"id":"zmnvwhqjahwidprnjxrq",
"region":"us-west-1",
"database":{"host":"db.zmnvwhqjahwidprnjxrq.supabase.co","version":"17.6.1.121","postgres_engine":"17","release_channel":"ga"}
```

The project lives in `us-west-1`. The canonical session-mode pooler for that region is `aws-0-us-west-1.pooler.supabase.com:5432`. The Track C agent wrote `aws-1-us-west-2.pooler.supabase.com` (both pool number and region wrong; almost certainly carried over from an unrelated TS1 reference). DNS resolves but the pooler does not host this tenant, so the connection fails with `ENOTFOUND tenant/user postgres.***`.

### CLI major-version rejection

`supabase/config.toml` declares `db.major_version = 17`. The remote project is on Postgres 17.6.1.121 (GA channel) per the same MCP probe, so this value matches reality. The CLI version pinned in both workflows was `1.180.0`, which predates Postgres 17 GA support and rejects the config at startup. Bumping the CLI is the right fix; lowering the local config would diverge from the remote.

### Stale BUNDLES list

`deploy-functions.yml` shipped in Wave 1 listed only `audit-chain-verify` and `idempotency-gc`. Wave 2 added 21 bundles. The list needed all 23 entries so each bundle is deployed in order.

### `tenants-api` JWT verification

`docs/api/identity.md` (Agent A) flagged the gap. The `/tenants/resolve-host` route must work pre-auth so the SPA can resolve a custom hostname back to an org before the user signs in. The bundle dispatcher continues to call `requireCaller()` inside the handler for authenticated routes (`/branding`, `/tenants/me`).

## Migration state at fix time

All 37 Wave 2 migrations are already present at the remote in `supabase_migrations.schema_migrations` (verified via MCP `list_migrations`). They were applied through the dashboard / Management API during the operator's prior work, not through `supabase db push`. Once the workflow connection is fixed, `supabase migration list` will report them as `applied`, and `supabase db push` will no-op.

## Changes

- `.github/workflows/migrate.yml`. Pooler hostname `aws-0-us-west-1.pooler.supabase.com` (was `aws-1-us-west-2`). Supabase CLI version `latest` (was `1.180.0`), pinned with an inline comment explaining the PG17 dependency.
- `.github/workflows/deploy-functions.yml`. Same CLI bump. BUNDLES array extended from 2 to 23 entries grouped by Wave 1 scheduled, Wave 2 Agents A through F.
- `supabase/config.toml`. New `[functions.tenants-api]` section with `verify_jwt = false` and an inline comment recording the reason. Closes `F-Wave2-AGENT-A-06`.
- `STATUS.md`, `CHANGELOG.md`, `README.md` refreshed to current state. `00-canon/01-architecture.md` extended with a Canon partition pattern section documenting the byte-mirrored side-car convention introduced in Wave 2.

## Gates expected after this PR merges

- `migrate.yml` next run: connects to the correct pooler, lists 37 applied migrations, push step no-ops, verify step lists the same 37.
- `deploy-functions.yml` next run: starts the CLI on the latest version that accepts `db.major_version = 17`, deploys all 23 bundles sequentially.
- No code changes outside CI and config. `pnpm typecheck`, `lint`, `test`, `test:contract`, `build`, `bundle-budget` all stay green (no SPA, no migration, no edge-handler files touched).

## Risks closed

- **R-W2-HOTFIX-01**: pooler hostname mismatch with project region (CI migrate connection failure).
- **R-W2-HOTFIX-02**: Supabase CLI version predating PG17 GA (CI deploy-functions config-parse failure).
- **R-W2-HOTFIX-03**: deploy-functions BUNDLES array stale (Wave 2 functions would never deploy).
- **F-Wave2-AGENT-A-06** (carry from Wave 2 closeout): `tenants-api` verify_jwt false.

## Follow-ups still open after this PR

- `F-Wave2-CO-01`: pdf-worker render endpoint (operator-approved JS PDF dep).
- `F-Wave2-CO-02`: search-api tsvector + GIN index.
- `F-Wave2-CO-03`: imports-api async + job ledger.
- `F-Wave2-CO-04`: notifications-worker real email / webhook transports.
- `F-Wave2-DNDKIT-01`: add `dnd-kit` to `apps/web/package.json` (Phase 1 oversight).
- `F-Wave2-AGENT-A-05`: Canon Steward merge of domain side-car capabilities into master `_shared/capabilities.ts`.
- `F-Wave2-CRM-01..05`: kanban DnD wire-up, cursored load-more service, ContactCreatePage, ActivityDetailPage, role-type unification.

## Constitutional invariants verified

- Forward-only migrations. Nothing changed in `supabase/migrations/`.
- RLS unchanged. RLS patterns intact.
- Idempotency unchanged. PK shape per D-010 still `(key, user_id, org_id, route_hash)`.
- Audit log unchanged. Hash chain still active.
- Zod canon byte-mirror intact (no canon files touched).
- Bundle budget unchanged at 25.55 kB / 40 kB.
- No banned dependencies.
- No em dashes, double hyphens, or emojis in user-facing copy.
- No "Built to Deliver", "Team 1", or "TS1" in product copy.
- JWT claim shape: `kitstak_org_id`, `kitstak_org_role`.
