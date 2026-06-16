# Wave 13 Audit Remediation Closeout

Date: 2026-06-15
Risk IDs: R-W13-SEC-01, R-W13-SEC-02, R-W13-WMS-01, R-W13-BILL-01, R-W13-PERF-01, R-W13-PERF-02, R-W13-UX-01, R-W13-UX-02, R-W13-UX-03, R-W13-IA-01, R-W13-OBS-01, R-W13-CAT-01, R-W13-SRCH-01, R-W13-AUTH-01, R-W13-3PL-01, R-W13-3PL-02, R-W13-FIN-01, R-W13-DB-01, R-W13-DX-01, R-W13-COPACK-01
Closes: the 2026-06-15 product audit and operator simulation backlog (`03-workspace/plans/2026-06-15-audit-remediation.md`)
Source reports: `03-workspace/audits/KitStak-Master-Summary-2026-06-15.md` plus the full Product Audit and Operator Simulation

## Scope

The 2026-06-15 audit returned a prioritized backlog (P0 go-live blockers, P1 high impact, P2 correctness and polish). This wave delivered all twenty work units across three phases. Every unit was re-verified against current code before implementation, built on its own `claude/<slug>` worktree branch, gated green, code and security reviewed, and merged in order. Migrations were verified on staging before merge. Prod main is at 885e729 with the schema through migration 0116.

## Method

Each phase ran as a dynamic multi-agent workflow: one worktree-isolated implementer per unit, pipelined into independent code-review and security-review passes, looped fix-until-clean. The orchestrator integrated the results, ran the local Definition of Done gates, applied and verified migrations on staging, and merged each unit through CI with the constitution's stop-and-ask discipline. Four protected-surface units (auth, stock ledger, billing entitlement, RLS) were built green on-branch and held for operator sign-off before merge.

## Phase 13.A (P0, go-live blockers)

- R-W13-SEC-01 (PR #279): authenticated routes on `tenants-api` and `admin-console-api` trusted a decoded but unverified JWT. Set `verify_jwt = true` on both bundles and moved the one public route (`GET /tenants/resolve-host`) into a new `tenants-public-api` bundle, so the Supabase gateway verifies the signature before any authenticated handler runs.
- R-W13-SEC-02 (PR #277, migration 0113): pinned `search_path = public` on the 37 search-path-mutable functions and revoked `EXECUTE` from `public, anon` on the 11 anon-executable SECURITY DEFINER functions. Revoking PUBLIC (not anon alone) was required because anon inherits the default PUBLIC grant. Leaked-password protection was enabled in Supabase Auth (operator action).
- R-W13-WMS-01 (PR #278, migration 0114): directed putaway completed to Done while posting no stock movement when the destination bin was null. `complete_putaway_task` now raises STATE_CONFLICT when the destination is null, and a new `set_putaway_destination` RPC plus a detail-page selector let the operator set the bin on an in-progress task.
- R-W13-BILL-01 (PR #280): paid `plugins.*` add-ons were self-enablable from Admin Feature Flags. `settings-api` now denies enabling a paid plugin unless the org has an active subscription (`subscription_status in active or trialing`), returning `403 BILLING_REQUIRED`. Bundle-gate misses stay 404.
- R-W13-PERF-01 (PR #276, migration 0112): added covering indexes for the 101 unindexed foreign keys flagged by the performance advisor.

## Phase 13.B (P1, high impact)

- R-W13-UX-01 (PR #281): state-transition mutations now invalidate the entity detail key, entity tree, and audit timeline explicitly through a shared helper.
- R-W13-IA-01 (PR #282): the page eyebrow taxonomy moved from the retired UX-Q1 job-mode words to the pillar IA used by the sidebar groups, with a single-source taxonomy module and a regression test.
- R-W13-OBS-01 (PR #283): product-analytics events for 3PL job runs, WMS receiving and putaway, manufacturing runs, and KitForce labor, with no PII in payloads.
- R-W13-CAT-01 (PR #284, migration 0115): the item master gained unit of measure, cost (distinct from price, `cost_cents`), reorder point, and barcode, with the create and edit forms wired and the Zod canon updated on both mirror sides.
- R-W13-SRCH-01 (PR #285): a hand-rolled Cmd or Ctrl-K command bar over the existing search-api spanning customers, quotes, projects, invoices, items, and job numbers, with full keyboard a11y and no new dependency.
- R-W13-3PL-01 and R-W13-3PL-02 (PR #286): verified the 3PL execution chain (Supply Plan to Job Run to posted daily log to Billing Review to draft invoice) at the code level, and added a best-effort draft Supply Plan auto-created on quote-to-project conversion.
- R-W13-AUTH-01 (PR #292): TOTP MFA enrollment and verification UI plus SSO connection-record management. The SAML and OIDC handshake is deferred to follow-up F-Wave13-SSO-HANDSHAKE-01; a new connection stays inactive until that is wired.

## Phase 13.C (P2, correctness and polish)

- R-W13-FIN-01 and R-W13-DB-01 (PR #287): added a status-equals-from compare-and-set guard to the remaining SELECT-then-UPDATE transitions in `invoicing-api`, `ops-api`, and `manufacturing-api` (a 0-row result now returns STATE_CONFLICT 409). Stopped dual-writing the receiving and shipment JSON line mirror after confirming all readers use the normalized line-item tables. The column drop is a later release (multi-stage rule, F-Wave7-LINES-PAYLOAD-DROP-01); the production-run payload mirror stays until its lines are normalized (F-Wave7-PRODUCTION-LINES-NORMALIZE-01).
- R-W13-UX-02 (PR #288): line items can be staged inline on the quote, invoice, receiving, and BOM create screens.
- R-W13-UX-03 (PR #289): the apiClient auto-retries transient network and 5xx failures while reusing the same Idempotency-Key (no double-apply), and Zod issues map to per-field form errors. 429 is not auto-retried (a rate limit needs Retry-After backoff, follow-up F-Wave13-RETRY-AFTER-429-01).
- R-W13-DX-01 (PR #290): size-limit budgets for the lazy chunks, an edge-function Sentry capture scaffold (no-op until SENTRY_DSN is set), and the `three-pl-api` split into a `handlers/` layout. The Lighthouse gate re-enable needs the operator Vercel protection-bypass secret.
- R-W13-COPACK-01 (PR #291): repaired the imports-api CSV column mapping for the broken entities while keeping the column allowlist intact (no mass-assignment), and relabeled Co-Pack channels manual-only until a real connector exists.
- R-W13-PERF-02 (PR #293, migration 0116): consolidated the 88 multiple-permissive-policy tables (FOR ALL write policy split into command-scoped INSERT, UPDATE, and DELETE so SELECT is governed by one policy) and wrapped the 7 init-plan auth calls as `(select fn())`.

## Constitutional invariants verified

- RLS: PERF-02 was verified semantics-preserving by a static adversarial diff (every one of 357 recreated policy predicates is identical to a baseline predicate for its table; zero widening) and by the CI cross-tenant probe matrix on a fresh DB with 0116 applied. No table lost its policy. SEC-01 keeps the bundle-gate 404 behavior. Cross-tenant reads stay 200 plus empty, workflow POSTs 404, bundle gates 404, flag misses 403.
- Migrations: 0112 through 0116 are forward-only, idempotent, with full headers and DOWN MIGRATION blocks. Prod and staging both at 0116.
- Money: CAT-01 `cost_cents` is BIGINT cents with a non-negative check. No floating point introduced.
- Idempotency: UX-03 retries reuse the same Idempotency-Key so a replay cannot double-apply. FIN-01 transition guards return STATE_CONFLICT, never a silent double-write.
- Audit and ledger: WMS-01 keeps the append-only ledger and the auto-audit trigger path; no handler writes audit_log directly. No auto-JE or audit trigger was changed.
- Zod canon: CAT-01 and AUTH-01 kept `_shared/types.ts` and `apps/web/src/lib/types.ts` byte-identical (test:contract green); AUTH-01's SSO service extends the canonical schema rather than redefining it.

## Advisor deltas on prod (zmnvwhqjahwidprnjxrq)

- unindexed_foreign_keys: 101 to 0
- function_search_path_mutable: 37 to 0
- anon_security_definer_function_executable: 11 to 0
- auth_leaked_password_protection: 1 to 0
- multiple_permissive_policies: 88 to 0
- auth_rls_initplan: 7 to 0

## Notable catches during the wave

- SEC-02: the first revoke draft used `FROM anon` only; staging verification showed 10 of 11 functions still anon-executable because anon inherits the default PUBLIC grant. Corrected to `FROM public, anon`.
- OBS-01 and UX-01 both edited the same transition hooks; the merge conflict was resolved to keep both the invalidation and the analytics emit.
- UX-02 BOM partial-failure no longer leaves the operator able to re-submit and duplicate already-saved components.
- UX-03 stopped re-exporting `executeRequest` from the public apiClient surface (a latent auth-header-bypass footgun).

## Follow-ups spawned

- F-Wave13-SSO-HANDSHAKE-01: the SAML and OIDC handshake for AUTH-01.
- F-Wave13-SEC-AUTH-EXEC-REVIEW-01: review the 117 authenticated_security_definer_function_executable advisor warnings (mostly intended).
- F-Wave13-RETRY-AFTER-429-01: Retry-After-aware backoff for 429.
- F-Wave13-FORWARDREF-TEST-HARDENING-01: a forwardRef test reads the internal render property.
- F-Wave13-UX-INVALIDATION-REMAINDER-01: shipment and production-run transitions still use the older invalidation pattern.
- F-Wave7-LINES-PAYLOAD-DROP-01 and F-Wave7-PRODUCTION-LINES-NORMALIZE-01: the JSON line mirror column drops.

## Operator actions outstanding

- Set the Vercel protection-bypass secret to re-enable the Lighthouse gate (DX-01 scaffold is in place).
- Set the edge `SENTRY_DSN` to activate the edge-function Sentry capture (DX-01 scaffold is no-op until then).
- Optional manual smoke of the public resolve-host route after the SEC-01 verify_jwt flip (CI test:rls and the route-split test passed).
