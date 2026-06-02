# Wave 10 Review Remediation Closeout

Date: 2026-06-01
Risk IDs: R-W10-REVIEW-01 through R-W10-REVIEW-06
Closes: F-Wave10-REVIEW-REMEDIATION
Branch: wave10-review-remediation

## Scope

A 55-agent multi-agent review of the codebase (10 dimensions, every finding
adversarially verified) returned 39 confirmed findings: 4 HIGH, 14 MEDIUM,
21 LOW, no CRITICAL. This wave addresses the full set across six workstreams,
implemented and committed on a single branch, gated green, and independently
reviewed a second time before hand-off.

## Workstreams

- WS-A Money integrity. Invoice line totals are now server authoritative: the
  handler recomputes tax and total from trusted inputs in pure scaled BigInt
  and ignores client-supplied derived cents on create and patch. Purchase-order
  line math and the SPA and dashboard money paths moved from Math.round to
  roundHalfEven. tax_rate_snapshot confirmed as a decimal fraction (numeric(7,4)).
- WS-B Idempotency. deleteSetting is now wrapped. The shared wrapper moved to
  reserve-before-execute with fail-closed persist. Forward migration 0086 adds a
  pending or completed state and relaxes status_code to nullable.
- WS-C Audit hardening. Removed the unused writeAudit helper and corrected the
  stale header comment. Added an entity_type superset guard and a writer or
  verifier payload-shape contract test, plus a standalone check script.
- WS-D Authz and security. Added the saved_views capability to both byte-mirror
  canons and gated the handlers. Made 500 responses opaque while logging the real
  cause. Replaced wildcard CORS with an allow-list, removed the listUsers filter
  interpolation in favor of a profiles lookup, added a webhook host allow-list,
  pinned billing redirect targets, and moved the Stripe price map to a shared
  module with a parity test.
- WS-E Quality and DRY. Collapsed the duplicate created helper, added logging to
  the swallowed dashboard catches, switched mutable lists to stable id keys,
  normalized query defaults on the named hooks, reused the admin client factory
  in the workers, and relocated the org-scoped list helpers to shared.
- WS-F Migrations, RLS, and probe. Forward migration 0087 wraps the RLS helper
  calls in subqueries on the high-read tenant tables. Added stripe_webhook_events
  to the nightly RLS probe and a migration-header-format guard from 0087 onward.

## Verification

Integration gate on the combined branch, all green: typecheck, test:contract
(26), test (434, 2 skipped), lint (max-warnings 0, refused-imports enforced),
build. Independent second-pass review approved WS-B through WS-F; WS-A had one
blocking finding (a false overflow-guard comment) which was fixed by moving the
line math to genuine pure BigInt and re-verified.

## Operator-confirmed decisions

1. Invoice tax_rate_snapshot is a decimal fraction (0.0825 equals 8.25 percent).
2. Migration 0086 shape: status_code nullable, add state column with a check
   constraint, primary key unchanged, historical rows backfill as completed.
3. Deletion of the unused writeAudit helper.
4. saved_views grants: owner, admin, sales, ops, accounting get read, create,
   delete; viewer read only; portal roles none. Two new edge secrets required:
   ALLOWED_ORIGINS and WEBHOOK_ALLOWED_HOSTS.
5. RLS subquery wrap scoped to high-read tables in 0087; remaining tables tracked
   as a follow-up.
6. Currency snapshot stays at document-header grain by design.

## Documented forward-only exceptions

These applied migration files cannot be edited and are grandfathered by the
header guard (enforced from 0087 onward):

- 0041, 0047, 0048, 0071: non-canonical header separators or field formats.
- 0085: an unconditional ALTER COLUMN that is idempotent by Postgres semantics.
- 0005 and 0006: an intentional numbering gap, not back-filled.

## Follow-ups

- F-Wave10-INDEX-SPLIT-01: split the oversized auth, kitforce, copack, and ops
  index files into per-resource modules (deferred as an attended refactor).
- F-Wave10-QUERY-DEFAULTS-SWEEP-01: apply the shared query defaults to the
  remaining hooks.
- F-Wave10-CRUD-CALLSITE-MIGRATION-01: migrate the remaining bundles onto the
  shared list and get helpers.
- F-Wave10-RLS-WRAP-REMAINDER-01: wrap the lower-traffic tenant tables in the
  RLS subquery form.
- F-Wave10-IDEMPOTENCY-PENDING-STALENESS-01: add a staleness window or a failed
  state so a handler that throws does not leave a pending row until the nightly
  garbage collection.
- Regenerate database.types.ts after 0086 is applied.

## Process note

The first remediation workflow had an orchestration defect: a key-name mismatch
caused the in-workflow review step to short-circuit and the fix loop to run on a
non-actionable signal, producing a set of journal-only commits and two small
code tweaks. No harm to the substantive work. The independent review was re-run
correctly afterward with the matching corrected.

## Migrations not yet applied

0086 and 0087 are committed as files only. They ship to prod through the
file-based migrate workflow on merge (behind the production-db approval gate),
which then mirrors to the staging branch. No database was modified by this wave.
