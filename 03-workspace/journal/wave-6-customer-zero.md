# Wave 6 Closeout: Customer Zero chassis fixes

Date: 2026-05-18
Wave: 6 (Phase 6 of the parallel build orchestration)
Status: Partially closed (chassis gaps fixed; operator quote-to-cash exercise pending)
Branches: `claude/phase-6-customer-zero`, `claude/phase-6-cors-apikey`, `claude/phase-6-sidebar-paths`, `claude/phase-6-sidebar-expand`

## Wave summary

Phase 6 opened with the operator signing in to `www.kitstak.com` to exercise the
Pillar-1 quote-to-cash flow against the seeded `kitstak` org. The first click
surfaced the Topbar rendering "No workspace" despite the prod DB carrying the
correct organization, user `app_metadata` JWT claims, and `org_memberships` row.
A four-hotfix iteration loop landed all the foundational SPA -> edge-function
wiring gaps that Wave 5's probe matrix could not have caught (the probes hit
edge functions directly with a service-role JWT, bypassing the SPA's
`apiClient`).

After the four hotfixes plus one operator-data fixup (seeding feature flags for
the `kitstak` org since `seed_org_settings` post-dates the org's Wave 1
provisioning), the SPA loads, authenticates, resolves the active workspace,
and surfaces the full Pillar-1 navigation. The quote-to-cash workflow exercise
itself is pending in a follow-up session.

## Hotfixes shipped

### Hotfix 1: apiClient wires Supabase functions URL + auth headers (PR #13)
Commit `6540819`. Closes `F-Wave6-API-01`.

`apps/web/src/lib/apiClient.ts` called `fetch(path, init)` with the relative
path `/auth-api/me`. Vercel's catch-all SPA rewrite (`/(.*) -> /index.html`)
returned `index.html`, `response.json()` rejected, the call silently failed,
`useMe()` left `memberships=[]`, Topbar rendered "No workspace". Same gap
applied to every service module (~40 services calling `/<bundle>-api/*`). The
Phase 5 probe matrix could not catch this because it hits Supabase functions
directly via the service-role JWT, bypassing `apiClient`.

Fix: `apiClient` now prepends `VITE_SUPABASE_URL + '/functions/v1'` to any
non-absolute path, attaches `apikey: VITE_SUPABASE_ANON_KEY` (Supabase gateway
routing requirement), and attaches `Authorization: Bearer <access_token>` from
`supabase.auth.getSession()` when a session exists. Falls back to the anon
Bearer otherwise so `verify_jwt = false` bundles (`tenants-api/resolve-host`,
`notifications-worker`, `admin-console-api`) still resolve pre-auth.

### Hotfix 2: CORS allow-headers includes apikey (PR #14)
Commit `7f9acb5`. Closes `F-Wave6-API-02`. Spawns `F-Wave6-CORS-01`.

After hotfix 1 the SPA's authenticated calls now reached the Supabase functions
gateway, but browser preflight `OPTIONS` rejected every request because
`Access-Control-Allow-Headers` did not list `apikey`. All 12 console errors the
operator saw on hotfix 1 deploy were CORS preflight rejections.

Fix: add `apikey` to the allow-headers list in both `_shared/cors.ts` (the
`handlePreflight` 204 path) and `_shared/responses.ts` (the `CORS_HEADERS`
stamped on every `ok()` / `fromApiError()` body). Both lists are independently
consulted by the browser depending on which response is in flight.

Drift noted: the two lists have diverged over time (`cors.ts` lists
`x-request-id` and `x-worker-secret`; `responses.ts` does not). Tracked as
`F-Wave6-CORS-01` follow-up; not fixed in this hotfix to keep the surface
tight.

### Operator data fixup: `seed_org_settings` + flag flips (no PR)
Direct SQL on prod via Supabase MCP. The `kitstak` org was provisioned during
Wave 1 (hotfix codified in migration 0003), before Wave 2 migration 0040
shipped `seed_org_settings`. The function never fired retroactively against
the operator's seed org, so `org_feature_flags` was empty for
`org_id = ba4622dd-eb46-41b6-b2dd-95c922bf44dd`.

Actions taken:
1. `select public.seed_org_settings('ba4622dd-...')` to insert the 10 default
   flag rows (all `is_enabled = false`).
2. `UPDATE` to enable: `plugins.three_pl`, `feature.collaboration`,
   `feature.global_search`, `feature.imports`, `feature.exports`.
3. `INSERT ON CONFLICT` to enable `finance.journal_entries.enabled` (not in
   the seed's 10-flag default list).

Result: Pillar 1 lit for the operator's org. Pillars 2-5 stay off per the wave
plan ("Pillar 1 lit; Pillars 2-3 plumbed; Pillars 4-5 post-v1"). Customer
portal off because the operator is staff, not `customer_user`.

### Hotfix 3: Sidebar 3PL pillar paths match routes table (PR #15)
Commit `94b4d01`. Closes `F-Wave6-NAV-01`. Spawns `F-Wave6-NAV-02`,
`F-Wave6-NAV-03`.

Sidebar pointed Pillar 1 children at `/three-pl/receiving` and
`/three-pl/shipments`, but the flat ROUTES table registers them under
`/3pl-operations/receiving` and `/3pl-operations/shipments` (matching the
`apps/web/src/pages/3pl-operations/` folder convention from Wave 2 domain
ports). Clicking either child rendered `/404`.

Fix: align the two Sidebar entries to the route paths. One file, two-line
diff.

### Hotfix 4: Sidebar adds Workspace + Sales + Procurement + Inventory + Finance + Tools + Admin sections (PR #16)
Commit `a91b0f9`. Closes `F-Wave6-NAV-03`.

The pre-Phase-6 Sidebar surfaced only Dashboard + 5 pillars (with 1-2 children
each). Customers, Quotes, Invoices, Vendors, Items, etc. existed in the flat
ROUTES table (67 routes total) but were unreachable except by URL bar.
Phase 6 quote-to-cash needs all of them.

Refactor: unify the section type into one `NavSection` interface with optional
`flag?: string`. Split into `CORE_SECTIONS` (always rendered) and
`PILLAR_SECTIONS` (flag-gated, same disabled-state UI as before). Render with
the same expand/collapse + localStorage persistence pattern; section keys are
unique so existing user state survives.

Core sections added:

| Section | Children | Gate |
|---|---|---|
| WORKSPACE | Customers, Leads, Opportunities | none |
| SALES | Quotes, Projects, Invoices, Payments, Credit notes | none |
| PROCUREMENT | Vendors, Purchase orders, Vendor bills, Expenses | none |
| INVENTORY | Items, Warehouses, Stock levels, Stock movements | none |
| FINANCE | Chart of accounts, Journal entries, Period close | `finance.journal_entries.enabled` |
| TOOLS | Search, Imports, Exports | none |
| ADMIN | Settings, Branding, Feature flags, Numbering | route-level `AdminProtectedRoute` |

3PL Operations gained Production runs as a third pillar child to round out the
receiving / production / shipments triad. Other pillars unchanged (still
flag-off for the `kitstak` org).

## Risks closed

- `F-Wave6-API-01`: apiClient relative-URL + missing auth-header bug. Every
  service call silently rendered the SPA's index.html.
- `F-Wave6-API-02`: CORS `Access-Control-Allow-Headers` missing `apikey`.
  Browser preflight blocked every authenticated request.
- `F-Wave6-NAV-01`: Sidebar pillar paths drifted from routes table.
- `F-Wave6-NAV-03`: Sidebar surfaced only pillars; core CRUD nav unreachable.

## Follow-ups spawned

- `F-Wave6-CORS-01`: consolidate the two CORS allow-headers lists by having
  `responses.ts` import from `cors.ts`. Deferred to Phase 7 polish.
- `F-Wave6-NAV-02`: align other pillar child paths (`/manufacturing/*`,
  `/copack/*`, `/kitforce/*`, `/kitcost/*`) when those pillars light up.
- `F-Wave6-FLOW-01`: operator-led quote-to-cash exercise on prod. The chassis
  is now wired; the actual workflow validation is the remaining Phase 6 gate.

## Follow-ups carried (from prior waves)

- `F-Wave5-TEST-02`: dry-run smoke selectors against live staging once the
  quote-to-cash exercise starts.
- `F-Wave5-CO-01`: Sentry SPA + edge-function capture (blocked on
  `VITE_SENTRY_DSN`).
- `F-Wave5-CO-02`: analytics provider (operator-deferred).
- `F-Wave2-AGENT-A-05`: operator-gated merge of domain side-car capabilities
  into the master byte-mirrored `_shared/capabilities.ts`.
- `F-Wave2-CO-01`: pdf-worker real render with operator-approved JS PDF dep.
- `F-Wave2-DNDKIT-01`: `dnd-kit` install + phase-reorder UI.

## Canon Steward work this wave

1. Verified all 22 byte-mirrored canon pairs untouched. `pnpm test:contract`
   25 / 25 across every gate run.
2. Resolved a workflow-branch rebase trap: branches off stale `origin/main`
   missed prior hotfixes; protocol going forward is to `git fetch origin main`
   then `git rebase origin/main` before adding new commits, especially during
   a multi-hotfix iteration sequence.
3. Brand grep on every changed file: zero violations.

## Gates verified (final state on main at `a91b0f9`)

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | clean |
| `pnpm --filter web typecheck` | zero errors |
| `pnpm --filter web lint` | zero warnings, zero errors |
| `pnpm --filter web test` | 5 / 5 |
| `pnpm --filter web test:contract` | 25 / 25 |
| `pnpm --filter web build` | succeeds |
| `pnpm --filter web bundle-budget` | **28.57 kB / 40 kB** (up 2.63 kB from 25.94) |
| Brand validation greps on changed files | zero violations |

The 2.63 kB bundle delta breaks down approximately as:
- apiClient session refresh + URL build logic: ~0.14 kB
- 24 additional lucide-react icon imports (tree-shaken): ~2.49 kB

## Constitutional invariants verified

- Money: untouched; mirror parity 25 / 25.
- RLS: unchanged.
- Migrations: forward-only invariant intact; no migrations authored this wave.
- Audit log: hash chain, auto-state-transition triggers, entity_type CHECK all
  from Wave 2 remain in force.
- Idempotency: every non-GET in `apiClient` still attaches `Idempotency-Key`
  via `crypto.randomUUID()`. PK shape `(key, user_id, org_id, route_hash)` per
  D-010 unchanged.
- Capabilities: server-side gates unchanged. Sidebar admin section visibility
  is not the security boundary; `AdminProtectedRoute` enforces at the page.
- Workflow: 14 state machines unchanged.
- Branding: zero em dashes, double hyphens, "Built to Deliver", "Team 1", or
  "TS1" in user-facing copy across changed files. Section labels in the
  expanded Sidebar use Bebas Neue tracking-wider (font-display) matching the
  existing pillar labels.
- Bundle budget: 28.57 kB gzip against the 40 kB cap.
- Zod canon: 22 byte-identical pairs intact.
- JWT claim shape: `kitstak_org_id` / `kitstak_org_role` unchanged.
- No banned dependencies introduced.

## Lessons for future operator-led phases

1. **The probe matrix verifies edge functions in isolation, not the SPA-edge
   integration.** Wave 5's 48 / 48 green probe run proved that every route
   answers correctly when called directly with a valid JWT. It could not
   surface that the SPA was not calling those routes correctly. Phase 6 is
   the first time anything exercised the full SPA -> edge round-trip from a
   real browser session, which is why four chassis bugs surfaced in rapid
   succession.
2. **CORS allow-headers drift is a recurring trap.** Two independent lists
   (`cors.ts` and `responses.ts`) drifted before anyone noticed. Consolidating
   them is `F-Wave6-CORS-01`.
3. **`seed_org_settings` does not retroactively fire against orgs created
   before migration 0040.** The `kitstak` org's flag rows were empty until
   manually seeded. Either Wave 7 should ship a backfill migration, or
   `provision_organization` should call `seed_org_settings` going forward
   (it may already; this needs verification).
4. **Operator-led phases need a "first click" smoke check before any deep
   workflow exercise.** All four hotfixes this phase could have been caught
   by a single authenticated `useMe()` round-trip from a real browser. Phase 7
   should land an automated smoke test that runs against staging on every PR.

## Notes for Phase 7 (Stabilization)

- The Phase 6 gate ("operator successfully exercises the full Pillar-1
  workflow on prod, every state-change writes audit_log, no 500s") is NOT yet
  met. The chassis is wired; the workflow exercise is the next step.
- Phase 7's first task is closing Phase 6's remaining workflow exercise. Only
  then does Phase 7 move on to its own scope (burn-down of remaining
  `F-Wave*` follow-ups, E2E coverage polish per `DEFINITION-OF-DONE.md`,
  `V1-SHIP-REPORT.md`).
- The operator's keys file remains at
  `C:\Users\Mike Lunsford\Desktop\KitStak\Docs\SUPABASE ENV.MD`. Read once
  per session; never echo to disk.
