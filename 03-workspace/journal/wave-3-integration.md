# Wave 3 Closeout: Integration

Date: 2026-05-18
Wave: 3 (Phase 3 of the parallel build orchestration)
Status: Closed
Branch: `claude/funny-lamport-360f5c`

## Wave summary

Single-agent integration pass on top of the Wave 2 domain ports. Three follow-ups closed
(`F-Wave2-API-03`, `F-Wave2-BUILD-01`, the Playwright config scaffold), one new global
ErrorBoundary mounted, and the AuditTimeline component pulled through every detail page
that has a state machine. The smoke and RLS Playwright specs land as runnable scaffolds
that `test.skip` until Phase 5 wires staging Supabase secrets. The 40 kB gzip bundle budget
holds at 25.94 kB.

## Deliverables

### Sidebar gates moved off the stub

- `apps/web/src/components/shell/Sidebar.tsx` no longer uses `useOrgFlagsStub()`. New
  helper at `apps/web/src/lib/hooks/useOrgFlags.ts` wraps `useFlags()` and reduces the
  `OrgFeatureFlag[]` response to `Record<string, boolean>` keyed by `flag_key`. Re-exported
  through `apps/web/src/lib/hooks/index.ts`. Sidebar reads the live flag map and treats an
  absent key as off, matching the bundle-gate-off semantic.
- Closes `F-Wave2-API-03`.

### Global ErrorBoundary

- New class component at `apps/web/src/components/shell/ErrorBoundary.tsx`. Catches
  render-time errors anywhere below the App tree. Fallback is brand-clean ("SOMETHING WENT
  WRONG. Refresh to try again. RELOAD"), keyboard-reachable, and reload via
  `window.location.reload()`. Dev builds log to `console.error`; production stays quiet.
- Mounted in `apps/web/src/main.tsx` between `AuthProvider` and `<App />`. Router and auth
  state remain catchable by the App's existing Suspense fallback for lazy chunks.

### NotFoundPage dual-import warning fixed

- `apps/web/src/App.tsx` no longer imports `NotFoundPage` statically. The `*` wildcard
  route now `Navigate`s to `/404`, which already maps to the lazy `NotFoundPage` from
  `routes.ts`. Vite no longer reports the static-plus-dynamic chunk warning.
- Closes `F-Wave2-BUILD-01`.

### AuditTimeline mounted on every state-having detail page

Ten detail pages received an `AuditTimeline` section. All thirteen state-having detail
pages now render the same heading style (`text-2xl font-display tracking-wide text-ink
mb-3` followed by `<AuditTimeline entityType="..." entityId={id} />`):

| Domain | Page | `entityType` |
|---|---|---|
| Sales | `QuoteDetailPage` | `quote` |
| Sales | `ProjectDetailPage` | `project` |
| Vendors | `PODetailPage` | `purchase_order` |
| Vendors | `VendorBillDetailPage` | `vendor_bill` |
| Vendors | `ExpenseDetailPage` | `expense` |
| Ops | `ReceivingOrderDetailPage` | `receiving_order` |
| Ops | `ProductionRunDetailPage` | `production_run` |
| Ops | `ShipmentDetailPage` | `shipment` |
| CRM | `LeadDetailPage` | `lead` |
| CRM | `OpportunityDetailPage` | `opportunity` |

The three pre-existing mount sites (`InvoiceDetailPage`, `CreditNoteDetailPage`,
`JournalEntryDetailPage`) are unchanged. Canon Steward normalized the new sections to
match the original heading style.

### Playwright scaffolds

- `apps/web/playwright.config.ts`: Chromium-only, `testDir: './playwright'`, baseURL from
  `process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173'`, retries 0 in dev / 1 in
  CI, `webServer` runs `pnpm dev` locally and is undefined in CI.
- `apps/web/playwright/smoke.spec.ts`: `@smoke`-tagged single test walking the v1 Pillar-1
  happy path as `test.step` calls (signin, switch org, customer, quote send / accept,
  convert to project, invoice send, payment post, receiving, shipment, audit verify).
  Each step is a `await expect(page).toHaveURL(/.*/)` placeholder. The whole spec
  `test.skip`s when `PLAYWRIGHT_BASE_URL` or `STAGING_SUPABASE_URL` are absent.
- `apps/web/playwright/rls-probe.spec.ts`: `@rls`-tagged placeholder that `test.skip`s with
  "RLS probe wires in Phase 5".

### Branding / useMe gating verification

- `BrandingProvider` calls `useBranding({ enabled: isAuthed })` already (Wave 2). No
  changes required.
- `Topbar` calls `useMe({ enabled: isAuthed })` already (Wave 2). No changes required.
- The catalyst's "flip the gate" language refers to the prior Wave-1 default of
  `enabled: false`. That default lives in the hook itself for the benefit of unit tests
  and other callers; the live callers (BrandingProvider, Topbar) already pass
  `enabled: true` once authenticated.

## Canon Steward work this wave

1. Verified all 22 byte-mirrored canon pairs untouched. `pnpm test:contract` 25 / 25.
2. Normalized AuditTimeline section heading on the ten new detail pages from
   `text-xl ... mb-2` to `text-2xl ... mb-3` to match the three pre-existing mount sites.
3. Ran the full gate matrix (see Gates verified below).
4. Brand-grep validation on every changed file: zero violations. The single `TS1` hit in
   the broader repo (`apps/web/src/lib/types/finance.ts:241`) is an internal-doc citation
   to the reference codebase and is constitutionally allowed per `REBRAND-MAP.md` §10.

## Gates verified

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | clean |
| `pnpm --filter web typecheck` | zero errors |
| `pnpm --filter web lint` | zero errors, zero warnings |
| `pnpm --filter web test` | 5 / 5 |
| `pnpm --filter web test:contract` | 25 / 25 (4 singular + 18 side-car + 3 money) |
| `pnpm --filter web build` | succeeds in 8.03s, no warnings |
| `pnpm --filter web bundle-budget` | **25.94 kB / 40 kB** |
| Brand validation greps on changed files | zero violations |
| TS1 read-only zone | untouched |

## Risks closed

- `F-Wave2-API-03`: `useOrgFlagsStub` replaced by live `useOrgFlags()`.
- `F-Wave2-BUILD-01`: NotFoundPage static-plus-dynamic Vite warning eliminated by single
  lazy chunk plus a `Navigate to="/404"` wildcard.
- Phase 3 charter items: AuditTimeline mounting across all thirteen state-having detail
  pages; global ErrorBoundary mounted; Playwright config scaffolded.

## Follow-ups (Wave 4 and beyond)

- `F-Wave3-TEST-01`: wire real Playwright smoke assertions to staging Supabase (requires
  `PLAYWRIGHT_BASE_URL` plus `STAGING_SUPABASE_URL` / anon / service-role keys per D-009).
  Phase 5.
- `F-Wave3-TEST-02`: implement the real RLS probe matrix (cross-tenant returns 200 + [];
  per-route flag misses return 403 FEATURE_DISABLED; plugin bundle gates return 404).
  Phase 5.
- `F-Wave3-OBS-01`: Sentry SPA init. Operator-gated on `VITE_SENTRY_DSN`. Phase 5 or
  later.
- `F-Wave3-AGENT-A-05` (carried from Wave 2): merge domain side-car capabilities into the
  singular `_shared/capabilities.ts`. Operator-gated; deferred.
- `F-Wave3-DNDKIT-01` (carried from Wave 2): install `dnd-kit` and refit the project-phase
  reorder UI. Operator-gated; deferred to Phase 6.
- `F-Wave3-CO-01` (carried from Wave 2): pdf-worker real render with an operator-approved
  JS PDF dep. Operator-gated; deferred to Phase 6.

## Constitutional invariants verified

- Money: untouched; mirror parity 25 / 25.
- RLS: `AuditTimeline` reads `audit_log` through the supabase client with the caller's
  JWT, inheriting the append-only role-gated policy from Wave 2.
- Migrations: forward-only invariant intact; no migrations authored this wave.
- Audit log: hash chain, auto-state-transition triggers, and entity_type CHECK extension
  all from Wave 2 remain in force; this wave only adds read surfaces.
- Idempotency: no new mutations; PK shape `(key, user_id, org_id, route_hash)` per D-010
  unchanged.
- Capabilities: server is authority; SPA mirror for button hiding only.
- Workflow: 14 state machines unchanged.
- Branding: zero em dashes, double hyphens, "Built to Deliver", "Team 1", or "TS1" in
  user-facing copy across changed files. ErrorBoundary fallback ("SOMETHING WENT WRONG /
  Refresh to try again. / RELOAD") is brand-clean.
- Bundle budget: 25.94 kB gzip against the 40 kB cap.
- Zod canon: 22 byte-identical pairs intact.
- JWT claim shape: `kitstak_org_id` / `kitstak_org_role` unchanged.
- No banned dependencies introduced.

## Notes for Phase 4 dispatch

- Phase 4 is the marketing site at `www.kitstak.com`. Operator decision needed before
  dispatch: sibling repo `kitstak/marketing` versus routed static path under the existing
  Vercel project (`project-8d8cx`).
- Phase 5 (Probes) is the next phase that needs the operator to provision the staging
  Supabase preview branch secrets per D-009.
