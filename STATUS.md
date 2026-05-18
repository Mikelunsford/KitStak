# Kitstak Status

Last updated: 2026-05-17

## Current state

Wave 1 shipped. Identity, tenancy, and the server-rendered branding system are live:

- Real Supabase Auth wired on the sign-in surface. `RequireAuth` guards the dashboard route.
- `BrandingProvider` reads `org_branding` for the signed-in user and injects CSS variables on the document root. Tailwind theme tokens resolve through `rgb(var(--x))`, so a runtime branding change repaints without rebuild.
- `provision_organization` RPC seats a new tenant in one transaction: organization row in `provisioning`, owner membership, default branding, owner profile, then status transition to `active` (fires the audit trigger).
- `organizations.status` is the first state machine: `provisioning → active → suspended → archived`. The `audit_organizations_status` trigger writes every transition to `audit_log` with a per-org hash chain.
- `verify_audit_chain(p_org_id)` walks the chain and returns the first broken row. A nightly GitHub Actions workflow invokes the `audit-chain-verify` Edge Function across every active org and fails the job if any chain is broken.
- `idempotency-gc` Edge Function sweeps `idempotency_keys` older than 7 days. Scheduled nightly.
- `pnpm test:contract` enforces byte parity for `types.ts`, `workflow.ts`, `capabilities.ts`, and `money.ts` between SPA and `_shared`, plus a behaviour parity test for the money helpers.
- SSO/SAML schema landed: `sso_connections` (Pattern A RLS), `saml_configs` (Pattern B RLS). Provider integration deferred.

## Wave 2 scope

The first lit pillar (3PL Operations chassis). Working capabilities lookup wired to `requireCap`, an org-invitations FSM, and the first state-changing Edge Function exercising idempotency end-to-end.

## Wave 2 prerequisites

- Wave 1 closeout journal merged.
- Operator confirms which Wave 2 surfaces are in scope (receiving vs. shipments first).
- Operator rotates `GC_TRIGGER_SECRET` and `AUDIT_VERIFY_SECRET` into GitHub Actions secrets.

## Open risks

None open at Wave 1 closeout. Operator follow-ups (`F-Wave1-*`) tracked in the closeout journal.
