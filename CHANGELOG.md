# Kitstak Changelog

All notable changes to Kitstak are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] · Wave 1 Identity, Tenancy, Branding

### Added
- Migration 0002: organizations status FSM (`provisioning, active, suspended, archived`) with auto-state-transition audit trigger writing a per-org hash chain to `audit_log`.
- `provision_organization(slug, display_name, owner_user_id, owner_email)` RPC: atomic tenant seat (organization, profile, membership, branding) culminating in the transition to `active`.
- `verify_audit_chain(org_id)` RPC: returns the first broken row in an org's audit chain or empty if intact.
- `sso_connections` and `saml_configs` tables with RLS (Pattern A and Pattern B). Schema only; provider integration deferred.
- `BrandingProvider` reading `org_branding` and injecting CSS variables on the document root. Tailwind theme tokens (`bg`, `ink`, `accent`) resolve through `rgb(var(--x))`.
- `AuthProvider` plus `RequireAuth` route guard. `SignInPage` now calls `supabase.auth.signInWithPassword` and surfaces server errors inline.
- `idempotency-gc` Edge Function sweeping rows older than 7 days, scheduled nightly via `.github/workflows/idempotency-gc.yml`.
- `audit-chain-verify` Edge Function plus nightly workflow that fails CI if any chain is broken.
- `pnpm test:contract`: byte-parity test for the four canon files (types, workflow, capabilities, money) plus a behaviour parity spec for the money helpers.
- `lib/workflow.ts` and `lib/capabilities.ts` byte-mirrored across SPA and `_shared`.

### Changed
- `organizations.status` check constraint extended to admit `provisioning`.
- Tailwind `bg.DEFAULT`, `ink.DEFAULT`, and `accent.DEFAULT` colors now resolve through CSS variables so runtime branding takes effect without rebuild.
- `styles.css` `:root` declares default CSS variables for the customer-overridable surfaces.
- CI workflow runs `pnpm --filter web test:contract` between `test` and `build`.

## [0.0.1] · Wave 0 Foundation

### Added
- Initial project scaffolding with Vite, React 18, TypeScript strict mode.
- Tailwind CSS configured with the Kitstak design tokens (navy, ink, accent).
- Supabase integration with foundational schema (organizations, roles, org_memberships, profiles, org_branding, org_feature_flags, idempotency_keys, audit_log).
- Row-level security on every tenant-scoped table from migration 0001.
- Idempotency table keyed on `(key, user_id, org_id, route_hash)`.
- Audit log with hash-chain columns from day one.
- Sign in page and authenticated dashboard placeholder.
- Hand-rolled UI primitives: Logo, Button, TextInput.
- Money helpers byte-mirrored across the SPA and the edge runtime, with parity tests scaffolded.
- Shared Zod canon for Org, User, FeatureFlag, AuditEntry, IdempotencyKey, Branding.
- CI/CD workflows for typecheck, lint, build, preview deploys, prod deploys, and migrate.
- Brand bar logo component matching the design system spec.
