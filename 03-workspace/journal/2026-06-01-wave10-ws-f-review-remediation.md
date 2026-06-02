# WS-F review remediation. Migrations, RLS read-path, probe coverage.

Wave: 10
Phase: Review remediation
Closes: F-Wave10-REVIEW-REMEDIATION (WS-F blocking review item)
Date: 2026-06-01

## Blocking review item

The WS-F implement step output was not registered as a committed artifact by the
orchestrator ("implement step did not commit"). This entry records the
verification that the implement step did land on disk, that the forward-only
migration rule was respected, and that every relevant gate is green. It registers
a committed remediation artifact for WS-F.

## Verification

The WS-F implementation is present in commit
fee65e64e9658bf502b3160bf97a1333bd76cf16 on branch wave10-review-remediation. All
four artifacts are present on disk and byte-identical to that commit. The
0087 migration was not edited, so the forward-only rule holds.

Scope confirmed in that commit:

- F1. supabase/migrations/0087_rls_select_wrap.sql. Recreates the RLS policies on
  the high-read tenant tables (audit_log, quotes, invoices, stock ledgers,
  projects, CRM entities, and their line-item children) with the bare
  current_org_id() and current_user_role() calls wrapped as scalar subqueries so
  the planner evaluates them once per statement instead of once per row. USING and
  WITH CHECK semantics and the Pattern A and Pattern B classification are
  byte-identical. Only the call form changes. Canonical header present, idempotent
  DDL, operator-only DOWN block. Not applied to any database.
- F2. apps/web/playwright/rls-probe.spec.ts. Adds stripe_webhook_events to the
  nightly RLS probe asserting an authenticated own-tenant read returns 0 rows,
  with a comment that the table is intentionally service-role-only (migration
  0071, RLS enabled, no authenticated policy).
- F3. scripts/migration-header-format-check.mjs. Zero-dependency CI guard that
  fails when a FUTURE migration (number greater than or equal to 87) is missing a
  canonical header field (separator, Migration, Wave, Phase, Closes, Date,
  Constitutional alignment). Already-applied files are grandfathered by the
  forward-only rule. Wired into ci.yml beside the canon-steward and trigger-audit
  guards.

Regression coverage confirmed:

- apps/web/test/regression/migration-header-format-guard.test.ts. Runs the script
  green on the real tree and red on a synthetic bare-header migration. 4 tests.

## Gates run

- node scripts/migration-header-format-check.mjs. Pass. Exit 0 on the real tree.
- pnpm typecheck. Pass.
- migration-header-format-guard regression suite. Pass. 4 tests.
- pnpm test:contract. Pass. 3 files, 26 tests, including money.parity and types
  parity. Confirms the branch state introduced no canon drift.

## Constitutional alignment

- Migrations. Forward-only preserved. 0087 was not edited. DDL is idempotent. The
  header declares Wave, Phase, Closes, operator-only DOWN, date stamp, and
  constitutional alignment.
- RLS. Filters not throws. Pattern A and Pattern B classification unchanged. The
  select-wrap is a planner optimization only. Cross-tenant reads still return
  200 plus empty. The service-role-only stripe_webhook_events table is asserted to
  yield 0 rows for an authenticated own-tenant read.
- Mirror canons unchanged. money.parity and types parity still green.
- No new top-level dependency. The header guard is zero-dependency Node. No em
  dashes, double hyphens, or emojis introduced.

## Outcome

WS-F is verified committed and green. No further code change was required for the
blocking item. This entry is the registered remediation artifact.
