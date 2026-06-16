# Session handoff 2026-06-15 (Wave 13 closeout follow-ups)

One-line: closed the Wave 13 closeout follow-ups. The safe trio merged (#296), the SEC-AUTH grant-revoke merged and is live on prod (#297, advisor 117 to 2), and the SSO store-metadata MVP is built, reviewed, and parked at #298 for the operator merge nod.

## What shipped this session

### Merged to prod
- **PR #296 (a54c1c3)**: three safe SPA and test follow-ups in one PR. (1) `F-Wave13-RETRY-AFTER-429-01`: the apiClient retries a 429 after a capped, Retry-After-aware backoff, reusing the same Idempotency-Key. (2) `F-Wave13-UX-INVALIDATION-REMAINDER-01`: the shipment transition and ship hooks and the production-run start and complete hooks moved onto the shared `transitionInvalidationKeys` contract. (3) `F-Wave13-FORWARDREF-TEST-HARDENING-01`: `TextInput` exposes a named `renderTextInput`; the field-error test calls it directly instead of reaching into the forwardRef internal `.render`. Three-lens review approved.
- **PR #297 (f5b9cff), migration 0117 live on prod**: `F-Wave13-SEC-AUTH-EXEC-REVIEW-01`. Follow-on to 0111. Revoked `EXECUTE` from `authenticated` on the remaining 115 SECURITY DEFINER functions (25 directly-callable service RPCs plus 90 trigger functions), excluding `current_org_id` and `current_user_role` (the only two functions any RLS policy references; revoking them would break RLS). Closed the live `audit_append_state_change` forge path and the cross-tenant `recompute_*` and chain-head reads. Confirmed on prod: the `authenticated_security_definer_function_executable` advisor dropped 117 to 2 (the two intended RLS internals). rls-probe Category 13 locks it. Four-lens reviewed; the migrate workflow applied 0117 to prod and the count was verified directly.

### Held for operator sign-off (NOT on prod)
- **PR #298 (branch `claude/w13-sso-mvp`), migration 0118 not yet on prod**: `F-Wave13-SSO-HANDSHAKE-01`, the store-metadata MVP. 0118 adds `sso_connections.provider_validated_at` plus a CHECK that a connection cannot be active until validated, the `oidc_configs` table mirroring `saml_configs` Pattern B RLS, and a non-partial `sso_connections(org_id)` index. Canon adds `SamlConfigSchema`, `OidcConfigSchema`, and `provider_validated_at` on `SsoConnectionSchema` (byte-identical both mirrors). `settings-api` gains `POST /sso/saml-metadata` and `/sso/oidc-metadata` (requireCap `org.sso.write`, `auth.sso_saml` flag gate, Idempotency-Key, unconditional `assertSsoConnectionInOrg` returning 404 cross-tenant). The SPA Configure panel stores metadata, Mark-validated sets `provider_validated_at`, and Activate is gated until validated. rls-probe Category 14 covers both providers. The OIDC `client_secret` is DEFERRED (not stored at all, no plaintext, no operator acknowledgment needed) to the live-handshake phase, where it goes behind Supabase Vault. Four-lens reviewed (no critical; the one HIGH, an echoed secret, is moot now). All gates green; verified on staging.

## Repo and prod state at handoff

- `main` at `f5b9cff`. Prod schema at max migration **0117**.
- Staging carries 0117 and 0118 (0118 applied via `execute_sql` for verification only; the numbered file ships to staging and prod through the migrate workflow on merge).
- SSO branch `claude/w13-sso-mvp` is pushed; PR #298 is open and held for the operator merge.
- Working tree is on `claude/w13-sso-mvp`. Untracked in the repo root (pre-existing, not this session): `audit-output/`, `.claude/audits/`, `3pl-job-builder-planning.md`, `deno.lock` files.
- Cross-session memory updated: `wave13_followups_progress.md` (full state) plus the `MEMORY.md` index line.

## Pickup point for tomorrow morning (clear starting order)

1. **Decide PR #298.** One merge nod, no risk to accept (the secret is deferred, so nothing to acknowledge). On merge, the migrate workflow ships 0118 to staging and prod. After that, the live SAML or OIDC provider handshake in the Supabase dashboard, then marking a connection validated, is the operator step (it cannot be automated: it needs a real identity provider and a tested sign-in round-trip).
2. **Prune the stale worktrees.** Eighteen `worktree-wf_*` branches plus their `.claude/worktrees/` directories are left from earlier multi-agent runs. Run `git worktree prune`, then remove the stale `.claude/worktrees/wf_*` dirs and delete the `worktree-wf_*` local branches. This is the deferred sync-and-clean.
3. Then pick from the open follow-ups below, or start a new thread.

## Open follow-ups

Spawned or carried this session:
- `F-Wave13-SSO-SECRET-VAULT-01`: store the OIDC `client_secret` behind Supabase Vault when the live-handshake phase lands (Vault is already installed on the project).
- `F-Wave13-SSO-OIDC-FLAG-01` (optional): a protocol-specific `auth.sso_oidc` flag if OIDC-only plans are ever wanted; today one `auth.sso_saml` flag gates both protocols.
- SSO Phase 3: auto-provision `org_membership` on first SSO sign-in (the live-handshake phase).
- `F-Wave13-RETRY-AFTER-429-01` server side: no edge function emits a 429 yet, so the client backoff is defensive until a rate limiter exists.

Carried from the Wave 13 closeout (`03-workspace/journal/wave-13-audit-remediation.md` has the full list):
- `F-Wave7-LINES-PAYLOAD-DROP-01` and `F-Wave7-PRODUCTION-LINES-NORMALIZE-01`: the JSON line-mirror column drops, deferred (the receiving and shipment dual-write only stopped this wave, so a same-release drop risks a rollback data loss; production lines are not normalized yet).
- `F-Wave13-SSO-HANDSHAKE-01` (the live handshake half), `F-Wave13-FORWARDREF-TEST-HARDENING-01` (done), and the other spawned follow-ups recorded in the closeout.

## Verification carried out this session

Per PR and on the merged work: typecheck, lint (max-warnings 0), `vitest run src` plus the regression suite, contract byte-mirror parity, build, and size-limit (SPA index 38.4 kB gzip against the 40 kB budget; the SSO admin page is a lazy chunk). `deno check` against the edge bundle added no new errors. Migrations 0117 and 0118 were verified on staging before merge or hold. After #297 merged, the prod `authenticated_security_definer` advisor count was confirmed at 2 directly. CI was green on #296 and #297; #298 CI is running.
