# Canon Steward orphan-route hint (F-Wave9-CANON-STEWARD-ROUTE-HINT-01)

Date: 2026-05-27
Branch: claude/awesome-swanson-c733a9
PR: chore(ci): canon-steward emits allowlist hint on orphan-route violation

## Why

`scripts/canon-steward-check.mjs` fails CI when a SPA route exists with no
Sidebar entry pointing at it, unless the route is explicitly allowlisted
with a reason in `scripts/canon-steward-allowlist.txt`. Two agents in
yesterday's session tripped this guardrail by shipping intentional
deep-link-only routes (`/account/security`, `/auth/recovery`) without
remembering to update the allowlist. Each required a chore re-push.

The script's existing output told them to "add an explicit entry" but did
not show the file path, the exact allowlist line format, or the two
resolution options (sidebar entry vs allowlist). The fix: emit a focused
remediation block after orphan-route violations so a reading agent can
self-heal without a re-push.

## What changed

1. `scripts/canon-steward-check.mjs`. Appended an orphan-route-only hint
   block at the end of `main()`. Fires only when at least one
   `orphan-route` violation survives the allowlist filter, and fires
   exactly once per run regardless of how many routes are orphan, to keep
   CI logs readable. Existing per-violation enumeration, exit code, and
   marker / orphan-link checks are unchanged.
2. `apps/web/test/regression/canon-steward-route-hint.test.ts`. Three
   tests that spawn the real script against the real tree:
   - clean tree emits nothing
   - one synthetic orphan route emits the hint exactly once
   - two synthetic orphan routes still emit the hint exactly once
   The test patches `apps/web/src/routes.ts` in `beforeEach`, snapshots
   the original content, and restores it in `afterEach` so a crash mid
   test cannot leave the tree dirty.

## Constitutional alignment

- No em dash, no double hyphen, no emoji in any printed text or code
  comment.
- No new top-level dependency.
- No behavioural change beyond appending the hint: existing violation
  detection, exit code 1 on red, exit code 0 on green, and the marker /
  orphan-link rules all preserved.
- Allowlist format `<rule>|<file>|<snippet>` cited in the hint matches
  the existing `scripts/canon-steward-allowlist.txt` convention
  byte-for-byte.

## Tests

- New 3-test suite green on first run (`pnpm exec vitest run --config
  vitest.regression.config.ts canon-steward-route-hint`).
- `pnpm test:contract` green (20 tests across parity + money parity).
- `node scripts/canon-steward-check.mjs` clean tree still exits 0 with
  zero output.
- Manual smoke: synthetic orphan route injected into `routes.ts`, script
  output observed end-to-end, route reverted.

## Follow-ups

None spawned. The original allowlist-entry-missing failure mode is now
self-documenting in CI output.
