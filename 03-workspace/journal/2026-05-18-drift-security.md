# Drift Audit — Security Reviewer (2026-05-18)

**Status:** GREEN with two YELLOW hardening items. No RED, no release blockers.
**Scope:** Runtime security posture for Kitstak (8 categories per dispatch).
**Time-box:** ~30 min sampling pass; not exhaustive.
**Auditor:** Security Reviewer agent.

## Summary

The repo is in good security health for a Phase-6-chassis-in-progress codebase. The constitutional invariants (idempotency PK shape, audit-chain triggers, RLS-from-0001, no banned deps, no committed secrets) all hold up to inspection. The nightly RLS probe and audit-chain-verify workflows are both wired and scheduled. The probe matrix is comprehensive (>30 tests across 10 categories, covering Pattern A reads, workflow POSTs, bundle gates, per-route flags, Pattern C globals, unauthenticated guard, switch-org reject, and audit_log RLS read).

Two YELLOW items are recommended hardening (not exploits today): (1) no explicit `revoke insert/update/delete on audit_log from authenticated` — RLS-policy-absence equals deny works, but a one-line future foot-gun could re-enable writes; (2) `notifications-worker` and `audit-chain-verify` use direct `!==` comparison on the bearer secret, vulnerable in principle to timing attacks (low-impact in cron context but trivial to fix).

One INFO item: I could not verify recent workflow run status (GitHub CLI is sandboxed off in this audit environment). The dispatch should pair this with a one-line `gh run list` check before treating "probe is green" as proven runtime fact.

---

## 1. Cross-tenant RLS posture — GREEN

**Evidence:**
- Workflow: `.github/workflows/nightly-rls-probe.yml` schedules daily 09:00 UTC, dispatches manually, skips cleanly when staging secrets absent. Environment-gated to `staging` (Supabase preview branch, not prod). Uses Node 22 (correct for `@supabase/realtime-js` native WebSocket requirement).
- Probe spec: `apps/web/playwright/rls-probe.spec.ts` (910 lines, 10 test categories):
  - Category 1 list reads across 10 tenant-scoped tables (`customers, contacts, leads, opportunities, items, quotes, projects, invoices, vendors, expenses`).
  - Category 2 detail reads across 6 tables.
  - Category 3 workflow POSTs across 11 bundles (quotes, invoicing, crm, projects, vendors, ops, finance) — every assertion uses `GATE_404_MESSAGE = 'gate-miss MUST 404, never 403'`.
  - Category 4 bundle gates (`plugins.3pl` off → ops-api 404; `platform_admin.enabled` off → admin-console-api 404).
  - Category 5 per-route flags (`finance.journal_entries.enabled` off → 403 `FEATURE_DISABLED` with `details.flag`).
  - Category 6 customer-portal-api 404 for non-customer_user.
  - Category 7 Pattern C globals (currencies, exchange_rates, roles) readable.
  - Categories 8-10 anonymous 401, switch-org cross-tenant 404, audit_log RLS read.
- Tables in probe vs. migrations: probe covers the 14 state-machine entities listed in `0036_audit_log_entity_type_extend.sql` plus the global Pattern C tables. **Gap: no probe for `stock_movements`, `stock_levels`, `po_line_items`, `vendor_bill_payments`, `invoice_line_items`, `invoice_versions`, `quote_line_items`, `quote_versions`, `quote_approvals`, `payment_allocations`, `credit_note_allocations`, `project_phases`, `journal_entry_lines`.** Those tables are child rows under Pattern B (parent-join scope); they inherit RLS from the parent. Worth noting in a YELLOW follow-up for Wave 7, but the parent-table probes do effectively cover the join path.
- Recent runs: **could not verify in audit-time** (GH CLI sandboxed). Dispatch should pair this audit with `gh run list --workflow=nightly-rls-probe.yml --limit 5` to confirm green streak. The workflow itself is well-formed and would fail loud on any 403-where-404-expected.

**Verdict:** Probe matrix is constitutionally correct. Probe coverage is comprehensive for Pattern A top-level entities. Child-table direct probes would be defense-in-depth.

## 2. Idempotency_keys table integrity — GREEN

**Evidence:**
- Migration 0001 (lines 304-326): PK is `(key, user_id, org_id, route_hash)` — exactly the constitutional shape. Columns include `body_hash text`, `status_code integer`, `response_jsonb jsonb`, `created_at timestamptz`. RLS enabled. SELECT policy scoped to caller's org and user_id. **No INSERT/UPDATE/DELETE policy for authenticated → service-role-only writes.**
- Body hash: `_shared/idempotency.ts` line 83-101 implements `canonicalize()` per RFC 8785 JCS (sorted keys, no whitespace, primitive JSON.stringify). SHA-256 via `crypto.subtle.digest`. **Not naive `JSON.stringify`.**
- 24h replay window enforced (line 240). Older rows fall through and are overwritten.
- Idempotency-Key validated as UUID v4 with strict regex (line 51-52, RFC 4122 §4.4 variant+version bits).
- 409 IDEMPOTENCY_CONFLICT on body-hash mismatch (line 243).
- GC workflow: `.github/workflows/idempotency-gc.yml` schedules daily 08:30 UTC, invokes `idempotency-gc` edge function with bearer `GC_TRIGGER_SECRET`. **Wired.**

**Verdict:** Constitution-aligned. No drift.

## 3. audit_log append-only enforcement — GREEN (with one YELLOW)

**Evidence:**
- Migration 0001 (lines 332-359): `audit_log` table with `prev_hash text`, `payload_hash text`, hash-chain columns. RLS enabled. Only a SELECT policy for `authenticated` scoped to caller's org. **No INSERT/UPDATE/DELETE policy → RLS implicit deny for those operations** for `authenticated`.
- Hash chain trigger: `0003_fix_audit_search_path.sql` defines `trg_audit_organizations_status()` as SECURITY DEFINER, computes `payload_hash = encode(extensions.digest(public.kitstak_audit_canonical(payload), 'sha256'), 'hex')`. Uses `pg_advisory_xact_lock` to serialize hash-chain writes per org.
- Verifier: `public.verify_audit_chain(uuid)` walks rows in order, recomputes expected hash, returns first broken row.
- Audit-chain-verify workflow: `.github/workflows/audit-chain-verify.yml` daily 09:00 UTC, invokes edge function with bearer `AUDIT_VERIFY_SECRET`, fails the workflow if `broken_count != 0`. **Wired.**
- `_shared/audit.ts` is for the non-state-change cases only. Writes via `admin()` service-role client. Hash chain is trigger-side, not application-side — so a handler bug cannot poison the chain.
- Migrations 0010, 0017, 0024, 0029, 0033, 0037 layer auto-state-transition triggers onto every entity with a state machine.

**YELLOW finding (3a):** Migration 0001 does not include an explicit `revoke insert, update, delete on public.audit_log from authenticated;` statement. Today this is benign — Supabase's `authenticated` role has default table-level grants, but with RLS enabled and no permissive INSERT/UPDATE/DELETE policy, the row-level check denies. **However**, a future migration that mistakenly adds a permissive policy (e.g. `for all to authenticated using (true)`) would become a chain-poisoning vector via a single one-line oversight. Defense-in-depth would be an explicit table-level revoke.

**Verdict:** Functionally append-only today. Recommend explicit revoke in a forward migration as belt-and-suspenders.

## 4. Service-role smuggling — GREEN

**Evidence:**
- `SUPABASE_SERVICE_ROLE_KEY` reads found in 5 files:
  - `_shared/idempotency.ts` — internal admin client factory (only invoked from idempotency replay store)
  - `_shared/handler-helpers.ts` — `admin()` factory; this is the constitutional pattern (service role + explicit `.eq('org_id', caller.orgId)` filter)
  - `idempotency-gc/index.ts` — cron worker, bearer secret gate
  - `audit-chain-verify/index.ts` — cron worker, bearer secret gate at line 22-24 BEFORE service role is touched
  - `notifications-worker/index.ts` — cron worker, X-Worker-Secret gate at line 58-62 BEFORE service role is touched
- **Crucially, every user-facing handler that uses `admin()` resolves the caller first** (`requireCaller(req)` returns 204 occurrences across 35 files) and combines queries with `.eq('org_id', caller.orgId)`. Example, `ops-api/index.ts` line 73: `await admin().from(table).select('*').eq('org_id', caller.orgId).eq('id', id)`.
- Migration `0041_fix_convert_quote_to_project_cross_tenant.sql` is a worked example of why the explicit `caller.orgId` pattern matters: the prior RPC used `current_org_id()` which returns NULL under service-role, leaking a 409 STATE_CONFLICT for a cross-tenant quote. Fix: pass caller orgId as RPC param. **The repo has internalized this discipline.**
- No bearer-secret bypass for the worker functions; all three (`idempotency-gc`, `audit-chain-verify`, `notifications-worker`) demand the secret on the FIRST line of the handler body before any DB access.

**Verdict:** No service-role smuggling into user-facing paths. The constitutional pattern (service role + explicit orgId filter) is universally applied.

## 5. Dependency audit — GREEN

**Evidence:**
- `apps/web/package.json`: production deps are `react@18.3.1`, `react-dom@18.3.1`, `react-router-dom@6.26.0`, `@tanstack/react-query@5.51.0`, `@supabase/supabase-js@2.45.0`, `zod@3.23.0`, `lucide-react@0.439.0`, `sonner@1.5.0`. All are required-list-aligned.
- `pnpm-lock.yaml` snapshot: `@supabase/supabase-js@2.105.4`, `react@18.3.1`, `zod@3.25.76`, `react-router-dom@6.30.3`, `eslint@9.39.4`, `vite@5.4.21`. All within recent maintained ranges, no known critical CVEs at audit date.
- Banned-dep check: grep on `apps/web/src` for `lodash|axios|dayjs|date-fns|moment|antd|@radix-ui|react-hook-form|formik|redux|zustand|jotai|recoil` returns ONLY comment-matches (e.g. "no antd / radix") and a doc reference. **No actual imports of banned packages.**
- ESLint enforcement: `apps/web/eslint.config.js` ships `no-restricted-imports` rule with the full banned-paths list (lines 8-33). Rule is wired into the TypeScript override (line 66) at `error` severity. Any banned import fails `pnpm lint`.
- Workspace root: pnpm@9.0.0, Node ≥20.0.0. The CI uses Node 22 for the RLS probe (correct for realtime-js).

**Verdict:** No banned dep imported. Dep posture current. Lockfile not flagging known issues.

## 6. Secret hygiene — GREEN

**Evidence:**
- `.gitignore` covers `.env`, `.env.*` with explicit `!.env.example` allowlist. Coverage is correct.
- `git ls-files | grep .env` returns only `.env.example` (template values only: `your-project.supabase.co`, `your-anon-key`).
- `.env.local` exists locally with real Supabase URL + anon publishable key (the anon key is intentionally public; it's bound by RLS) but is NOT git-tracked.
- No JWT, private-key block, `sk_test_*`, `sk_live_*`, `sbp_*` patterns committed (grep verified).
- Worker secrets (`WORKER_SECRET`, `AUDIT_VERIFY_SECRET`, `GC_TRIGGER_SECRET`) are read from Deno env and never logged in clear text.

**Verdict:** No secret bleed. Baseline coverage is clean.

## 7. CORS posture — YELLOW (defensible but worth noting)

**Evidence:** `_shared/cors.ts`:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Headers: apikey, authorization, content-type, x-request-id, idempotency-key, x-worker-secret`
- `Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS`
- `Access-Control-Expose-Headers: x-request-id, idempotent-replay, retry-after`

The Wave 6 hotfix 2 (`7f9acb5`) added `apikey` to the allow-headers (was missing). Allow-headers is now an explicit allowlist (not `*`), which is correct.

**YELLOW finding (7a):** `Access-Control-Allow-Origin: *` is permissive. For authenticated edge functions this is acceptable because (a) requests carry bearer tokens, not cookies, so CSRF is not a path here, and (b) the JWT is the auth bearer of trust. **However**, a strict-allowlist origin (Vercel preview + prod hosts + localhost) would be a meaningful hardening: it would shrink the attack surface for malicious in-browser scripts running on unrelated origins from being able to make authenticated requests on behalf of a logged-in Kitstak operator. Not a release blocker; future Wave's defense-in-depth.

**Verdict:** No `*` on allow-headers (correct). The `*` on Allow-Origin is defensible for token-bearer APIs but is the loosest setting available.

## 8. Auth flow — GREEN

**Evidence:**
- `_shared/tenant.ts`: JWT signature is NOT verified in the handler. This is correct: `verify_jwt = true` (Supabase platform default) means the gateway has already verified the signature before the request reaches the function. The handler only decodes the payload to read claims. For the three bundles with `verify_jwt = false` (`notifications-worker`, `tenants-api`, `admin-console-api`), the override is documented inline with rationale and a different gate is wired (X-Worker-Secret on the worker, requireCaller in the handler on the others).
- `tenants-api` exposes ONLY `/tenants/resolve-host` pre-auth; authenticated routes (`/branding`) explicitly call `requireCaller()` per the inline comment in `config.toml` line 47-49.
- `admin-console-api` has `verify_jwt = false` so the gate can return 404 (not 401) to anonymous, hiding bundle existence per the constitution. Handler still calls `requireCaller()` for authenticated routes.
- MFA: `_shared/mfa.ts` defines `requireMfaVerified(caller, req)` that calls `public.has_verified_totp(uuid)` SECURITY DEFINER RPC. Used in `admin-console-api/index.ts` lines 66, 80 (the platform-admin handlers). Per-request memoization via WeakMap, transient RPC failure throws `INTERNAL_ERROR` (does not silent-downgrade to allow or deny).
- Password requirements: not enforced application-side; Supabase Auth handles signup policy via the platform. `config.toml` shows `enable_signup = false` at both the auth level and the email level — **signup is disabled**, so the only path to a Kitstak account is operator-provisioned via `provision_organization` RPC + admin invite.
- TOTP MFA: enabled on platform per `PROJECT.md` "Supabase Auth (JWT + TOTP MFA, SSO/SAML for Enterprise)" + `_shared/mfa.ts` implementation.
- Switch-org guards membership check via `org_memberships` (`auth-api/index.ts` line 208-228) and returns 404 on cross-tenant attempt — verified by RLS probe Category 9.
- Worker-secret compares (`notifications-worker` line 60, `audit-chain-verify` line 22) use direct `!==` equality, not timing-safe compare. **Minor YELLOW (8a)** — replace with constant-time compare for defense-in-depth.

**Verdict:** No weak patterns. JWT verification offloaded to Supabase gateway (correct). MFA path established and used by privileged surfaces. Signup disabled. Cross-tenant switch-org correctly returns 404.

---

## Constitutional invariants verified

- RLS from migration 0001 on every tenant-scoped table: **verified**.
- Pattern A/B/C posture: **verified** (Pattern A in core entities, B in line-item/child tables, C in currencies/exchange_rates/roles).
- Idempotency PK (key, user_id, org_id, route_hash): **verified**.
- Body hash RFC 8785 canonical JSON: **verified**.
- audit_log append-only via RLS + hash-chain trigger: **verified**.
- Migrations forward-only, idempotent DDL: **verified** (spot-checked 0001, 0003, 0036, 0041).
- No banned deps imported: **verified** by grep + ESLint config inspection.
- Five pillars / brand tokens: out of scope for security slice.

## Open items / follow-ups

- **F-Wave6-SEC-01 (YELLOW):** Add forward migration with `revoke insert, update, delete on public.audit_log from authenticated;` as defense-in-depth against a future permissive-policy regression.
- **F-Wave6-SEC-02 (YELLOW):** Replace `!==` worker-secret comparisons in `notifications-worker`, `audit-chain-verify`, `idempotency-gc` with a constant-time compare (Deno: `crypto.timingSafeEqual`).
- **F-Wave6-SEC-03 (YELLOW):** Tighten CORS Allow-Origin from `*` to an explicit allowlist of Vercel prod + preview hosts + localhost. Token-bearer APIs are not CSRF-vulnerable but this is a free hardening.
- **F-Wave6-SEC-04 (INFO):** Add direct probes for child tables (`stock_movements`, `*_line_items`, `*_versions`, etc.) — currently covered by parent-row probes, but explicit probes catch a Pattern B join-policy regression earlier.
- **F-Wave6-SEC-05 (INFO):** Out-of-band — run `gh run list --workflow=nightly-rls-probe.yml --limit 5` to confirm green streak (could not be verified during this audit).
