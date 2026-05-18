# Kitstak Status

Last updated: 2026-05-18

## Current state

Wave 1 shipped and operating in production. Identity, tenancy, and the server-rendered branding system are live, the operator org is seated, and both nightly chain-integrity workflows are wired end-to-end:

- Real Supabase Auth wired on the sign-in surface. `RequireAuth` guards the dashboard route.
- `BrandingProvider` reads `org_branding` for the signed-in user and injects CSS variables on the document root. Tailwind theme tokens resolve through `rgb(var(--x))`, so a runtime branding change repaints without rebuild.
- `provision_organization` RPC seats a new tenant in one transaction: organization row in `provisioning`, owner membership, default branding, owner profile, then status transition to `active` (fires the audit trigger).
- `organizations.status` is the first state machine: `provisioning → active → suspended → archived`. The `audit_organizations_status` trigger writes every transition to `audit_log` with a per-org hash chain.
- `verify_audit_chain(p_org_id)` walks the chain and returns the first broken row. The `audit-chain-verify` Edge Function (deployed, `verify_jwt=false`, bearer-secret auth) is invoked nightly via `.github/workflows/audit-chain-verify.yml` and fails the job if any chain is broken.
- `idempotency-gc` Edge Function sweeps `idempotency_keys` older than 7 days. Scheduled nightly via `.github/workflows/idempotency-gc.yml`.
- `pnpm test:contract` enforces byte parity for `types.ts`, `workflow.ts`, `capabilities.ts`, and `money.ts` between SPA and `_shared`, plus a behaviour parity test for the money helpers.
- SSO/SAML schema landed: `sso_connections` (Pattern A RLS), `saml_configs` (Pattern B RLS). Provider integration deferred.
- Operator org seated: `slug=kitstak`, `display_name=Kitstak`, owner `mike@kitstak.com` bound as `org_owner`. JWT `app_metadata` carries `kitstak_org_id` and `kitstak_org_role` so RLS helpers resolve scope from the first signed-in request.

### Hotfix landed (migration 0003)

`trg_audit_organizations_status` and `verify_audit_chain` were authored with `set search_path = public`, which excluded the `extensions` schema where `pgcrypto.digest()` lives. Surfaced the first time `provision_organization` tried to transition an org from `provisioning → active`. Migration `0003_fix_audit_search_path.sql` fully-qualifies the call as `extensions.digest(...)`. Two `CREATE OR REPLACE` statements; no table or policy changes; chain math unchanged.

## Wave 2 scope

The first lit pillar (3PL Operations chassis). Working capabilities lookup wired to `requireCap`, an org-invitations FSM, and the first state-changing Edge Function exercising idempotency end-to-end.

## Wave 2 prerequisites

- Operator confirms which Wave 2 surfaces are in scope (receiving vs. shipments first).
- Operator rotates the credentials that touched chat during Wave 1 deploy (Vercel token, Supabase access token, DB password, `GC_TRIGGER_SECRET`, `AUDIT_VERIFY_SECRET`).

## Open risks

None open at Wave 1 closeout plus hotfix. Operator follow-ups (`F-Wave1-*`) tracked in `03-workspace/journal/wave-1-identity-branding.md`.
