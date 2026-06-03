# Kitstak End-to-End Wire Map and Security Audit

Date: 2026-06-03
Method: 23-agent multi-pass audit. Six parallel layer mappers (288 components, 201 edges), six parallel security lenses (41 findings), adversarial verification of every CRITICAL and HIGH finding (10 verified, 0 fully refuted, several severities corrected down), one synthesis pass.
Scope: SPA (Vite + React 18, 511 source files), 28 Edge Function bundles, 88 migrations / 74 tables, CI/CD, secrets, and the seven constitutional non-negotiables.

## Posture grade: B-

Strong, disciplined chassis. RLS, money, audit, capability, and idempotency primitives are all sound. The grade is held down by one CRITICAL cross-tenant write in payment and credit-note allocation, plus a cluster of HIGH operational and integrity gaps (dead audit-chain and GC workers, a period_close audit omission, imports mass-assignment). Closer to sellable v1 than to a rewrite.

## Executive summary

The chassis is genuinely strong. A flat ROUTES table with four guard types feeds a strictly layered SPA transport (hooks to services to a single apiClient), which fans into 28 table-driven Edge bundles that enforce a disciplined ordered chain at every write: bundleGate 404, requireCaller 401 or NO_ACTIVE_ORG, requireCap 403, requireFlag 403 FEATURE_DISABLED, respondWithIdempotency, then service-role queries with explicit org_id scoping into RLS-protected Postgres with database-owned audit and state triggers.

The money chassis is constitutionally clean: byte-mirrored money.ts with roundHalfEven, BIGINT cents on the wire, server-authoritative line math that ignores client totals, and parity tests as release blockers. RLS is enabled on every tenant table from creation. audit_log is append-only with a centralized sequence-ordered hash chain. The capability matrix has no over-broad grants (viewer, customer_user, and vendor_user are read-only, and admin.* caps are granted to no role).

However, the audit surfaced one genuinely serious cross-tenant write. payment-apply and credit-note-apply accept an attacker-controlled invoice_id in the allocation body and never verify the invoice belongs to the caller's org, so an org-A finance user can mutate org-B invoices (paid_cents, status to paid, paid_at) and inject a forged row into org-B's append-only audit chain through org-unfiltered SECURITY DEFINER recompute triggers.

Several constitutional maintenance guarantees are also dead in production. The audit-chain-verify and idempotency-gc workers are deployed with verify_jwt=true but authenticate via static bearer secrets, so the platform gateway 401s every invocation. 279 idempotency rows sit past retention (GC has never run), the nightly chain probe never executes, and 2 of 4 prod orgs already carry broken chain links with nothing watching. period_close is a registered FSM but emits no audit row (confirmed live: one real production period close with zero audit trace and a NULL actor).

Input handling has two real defects: imports-commit mass-assignment (raw rows inserted, attacker can set id, status, paid_cents, deleted_at within their own org) and PostgREST .or() cursor filter injection across nine list handlers (within-tenant only, org_id stays AND-ed). Error-detail leakage echoes raw Postgres messages on roughly 20 INTERNAL_ERROR sites, defeating part of the D2 remediation. Money has two real integrity gaps: payment and credit-note allocations have no over-allocation ceiling so invoice balances go silently negative, and a credit note can be over-applied beyond its own value.

The verify_jwt=false bundles trust unverified base64-decoded JWT claims, but the realized blast radius is org branding and profile disclosure only (admin routes are inert stubs), so that lands at MEDIUM after verification.

## 1. The wire map (the spine, shared by all pillars)

```
Browser
  |
  | Supabase JS SDK: getSession() + onAuthStateChange
  v
AuthProvider (auth/AuthContext.tsx:42)            [discriminated AuthState: loading|authenticated|unauthenticated]
  |
  v
React Router flat ROUTES table (routes.ts:802)    [155+ RouteSpec; withPluginGate() auto-injects requiresPlugin
  |                                                 for /3pl-operations|/manufacturing|/copack|/kitforce|/kitcost]
  v
App.tsx wrapWithGuard  (ORDER IS LOAD-BEARING)
  |
  +-- [1] AUTH GUARD (outermost)
  |      ProtectedRoute (auth) / AdminProtectedRoute (auth + useMe role) / PortalRoute (auth + customer_user) / public
  |      |  unauth -> /signin (preserves from-path)
  |      |  hasActiveOrgClaim(user) reads app_metadata.kitstak_org_id (SERVER-controlled, synchronous, no API)
  |      |     -> missing -> NoActiveOrgPage inline   [INVARIANT: server-controlled claim, never user_metadata]
  |      v
  +-- [2] RequirePlugin (RequirePlugin.tsx:35)
  |      reads useOrgFlags() -> GET /settings-api/flags
  |      flag absent/false -> NotFoundPage (404, NEVER redirect)   [INVARIANT: 404 mirrors Edge bundleGate]
  |      v
  +-- [3] SubscriptionGate (useSubscriptionGate.tsx:87)  [protected + admin leaves only; portal EXEMPT by design]
  |      lapsed trialing -> /admin/billing?gated=true (allowlist: /admin/billing,/signin,/signout,/account/*)
  |      v
  +-- AppShell + page element

  ... user action fires a mutation/query ...
  v
TanStack Query hook (lib/hooks/use*.ts)            [QUERY_DEFAULTS: staleTime 30s, refetchOnWindowFocus false, retry 1]
  v
Typed service (lib/services/*.ts)                  [Zod Schema.parse on every response at the service boundary]
  v
apiClient.ts apiRequest (line 56)
  |  supabase.auth.getSession() -> fresh JWT (anon key fallback)
  |  headers: apikey + Authorization Bearer + content-type
  |  non-GET -> Idempotency-Key = crypto.randomUUID()  *** FRESH PER CALL, client retries NOT deduplicated ***
  v
HTTPS POST/GET https://<supabase>/functions/v1/<bundle>/<path>
  |
  v
[Supabase Edge gateway]  verify_jwt=true for 24 bundles (validates JWT signature)
  |                       verify_jwt=false for 4: notifications-worker, tenants-api, admin-console-api, stripe-webhook
  v
_shared/route.ts route() (line 119)                [strip /functions/v1/<bundle> prefix; OPTIONS inline;
  |                                                  405 method-miss; 404 no-match; non-ApiError -> opaque 500 (D2) + Sentry]
  |
  +-- (8 pillar bundles + admin) serveBundleWithGate (bundleGate.ts:136)
  |      getFlag(orgId, flagKey | OR flagKeys[])  [5-min per-instance cache, FAIL-CLOSED]
  |      all flags off -> 404 NOT_FOUND   [INVARIANT: 404 not 403; misconfig fails closed 404; OPTIONS bypasses]
  |      v
  +-- handler
        |
        +-- requireCaller (tenant.ts:113)          [decodes JWT app_metadata claims. DECODE ONLY, no sig verify]
        |     no JWT -> 401 UNAUTHORIZED; no org -> 401 NO_ACTIVE_ORG; no role -> 403 FORBIDDEN
        |
        +-- requireCap(caller, cap) (handler-helpers.ts) [403 FORBIDDEN; on EVERY state-changing route]
        |     [INVARIANT: server is authority; SPA capabilities.ts is button-hiding mirror only]
        |
        +-- requireFlag/requireFinanceJeFlag (per-route)  [403 FEATURE_DISABLED {flag}; only finance.journal_entries live]
        |
        +-- FSM state guard (STATE_CONFLICT 409 BEFORE any DB call)  [copack/ops/mfg/kitforce/quotes/projects]
        |
        +-- respondWithIdempotency (idempotency.ts)   [non-GET; RESERVE-BEFORE-EXECUTE:
        |     validate Idempotency-Key UUIDv4 (400 if bad), route_hash + body_hash (RFC8785),
        |     INSERT ON CONFLICT DO NOTHING claim PK (key,user_id,org_id,route_hash),
        |     same key + diff body -> 409 IDEMPOTENCY_CONFLICT, execute, persist (fail-closed 500)]
        |
        +-- admin() SERVICE-ROLE client (handler-helpers.ts)  [BYPASSES RLS]
        |     EVERY query adds explicit .eq('org_id', caller.orgId)  [Pattern A, convention, not type-enforced]
        |
        v
      Postgres
        |  RLS enabled on every tenant table from migration 0001 (defense-in-depth; service-role bypasses by design)
        |    Pattern A: org_id = current_org_id() + role | Pattern B: parent-join EXISTS | Pattern C: USING(true)
        |  current_org_id()/current_user_role() = SECURITY DEFINER STABLE, read JWT app_metadata
        |
        +-- audit triggers (SECURITY DEFINER, per-org advisory lock, seq-ordered hash chain via kitstak_audit_chain_head)
        |     [INVARIANT: audit_log append-only. SELECT-only RLS, ZERO insert/update/delete policy]
        |
        +-- state-machine triggers (AFTER UPDATE OF status/stage/state) -> audit + emit stock_movements / advance parent / auto-JE
```

### Per-pillar deltas

All pillars ride the spine above. The pillar-specific deltas are the bundle gate, the service file, and the DB triggers.

3PL Operations (plugins.three_pl): ops-api (shipments, receiving, production-runs, FSM, stock-movement emit triggers), inventory-api (warehouses, stock-levels RO, bom-items), quotes-api (quotes, line-items, QUOTE_FSM, convert-to-project), projects-api (projects, phases, FSM, convert-to-invoice). Cross-pillar finance utilities (invoicing-api, vendors-api, finance-api) carry NO bundle gate (see gaps).

Manufacturing (plugins.manufacturing): manufacturing-api (runs, consumed/produced line-items, MANUFACTURING_RUN_FSM, emit-movements on complete). crm-api and sales-config-api share an OR gate of [three_pl, manufacturing, copack_ecom].

Co-Pack and Ecom (plugins.copack_ecom): copack-api (47 routes: sales_channels, sales_orders + lines, kitting_jobs + consumed/produced, fulfillments pick/pack/ship, warehouses RO; emit-movements on kitting complete; advance-order on fulfillment ship).

KitForce (plugins.kitforce): kitforce-api (members, teams, shifts FSM, assignments FSM, time-entries clock-in/out; rate columns stripped unless org_owner/accounting; GET /members/:id/rate gated kitforce.member.read_rate).

KitCost (plugins.kitcost): dashboard-api GET /kitcost/summary (read-only aggregate, no writes; KitCostDashboardPage lazy-loads recharts into its own chunk).

Customer Portal (no plugin gate; PortalRoute guard): customer-portal-api (verify_jwt=true, all GET; requireCaller, gatePortal 404 if role is not customer_user, resolveCustomerId; Pattern B org + customer scoping). Sign-in via auth-api /portal/request-signin-link (public, anti-leak 200, no rate limit).

### Where each constitutional invariant is enforced

| Invariant | Enforcement point | Status |
|---|---|---|
| Money = BIGINT cents, roundHalfEven, no floats on wire | CentsSchema, DollarInput parser, server line math recompute, money.ts byte-mirror + parity tests | HOLDS (one DB convert path uses half-up: LOW) |
| RLS on every tenant table from 0001 | migrations; current_org_id()/current_user_role() SECURITY DEFINER | HOLDS (defense-in-depth; service-role bypasses by design) |
| Cross-tenant read 200+[]; workflow POST 404; plugin gate 404; route flag 403 | RLS filters, parent-resolve-scoped-by-org, bundleGate.ts:159, requireFlag.ts | HOLDS where checked; nightly probe unverified live |
| Idempotency: non-GET enforces key, RESERVE-BEFORE-EXECUTE | idempotency.ts; respondWithIdempotency | HOLDS server-side; client mints fresh key per call; GC dead |
| Audit append-only, hash chain from 0001, triggers on every FSM | audit_log SELECT-only RLS + SECURITY DEFINER triggers + seq | VIOLATED for period_close (confirmed live) |
| Capabilities: requireCap on every state-changing handler | handler-helpers.ts requireCap; 8 roles, ~218 caps | HOLDS (admin.* granted to no role) |
| Zod canon + money byte-identical SPA to _shared | parity.test.ts + money.parity.test.ts (release blockers) | HOLDS |

## 2. Confirmed connections (the live wiring)

- SPA routing and guards: BrowserRouter, QueryClientProvider, AuthProvider, ErrorBoundary, App, BrandingProvider. wrapWithGuard applies auth guard first, then RequirePlugin (404 on missing flag), then SubscriptionGate (protected/admin only, portal exempt). Flat ROUTES table is single source of truth; withPluginGate() auto-injects requiresPlugin for the five pillar path prefixes. hasActiveOrgClaim reads server-controlled app_metadata.kitstak_org_id synchronously.
- SPA data transport: pages to TanStack Query hooks (staleTime 30s, refetchOnWindowFocus false, retry 1) to typed services (Zod parse at boundary) to apiClient.apiRequest (fresh JWT per call, fresh Idempotency-Key per non-GET) to fetch. Two documented bypasses: exportsService uses window.location.assign (no auth headers), auditService reads audit_log directly via PostgREST.
- Edge dispatch and gates: every bundle calls route() (table-driven, strips prefix, 405/404/opaque-500). Eight pillar bundles plus admin-console-api gate via serveBundleWithGate or inline assertBundleEnabled (single flag or OR flagKeys, 404 fail-closed). Four bundles run verify_jwt=false (notifications-worker via X-Worker-Secret, tenants-api public resolve-host, admin-console-api, stripe-webhook via HMAC). Chain order: requireCaller, requireCap, requireFlag, FSM 409, respondWithIdempotency, admin() with explicit org_id.
- Shared primitives: 20 _shared modules. route.ts, bundleGate.ts, tenant.ts (decode-only), handler-helpers.ts, idempotency.ts (reserve-before-execute), feature-flags.ts (5-min fail-closed cache), audit.ts (no exports, DB-only writes), capabilities/money/types/constants (byte-mirrored to SPA), numbering.ts (advisory-lock RPC), responses.ts (opaque 500), cors.ts (ALLOWED_ORIGINS), sentry.ts (PII scrub).
- Database schema and triggers: 88 migrations, 74 tables, RLS from creation. Audit hash chain centralized via kitstak_audit_chain_head + seq (0085); 23 audit writers; 25 FSM status triggers + 18 created-symmetry triggers. Stock-movement emit triggers, fulfillment advance-order, payment/credit-note recompute, auto-JE, period-close-rejection guard. Money everywhere BIGINT _cents; rate_e9 BIGINT for FX.
- CI/CD and scheduled jobs: ci.yml gates push/PR (typecheck, lint with no-restricted-imports, script checks, Vitest unit/regression/contract parity, build, size-limit). deploy-prod.yml (Vercel), deploy-functions.yml (28 bundles prod then staging), migrate.yml (forward-only). Four scheduled workers: audit-chain-verify, idempotency-gc, nightly-rls-probe, notifications-drain.
- Secrets and observability: 6 VITE_ build-time vars (2 required throw at init; PostHog/Sentry optional). Server secrets via Vault. No hardcoded secrets committed; service-role key never in the SPA bundle. Sentry and PostHog identity is opaque UUID with IP-relay suppression.

## 3. Vulnerability register (verified)

### CRITICAL

1. Cross-tenant invoice write via attacker-controlled invoice_id in payment-apply / credit-note-apply.
   Location: invoicing-api/handlers/payments.ts:316-348; invoicing-api/handlers/credit_notes.ts:249-284; migrations 0019/0020/0058 recompute triggers.
   Impact: an org-A user with payments.apply or credit_notes.apply (org_owner/org_admin/accounting) POSTs an apply with allocations[].invoice_id set to any org-B invoice UUID. invoice_id is validated only as a UUID, never against caller.orgId. The allocation insert runs on the service-role admin() client (bypasses RLS); the FK is existence-only. The AFTER INSERT recompute triggers (SECURITY DEFINER) update public.invoices WHERE id=p_invoice_id with NO org filter, mutating org-B paid_cents, flipping status to paid, stamping paid_at, and firing the state-change trigger that writes a forged row into org-B's append-only audit chain. Exploitable today.
   Fix: before inserting allocations, verify every allocation.invoice_id belongs to caller.orgId in BOTH handlers (404/422 on miss). Durable defense: denormalize org_id onto the allocation tables with a same-org CHECK, or add an org predicate to the recompute UPDATEs so any future writer is protected.
   Status: CONFIRMED. Verifier traced handler to FK to recompute to bare invoice UPDATE across three migrations; no upstream guard.

### HIGH

2. period_close registered FSM emits no audit row on close/reopen (live constitutional violation).
   Location: migrations/0023_finance_period_close.sql:68-204; _shared/workflow/finance.ts:116-134.
   Impact: the most audit-sensitive financial control (fiscal-period lock/unlock) leaves no tamper-evident record. Confirmed live: 1 real prod period close with 0 audit_log rows, closed_by/reopened_by NULL (the RPCs never capture the actor).
   Fix: forward migration adding AFTER UPDATE OF status (and AFTER INSERT) trigger calling kitstak_audit_state (entity_type period_close), capture the acting user, add period_close to audit_trigger_coverage_gaps().
   Status: CONFIRMED. Refute attempt failed; sibling parity in 0024 proves the omission; live prod confirms one silent close.

3. Maintenance workers (audit-chain-verify, idempotency-gc) blocked by gateway, constitutional integrity probes dead in prod.
   Location: config.toml:42-68; audit-chain-verify/index.ts:25-29; idempotency-gc/index.ts:20-24.
   Impact: both deployed verify_jwt=true yet authenticate via static Bearer secret, so the platform gateway 401s every invocation before the handler runs. The nightly audit hash-chain integrity probe never executes, and the idempotency_keys 7-day GC never runs (279 rows past retention, oldest 16 days). 8+ consecutive scheduled runs failed with curl 401. Fail-closed, not an open bypass, but two constitutional maintenance guarantees are non-functional.
   Fix: add [functions.audit-chain-verify] verify_jwt=false and [functions.idempotency-gc] verify_jwt=false to config.toml (matching notifications-worker), redeploy, run via workflow_dispatch to confirm 200 and non-zero GC delete. Fix the misleading idempotency-gc service-role-JWT header comment.
   Status: CONFIRMED. Live list_edge_functions shows verify_jwt:true; gh run logs show 401; DB confirms 279 rows past retention.

4. imports-api commit mass-assignment: raw unvalidated rows inserted.
   Location: imports-api/index.ts:158-166; schema cross_cutting.ts:265-279.
   Impact: commit schema types rows as z.array(z.record(z.unknown())) and the handler inserts the RAW row {...r, org_id} rather than the per-entity-schema-stripped object. A user with imports.job.commit can set attacker-chosen columns on customers/items/vendors/invoices/expenses within their own org: id (collision), invoice_number (numbering bypass), status/paid_cents/paid_at (fabricate a paid invoice), deleted_at (soft-delete on create), created_by (forged attribution). NOT cross-tenant (the {...r, org_id} ordering forces caller.orgId), hence HIGH not CRITICAL.
   Fix: insert the schema-validated, key-stripped object (RowSchemas[entity].parse strips unknowns) or an explicit per-entity column allow-list.
   Status: CONFIRMED. Service-role insert bypasses RLS WITH CHECK; no before-insert trigger; dangerous columns confirmed settable.

5. Payment and credit-note allocations have no over-allocation ceiling, invoice balance goes silently negative.
   Location: invoicing-api/handlers/payments.ts:316-348; credit_notes.ts:249-284; migrations 0018/0019/0020/0058.
   Impact: applyPayment/applyCreditNote insert client amount_cents with no check against the invoice balance; recompute blindly SUMs into paid_cents/credit_allocated_cents; balance_cents is a generated column with no CHECK and paid_cents/credit_allocated_cents carry only >=0. A privileged finance user can over-pay or over-credit an invoice, driving balance_cents negative, paid_cents>total_cents, and an over-payment flips status to paid. Corrupts AR, status logic, downstream auto-JE. Intra-tenant, privileged role, hence HIGH not CRITICAL.
   Fix: validate sum(new + existing allocations) <= invoice.balance_cents in both handlers (return 422), or enforce a trigger/CHECK that paid_cents + credit_allocated_cents <= total_cents.
   Status: CONFIRMED. No over-allocation guard at handler, schema, constraint, or recompute layer.

### MEDIUM

6. Credit note can be over-applied beyond its own value (no applied_cents<=amount_cents guard). credit_notes has >=0 checks but no upper bound; recompute sums allocations directly. Add a derived unapplied_cents column with >=0 CHECK or validate in applyCreditNote.
7. PostgREST .or() cursor filter injection across 9 list handlers. decodeCursor base64+JSON.parses the attacker-controlled ?cursor= and validates only typeof string; raw strings are interpolated into a .or() filter DSL. Tenant isolation HOLDS (org_id and deleted_at are separate AND-ed params the OR cannot strip), so within-tenant only. Fix: bound keyset pagination or strict cursor-field validation (UUID for id, ISO for created_at). One fix covers all 9 sites.
8. verify_jwt=false bundles trust unverified base64-decoded JWT claims. tenant.ts decodeJwtPayload only atob+JSON.parse, no signature check. A caller with the public anon key can craft a JWT with arbitrary org/role and read any org's branding and organization profile via tenants-api. admin-console-api routes are inert stubs, so realized blast radius is branding/profile disclosure only. Fix: verify the JWT signature in-handler (getUser via service-role, or HMAC against the project JWT secret) before trusting claims; keep public resolve-host pre-auth. Blocker before any wave grants admin.* caps.
9. Raw Postgres error.message leaked on roughly 20 INTERNAL_ERROR wire responses (D2 remediation incomplete). The D2 sanitizer only catches non-ApiError throws; handlers that build INTERNAL_ERROR ApiError with interpolated error.message bypass it. settings-api (11 sites), tenants-api:53/92/118 (resolveHost is fully unauthenticated), billing-api, mfa.ts:39, numbering.ts:60, crm customers.ts:324/350. Fix: route all internal faults through internalError(context, err); add a CI grep guard.
10. settings-api upsertFlag accepts any flag_key with no allowlist. An org_owner with flags.write can self-set platform_admin.enabled or enable unpaid pillar plugins (plugins.*) for their own org. Contained today only because admin.* is granted to no role. Fix: allowlist flag_key, reject platform_admin.enabled and plugins.*; route plugin enablement through billing.
11. Declared per-route flags finance.expenses and finance.chart_of_accounts are never enforced. Only finance.journal_entries.enabled is wired. Disabling them does not return 403 FEATURE_DISABLED. Fix: wire requireFlag into the expenses and coa handlers, or remove the unused keys.
12. PostHog session recording/autocapture + Sentry replay maskAllText:false capture on-screen business PII. For a B2B ops app showing customer and financial data, both vendors receive recordings with on-screen PII; the beforeSend scrub operates on structured events, not replay DOM frames. Fix: Sentry replay maskAllText:true, gate PostHog session_recording behind opt-in or class-based masking.
13. vendors-api and invoicing-api carry no pillar bundle gate (undocumented decision). Any authenticated org member can reach vendor/PO/vendor-bill/expense/invoice/payment/credit-note routes regardless of plugin entitlement. requireCap + org_id scoping still hold. Fix: make the decision explicit (documenting comment or serveBundleWithGate OR flagKeys).
14. Client retries not idempotent end-to-end: fresh Idempotency-Key per call + no DB uniqueness backstop. apiClient mints a fresh key on every non-GET, so a client retry after a lost response (server already committed) bypasses dedup and creates a duplicate financial record. MEDIUM because TanStack v5 useMutation does not auto-retry, so the realistic trigger is user double-submit. Fix: generate the key once per logical operation at the call-site and reuse across retries; document apiClient.ts:72; add natural-key uniqueness where a business key exists.
15. CSV export lacks formula-injection neutralization. exports-api csvEscape does RFC-4180 quoting but does not neutralize cells beginning with = + - @ or leading tab/CR. Stored free text like =HYPERLINK(...) can execute when a victim opens the CSV. Fix: prefix dangerous leading chars with a single quote per OWASP guidance.

### LOW

16. convert_project_to_invoice uses SQL round() (half-up) for discount/line cents (migrations 0060:182-184). Max 1-cent divergence on an editable draft. Replace with integer-scaled half-even. (Note: the original HIGH float-coercion claim was refuted; 100.0 is numeric in Postgres, arithmetic is exact decimal.)
17. Cross-tenant FK references accepted from body without org verification (PO vendor_id, vendor-bill purchase_order_id/vendor_id, JE line account_id, quote tax_id, copack/ops item_id/warehouse_id). Created rows are org-stamped and triggers derive org from parent, so these create dangling references or leak one tax rate rather than mutate the victim. Fix: verify body-supplied FKs resolve in caller.orgId before insert.
18. Worker shared-secret comparisons use non-constant-time !== (notifications-worker:41, audit-chain-verify:27, idempotency-gc:22). Timing oracle. Use a constant-time comparison.
19. CRM q-search ILIKE does not escape % / _ wildcards (customers.ts:120, contacts.ts:85, leads.ts:102). Logic/DoS, not injection. Lift search-api escapeIlike into _shared and reuse; cap q length.
20. ESLint no-restricted-imports ban list is not asserted a superset of the constitution refused list. No live violation. Add a test asserting superset to prevent drift.
21. CSP is origin-allowlist based with no nonce, and the Supabase ref is hardcoded in connect-src (vercel.json:16). Adequate today (no inline scripts). Document the decision; parameterize the Supabase origin per environment.

## 4. Gaps (non-security correctness, ops, and maintainability)

HIGH
- period_close FSM has no audit trigger (also listed as vuln 2).
- Dead maintenance workers: idempotency-gc + audit-chain-verify gateway-rejected (also vuln 3).

MEDIUM
- Audit hash chain broken in 2 of 4 prod orgs (05cb1eac, ba4622dd) with no live monitoring. Quarantine the known-broken rows behind a watermark before re-enabling the verifier so it does not page on accepted residue and mask new breaks.
- Stale pending idempotency reservations brick key+body indefinitely; no reaper and GC dead (5 orphaned pending rows live, oldest >24h). Tracked as F-Wave10-IDEMPOTENCY-PENDING-STALENESS. Treat pending rows older than a short TTL as reclaimable.
- dashboard-api count predicates use status= for quotes/projects but those tables use a state column, so open_quotes_count and active_projects_count silently return 0 (index.ts:193-197). Change to .eq('state', ...).
- PortalRoute skips activeOrgClaim check; a customer_user without kitstak_org_id reaches the portal and fires 401 NO_ACTIVE_ORG calls, rendering empty (same symptom SMOKE-03 fixed for staff). Add the gate.
- SubscriptionGate only gates trialing+expired; past_due/unpaid/paused pass through. Extend the gated-status set (deferred to a Stripe wiring follow-up).
- CRM/Invoicing/Finance/cross-cutting routes have no SPA pillar plugin gate (routes.ts:873-1251). Server still gates via cap. Document or gate intentionally.
- Three divergent line-math implementations (quote truncate, invoice half-even-scaled, PO Number-multiply) plus a fourth in SQL. Extract one shared BigInt half-even line-math helper.
- SMTP email transport is a permanent dead stub with retryable:true (senders.ts:88-104); the drain retries forever. Resend is the only working path. Implement SMTP or make the stub fail non-retryable.
- Lighthouse + preview metrics permanently disabled in CI (LIGHTHOUSE_ENABLED unset, VERCEL_AUTOMATION_BYPASS_SECRET absent). Set the repo variable and bypass secret.
- deploy-prod.yml does not depend on ci.yml; a push that fails CI still triggers a prod deploy. Gate deploy on CI success.
- Duplicate staging project-ref secret names across workflows (SUPABASE_STAGING_PROJECT_REF vs STAGING_SUPABASE_PROJECT_REF). Consolidate.
- Scheduled integrity workers (nightly-rls-probe, notifications-drain backstop) skip-guard green when secrets absent. Alert on skip or fail when expected secrets are missing.

LOW / INFO
- Coverage sentinel audit_trigger_coverage_gaps() is stale (hard-codes Wave 1-2; blind to 7 post-Wave-2 FSMs + period_close). customers and activities also have 0 status-change audit rows (lifecycle gap, not a canonical FSM violation).
- Payment over-allocation surfaces as raw 500 instead of 422; credit-note side has no equivalent CHECK at all.
- DashboardSummaryPage hand-rolls /100 + toFixed(2), mis-displays zero-decimal currencies (JPY/KRW/VND/CLP/ISK). Use shared formatCents.
- vendorsService silently drops next_cursor; vendor list pagination broken at the SPA.
- AdminProtectedRoute has no error-state branch for useMe() failure; an auth-api outage leaves the route stuck on the spinner.
- POST /portal/request-signin-link and /auth/request-password-reset have no rate limiting (F-Wave9-PORTAL-SIGNIN-RATE-LIMIT-01).
- Edge SENTRY_DSN may be unset in prod; edge exceptions uncaptured. Confirm/set the edge DSN.
- lib/auth.tsx legacy re-export shim never deleted (dual import paths).
- queryKeys/index.ts does not re-export most domain key modules.
- Services call Schema.parse (not safeParse); a post-deploy mirror drift throws a raw ZodError. Standardize on safeParse with a typed error mapper.
- BomDetailPage omits its hub eyebrow (known UI-kit follow-up).

## 5. Notable refuted claims (recorded so they are not re-raised)

- convert_project_to_invoice does float math that compounds drift (was HIGH). Refuted: the 100.0 literal is numeric in Postgres, not float; the full numeric*bigint*numeric/100.0 expression stays exact decimal (verified on staging). Only the narrow half-up rounding-mode sub-claim survives, downgraded to LOW.
- stripe-webhook leaks raw error.message on the wire. Refuted: index.ts:88 throws a plain Error, caught by the D2-sanitized non-ApiError arm, so the message is log-only and the wire returns the opaque message. The other ~20 INTERNAL_ERROR sites stand.
- Maintenance-worker breakage is silently disabling the integrity controls. Partially refuted: not silent. Both workflows use curl -fsS, so the gateway 401 fails the GitHub Actions job loudly on every run. The substance (controls do not execute in prod) is confirmed; only the silent framing was overstated.

## 6. Recommended priority order

1. CRITICAL: stop the cross-tenant invoice write. Verify every allocation invoice_id against caller.orgId in applyPayment and applyCreditNote, then add a DB-level same-org assertion (denormalized org_id + CHECK on the allocation tables, or org predicate on the recompute UPDATEs).
2. HIGH: revive the dead workers. Set verify_jwt=false for audit-chain-verify and idempotency-gc, redeploy, confirm via workflow_dispatch.
3. HIGH: add the period_close audit trigger and capture the acting user. Quarantine the 2 known-broken prod chains behind a watermark before re-enabling the verifier gate.
4. HIGH: fix imports-api commit mass-assignment. Insert the per-entity Zod-stripped object, not the raw row.
5. HIGH: add over-allocation ceilings (payment and credit-note apply, plus the applied_cents <= amount_cents guard).
6. MEDIUM: close the error-leak and injection cluster. Route the ~20 INTERNAL_ERROR sites through internalError() with a CI grep guard, and fix the .or() cursor injection by validating cursor fields in decodeCursor (one change covers all 9 handlers).
7. MEDIUM: harden the verify_jwt=false authenticated routes (verify JWT signature in-handler for tenants-api branding and /tenants/me, or split resolve-host out) and allowlist settings-api upsertFlag flag_key.
8. MEDIUM: make the idempotency contract retry-safe (key once per logical operation at the call-site) and add a short pending-TTL reaper.
9. MEDIUM: restore CI gates (gate deploy-prod on ci.yml, enable Lighthouse, reconcile the duplicate staging secret names) and fix the dashboard count predicates.
10. LOW: consolidate money line-math into one shared BigInt half-even helper and clear the remaining defense-in-depth items.
