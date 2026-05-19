# Drift Audit — Consolidated Punch List — 2026-05-18

Status: **YELLOW**

First multi-agent dispatch through the agent kit. Four parallel read-only audits (Tech Debt, PM Architect, Security Reviewer, Performance Engineer) ran against the codebase post-Wave-6-close. No RED findings, no release-blockers. Security is **GREEN**: idempotency, audit chain, RLS posture, no service-role smuggling, no banned-dep imports, no committed secrets. The three other audits returned YELLOW with concrete remediations.

Individual journal entries:
- `2026-05-18-drift-tech-debt.md`
- `2026-05-18-drift-pm-architect.md`
- `2026-05-18-drift-security.md` (GREEN)
- `2026-05-18-drift-performance.md`

## Priority-ordered punch list

Ranked by severity × blast radius × proximity to Customer Zero (the current operational milestone). Items toward the top hurt soonest.

### Tier 1 — pre-Customer-Zero (real risk if a first paying customer onboards before these are fixed)

| ID | Finding | Owner |
|----|---------|-------|
| R-Wave6-PERF-01 | Three `inventory-api` list endpoints (`/warehouses`, `/stock-levels`, `/bom-items`) return every row in the tenant with no `.limit()` and no cursor. YELLOW today, **RED the moment a tenant has 500+ SKUs**. Convert to `parseLimit` + `paginate` per `_shared/handler-helpers.ts`. | Backend Engineer (inventory) |
| R-Wave6-PERF-02 | `limit+1` overflow pagination is broken across `quotes-api:43`, `projects-api:52`, 9 endpoints in `sales-config-api` via `genericList:134-135`, and `listExchangeRates:322`. Always returns `next_cursor: null`. Clients cannot page past page 1. | Backend Engineer |
| F-Wave6-NOTIF-01 | `notifications-worker` (`supabase/functions/notifications-worker/index.ts:25-46`) marks email and webhook channels as `delivered_at` while only `console.warn`-ing. Silent data loss the moment a customer enables these channels. | Backend Engineer |

### Tier 2 — first-week-post-launch hygiene

| ID | Finding | Owner |
|----|---------|-------|
| R-Wave6-PERF-03 | `dashboard-api/index.ts:31-51` `sumColumn` pulls every open-invoice row to the edge function and sums in TypeScript. Should be a Postgres RPC (`org_ar_balance(uuid) returns bigint`). Slow as AR scales. | Migrations Engineer |
| F-Wave6-FLAG-01 | `apps/web/src/components/shell/RequireFlag.tsx:35-39` is fail-open since Wave 1. SPA never gates per-route flags client-side; relies entirely on BE 403. Stub has outlived its wave by 5 releases. | Frontend Engineer |
| F-Wave6-CAP-01 | Capability shape drift: `finance.ts` uses 2-part `&lt;resource&gt;.&lt;action&gt;` (`invoices.read`); `sales.ts` mixes 3-part `quotes.quote.read` with 2-part `quotes.send`/`quotes.accept`. Constitution mandates `&lt;domain&gt;.&lt;resource&gt;.&lt;action&gt;`. Either rename in a single forward PR or amend the constitution via R-01. | PM Architect → Backend Engineer |
| F-Wave6-MIG-01 | Migration numbering has holes: sequence runs `0001..0004, 0007..0041`. Slots `0005` and `0006` never existed in git history. Backfill no-op migrations or document the gap as canonical. | Migrations Engineer |

### Tier 3 — structural debt (do during a refactor sweep, not urgent)

| ID | Finding | Owner |
|----|---------|-------|
| F-Wave6-ABS-01 | 13 near-identical `requireCap` clones across edge bundles. Land a generic `requireCapWith&lt;P,C&gt;` in `_shared/handler-helpers.ts`. | Backend Engineer |
| F-Wave6-TEST-01 | Zero unit/integration tests across 23 edge bundles. Only `money.test.ts` + 2 contract parity + 2 Playwright back the entire backend. Idempotency replay, FSM gates, currency snapshot, hash chain — all uncovered. | QA Engineer |
| F-Wave6-WIRE-01 | `bigintReplacer` defined in both `_shared/money.ts:32` and `apps/web/src/lib/money.ts:32` but never wired. `apiClient.ts:79` calls `JSON.stringify(options.body)` with no replacer; no edge handler uses it either. Today money fits in JS safe-integer range so nothing breaks. Either wire it or remove from constitution. | Backend Engineer |
| F-Wave6-PERF-05 | `ops-api` list endpoints hard-cap at `.limit(200)` with no cursor → silent truncation at row 201. | Backend Engineer |

### Tier 4 — hardening (defense-in-depth, no current exposure)

| ID | Finding | Owner |
|----|---------|-------|
| F-Wave6-SEC-01 | No explicit `REVOKE INSERT/UPDATE/DELETE ON audit_log FROM authenticated`. RLS-policy-absence works today, but a future permissive policy could chain-poison. Add forward migration with explicit REVOKE. | Security Reviewer → Migrations Engineer |
| F-Wave6-SEC-02 | Cron-worker bearer-secret comparisons use `!==` (direct equality) in `notifications-worker:60`, `audit-chain-verify:22`, `idempotency-gc`. Replace with `crypto.timingSafeEqual`. | Security Reviewer |
| F-Wave6-SEC-03 | `Access-Control-Allow-Origin: *` in `_shared/cors.ts:15`. Token-bearer APIs aren't CSRF-vulnerable; tightening to a Vercel-prod + preview + localhost allowlist is free hardening. | Security Reviewer |
| F-Wave6-PERF-04 | Lighthouse CI is gated by `vars.LIGHTHOUSE_ENABLED == 'true'` which is unset. LCP/CLS/TBT budgets in `.lighthouserc.cjs` are not gating PRs. Flip the variable once Vercel preview Deployment Protection has a bypass token. | Operator + DevOps |

### Tier 5 — cleanup / cosmetic

| ID | Finding | Owner |
|----|---------|-------|
| F-Wave6-DOC-01 | Stale TODO in `apps/web/src/lib/hooks/useSwitchOrg.ts:20` + `apps/web/src/components/shell/Topbar.tsx:18` claims `/auth-api/sessions/switch-org` "ships in Wave 2" — endpoint already exists at `supabase/functions/auth-api/index.ts:200,279`. | Docs Writer / inline fix |

### INFO items (record only)

- RLS probe matrix at `apps/web/playwright/rls-probe.spec.ts` doesn't directly probe child tables (`*_line_items`, `*_versions`, `stock_movements`). Covered transitively via Pattern B parent-row inheritance.
- Confirm nightly RLS probe green streak out-of-band: `gh run list --workflow=nightly-rls-probe.yml --limit 5` (Security Reviewer was sandboxed off `gh`).

## Healthy / not at risk

- **Money**: byte-identical parity confirmed by `apps/web/test/contract/money.parity.test.ts` in CI.
- **RLS**: 66 tenant-scoped tables → 66 RLS-enabled (1:1). Patterns A/B/C documented in canon. Cross-tenant 404 fix from migration 0041 established the canonical pattern (pass `caller.orgId` explicitly).
- **Idempotency**: PK `(key, user_id, org_id, route_hash)`; body hash uses RFC 8785 canonical JSON + SHA-256; 24h window; 409 on mismatch; nightly GC.
- **Audit log**: hash chain trigger-side with `pg_advisory_xact_lock`; 15 state-machine triggers; `verify_audit_chain` walker + nightly verify workflow.
- **Capabilities**: enforced on every sampled non-GET handler. 204 `requireCaller` call sites across 35 files. No service-role smuggling.
- **Zod canon**: 4 singular + 18 side-car pairs asserted byte-identical in CI.
- **Bundle gate**: 40 kB gzip ceiling on index chunk, enforced on every PR via `pnpm --filter web bundle-budget`.
- **TanStack Query**: configured byte-perfect against constitution (`staleTime 30_000`, `refetchOnWindowFocus false`, `retry 1`).
- **Lazy routes**: every route in `apps/web/src/routes.ts` is lazy-loaded with React.lazy + Suspense.
- **Banned deps**: zero imports anywhere. ESLint `no-restricted-imports` wired at error severity.
- **Secrets hygiene**: `.gitignore` covers `.env*` with `!.env.example` allowlist; only `.env.example` tracked.
- **Branding**: zero em dashes, zero emojis, brand tokens match canon (navy `#0a1628`, ink `#f5f1e8`, accent `#c8102e`).

## Recommended next dispatches

In order of payoff:

1. **Tier 1 bundle** (one dispatch, three findings): fix inventory pagination, fix limit+1 overflow pagination across 12 endpoints, fix notifications-worker silent delivery. Single Backend Engineer dispatch, possibly with Migrations Engineer if `inventory` indexes need adjusting. Frame as `F-Wave7-PAGE-01` + `F-Wave6-NOTIF-01`. **Estimated work: 1-2 cycles. Highest pre-Customer-Zero value.**

2. **F-Wave6-CAP-01 + F-Wave6-MIG-01** as a paired chassis cleanup: capability shape rename + migration numbering decision. Either backfill 0005/0006 as no-op forward migrations or amend constitution. Single PM Architect dispatch to ratify, then Backend + Migrations to execute. **1 cycle.**

3. **F-Wave6-TEST-01** as a sustained QA Engineer dispatch: add at least one integration test per edge bundle covering the FSM transitions, idempotency replay, and currency-snapshot invariants. Not a one-shot — propose as a Wave 7 thread that runs in parallel with feature work. **3-5 cycles, parallel to Tier 1 work.**

4. **Tier 4 hardening bundle**: audit_log REVOKE migration + timingSafeEqual swap + CORS allowlist tightening + Lighthouse CI flip. Single Security Reviewer + Migrations Engineer + DevOps dispatch. **1 cycle.**

## Carried YELLOWs from kit-health.md (separate from this audit)

These persist independently and were not re-scored by this drift audit:
- 9 gate-dictionary gaps (promote agent-owned CI gates into `02-DEFINITION-OF-DONE.md`)
- 2 placeholder hygiene items in `_AGENT-CONFIG-TEMPLATE.md`
- G.1 multi-tenant-without-Whitelabel (acknowledged)
