# Drift Audit: Tech-Debt slice

Date: 2026-05-18
Auditor: Tech-Debt Auditor (read-only)
Slice: code-level drift (TODO/FIXME, near-duplicates, banned-dep slip, test gaps, dead code, missing abstractions)

## Status: YELLOW

No constitutional violations found in this slice. Banned-dep ESLint policy is holding (no imports from antd, radix, redux, zustand, jotai, recoil, react-hook-form, formik, dayjs, date-fns, moment, lodash, axios, uuid pkg, next, remix, gatsby anywhere in `apps/web/src` or `supabase/functions`, and none declared in any `package.json`). TODO surface is unusually low for a six-wave codebase (five live markers total).

The headline finding is **a real behavior bug**: `RequireFlag` has been fail-open since Wave 1, and `notifications-worker` marks email and webhook channels delivered without sending them. Both are written to ship intentionally as stubs, but the stubs have now outlived their stated wave by five releases (Wave 2 → Wave 6 + Phase 6 chassis). The bigger structural debt is **server-side test coverage**: 23 edge functions in production, zero unit/integration tests for any of them — only two contract parity tests and two Playwright specs (smoke + RLS probe) backstop the entire backend. And there is one obvious-and-cheap **abstraction win** sitting in plain sight: thirteen `require<X>Cap` clones across thirteen bundles, each three lines, each doing the same `policy[role]?.includes(cap) || throw FORBIDDEN` shape, while a generic `requireCapWith` would absorb all of them.

## Top 10 findings (severity x blast radius)

| # | Severity | Category | Location | Description | Fix est | Blast radius |
|---|----------|----------|----------|-------------|---------|--------------|
| 1 | YELLOW | dead-code / stale-stub | `apps/web/src/components/shell/RequireFlag.tsx:35-39` | `RequireFlag` guard hard-codes `flagsLoaded=true, flagOn=true` with a Wave-2 TODO; has been fail-open through Waves 2-6. SPA never gates per-route flags client-side — relies entirely on BE 403 reaching `FeatureUnavailablePage`. Constitution requires the SPA to mirror the policy for button-hiding parity. | S | Every flag-gated route (3PL, manufacturing, copack, kitforce, kitcost addons). Operator-visible only if they toggle a flag off and expect the SPA to hide the surface immediately. |
| 2 | YELLOW | test-gap | `supabase/functions/*` (23 bundles) | Zero Deno unit tests in any edge-function bundle. Only contract tests are `apps/web/test/contract/{money.parity, parity}.test.ts`. Idempotency replay, RLS scoping, FSM gates, currency snapshot, hash-chain triggers — none exercised in CI outside the nightly Playwright RLS probe. | L | All non-GET routes. A regression in `parseBody`, `respondWithIdempotency`, or any FSM transition lands silently until QA. |
| 3 | YELLOW | abstraction-missing | `supabase/functions/{crm-api,invoicing-api,quotes-api,projects-api,finance-api,vendors-api,inventory-api,admin-console-api,auth-api,settings-api,tenants-api,ops-api,collaboration-api}` | 13 near-identical `require<X>Cap` / `requireIdentityCap` / `requireVioCap` / `requireFinanceCap` / `requireSalesCap` / `requireCrmCap` / `requireCrossCap` functions, all the same 3-line `policy[role]?.includes(cap) ?: throw FORBIDDEN` shape. Generic `requireCapWith<Pol,Cap>(policy, caller, cap)` in `_shared/handler-helpers.ts` would absorb all of them. | S | All state-changing handlers. Refactor risk is contained (callsites are trivially adapted) but landing changes one bundle at a time is safe. |
| 4 | YELLOW | dead-code / silent-failure | `supabase/functions/notifications-worker/index.ts:25-46` | `deliverChannel()` returns `true` for `channel='email'` and `channel='webhook'` without sending. The worker then stamps `delivered_at`, silently clearing the queue. A `console.warn` is logged but nothing surfaces operator-side. | M | Anyone enabling email/webhook notifications post-Wave-6. Today's blast radius is small only because no transports are wired. Hardens to a data-loss bug the moment a customer turns these channels on. |
| 5 | YELLOW | TODO / stale | `apps/web/src/lib/hooks/useSwitchOrg.ts:20` + `apps/web/src/components/shell/Topbar.tsx:18` | TODO says "auth-api/sessions/switch-org ships in Wave 2" but the endpoint shipped (`supabase/functions/auth-api/index.ts:200, 279`). The Wave-1 comment block in Topbar still warns operators the mutation is a no-op. Stale doc, not stale code. | XS | Documentation only. Confuses any maintainer reading the file. |
| 6 | YELLOW | abstraction-missing | `supabase/functions/{crm-api,invoicing-api,vendors-api,inventory-api,...}/handlers/*.ts` | `listOrgScoped` / `getByIdOrgScoped` exist in `vendors-api/shared.ts` and `inventory-api/shared.ts` but are not re-exported from `_shared/handler-helpers.ts`. CRM, invoicing, finance, projects handlers re-implement the same cursor + `eq('org_id', caller.orgId)` + soft-delete + paginate dance per resource (e.g. `crm-api/handlers/customers.ts:72-...`). | M | Every list/detail handler. Refactor would shrink ~3-5 lines per route and centralize the soft-delete + ordering convention. |
| 7 | INFO | abstraction-redundant | `apps/web/src/lib/hooks/*.ts` (~20 files) | Many hooks redundantly re-declare `staleTime: 30_000, refetchOnWindowFocus: false, retry: 1` even though `main.tsx:14-22` already sets them globally on the `QueryClient`. `useCustomers.ts:13` declares only `staleTime`; `useVendors.ts:13-16` declares all three. No behavior difference, but the pattern drift signals nobody's sure where the defaults live. | XS | Read-only. Pure DRY clean-up. |
| 8 | YELLOW | TODO / stale | `apps/web/src/styles.css:15` | TODO references `F-Wave1-FONTS-01` (drop woff2 files in). Wave 1 closed in `wave-1-foundation-completion.md`. Either ship the follow-up or archive it. | XS | Branding/font loading. Today fonts presumably load via CDN/system fallback. |
| 9 | INFO | duplicate-zod-shape | `apps/web/src/lib/apiClient.ts:14-26` vs `supabase/functions/_shared/responses.ts` | `EnvelopeSchema` / `ErrorEnvelopeSchema` shapes are restated client-side rather than shared. Constitution covers byte-mirror for `types.ts` and `money.ts` only; envelope schema is intentionally restated, but worth flagging because a drift here would silently break every response parse on the SPA. | XS | Every API call. Currently aligned; no live drift. |
| 10 | INFO | dead-code / orphan-risk | `apps/web/src/lib/types.ts` + `apps/web/src/lib/types/{crm,sales,finance,identity,cross_cutting,vendors_inventory_ops}.ts` | The flat `types.ts` is the byte-mirrored canon (constitution); the `types/*` side-car set is the per-domain canon. Both shapes are real and intentional, but there is no header comment in `types.ts` pointing at the side-cars (or vice versa). A new contributor will not know whether to extend the flat or the domain file. Sub-INFO: same shape for `workflow.ts` + `workflow/*.ts` and `capabilities.ts` + `capabilities/*.ts`. | XS | New contributors. Pure docs hygiene. |

## Out of scope (handed off elsewhere in this dispatch)

- Constitutional invariant verification (money, RLS, idempotency, audit_log, capability shape) → PM Architect.
- Security posture, secret hygiene, RLS probe results, audit-chain integrity → Security Reviewer.
- Bundle size, query plans, N+1 risk, TanStack Query timing → Performance Engineer.

## Trend note

Compared to a hypothetical Wave-3 audit (no prior tech-debt journal exists to diff against), the codebase has held a remarkably clean TODO surface — five markers across the entire repo. The cap-helper duplication is the only structural debt that has compounded across waves; every new bundle since Wave 2 has added another clone. Recommend addressing #3 before another wave (Phase 6 chassis) lands another clone, and addressing #2 (server-side tests) before #1 / #4 / #6 mutate into regressions.

## Recommended top 3 to schedule

1. **Item #3 (cap-helper consolidation)**: smallest fix with the broadest payoff. One PR. Lands in `_shared/handler-helpers.ts` as a generic `requireCapWith<P, C>(policy, caller, cap)`, replaces 13 sites.
2. **Item #1 (`RequireFlag` fail-open)**: blocks the SPA from honoring per-route flag policy. Needs `useOrgFlags()` to be the source of truth; if that hook ships data, the fix is a 10-line edit to the guard. Constitutional alignment for "SPA mirrors role policy for button-hiding".
3. **Item #2 (zero edge-function unit tests)**: at least one Deno test per bundle covering the happy POST + the idempotency-replay path + the FORBIDDEN path. Phase-6-sized scope, but every wave we defer raises the regression surface area.

Deferred to future sweeps: the long tail of per-handler list/get duplication (#6) — fold into the cap-helper PR or treat as a Phase 6 cleanup wave.
