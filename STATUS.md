# Kitstak Status

Last updated: 2026-05-17

## Current state

Wave 0 shipped. The Kitstak application is scaffolded with:

- Vite plus React 18 plus TypeScript strict.
- Tailwind CSS with the full design system tokens.
- Supabase foundational schema and row-level security.
- Sign in page and an authenticated dashboard placeholder.
- CI/CD pipelines scaffolded for typecheck, lint, build, preview, prod, and migrate.

## Wave 1 scope

Identity, tenancy, and the server-rendered branding system. The multi-tenant whitelabel architecture comes online here. Real auth wiring, BrandingProvider with CSS-variable runtime injection, `provision_organization` RPC, and the SSO/SAML schema land in Wave 1.

## Wave 1 prerequisites

- Wave 0 closeout journal merged.
- Operator confirms the demo org name (placeholder: "Acme Corp" per the planning record).
- Stripe decision remains deferred per the planning record.

## Open risks

None at Wave 0 closeout.
