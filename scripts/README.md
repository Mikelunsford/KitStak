# scripts/

Repo guardrails and one-off development aids. Every script is a zero-dependency Node ESM (`.mjs`) file targeting Node 20 or newer; run each with `node scripts/<name>.mjs`. None of them touch the database.

Three of them are CI guardrails wired into `.github/workflows/ci.yml`. A fourth is enforced through the web test suite. Two are operator-run development aids that no workflow calls.

## CI guardrails

| Script | Purpose | Invocation | CI workflow |
|---|---|---|---|
| `canon-steward-check.mjs` | Catches the silent-breakage patterns the Canon Steward pass misses: stray placeholder / TODO markers, `/path/new` links with no registered route, and list-page routes unreachable from the sidebar. Reads `canon-steward-allowlist.txt` to suppress known historical entries. | `node scripts/canon-steward-check.mjs` | `ci.yml` (runs directly) |
| `trigger-audit-check.mjs` | Grep guardrail against the two known shapes of trigger-body NOT NULL violations (a literal `null` passed as `to_state`, and an emit-movements trigger casting a possibly-missing `item_id`). Reads `trigger-audit-allowlist.txt` for false-positive suppression. | `node scripts/trigger-audit-check.mjs` | `ci.yml` (runs directly) |
| `migration-header-format-check.mjs` | Asserts every future numbered migration (at or above the enforce-from cutoff) carries the canonical header block from the constitution. Pre-cutoff files are grandfathered by the forward-only rule. | `node scripts/migration-header-format-check.mjs` | `ci.yml` (runs directly) |
| `audit-entity-type-superset-check.mjs` | Asserts the highest-numbered migration that redefines `audit_log_entity_type_check` enumerates a strict superset of every earlier redefinition. A later migration that narrows the list silently breaks audit writes for the dropped entity, so it is a release blocker. | `node scripts/audit-entity-type-superset-check.mjs` | `ci.yml` indirectly, via `pnpm --filter web test` (the regression test `apps/web/test/regression/audit-entity-type-superset-guard.test.ts` spawns the script) |

## Development aids (no workflow)

| Script | Purpose | Invocation |
|---|---|---|
| `encode-fonts.mjs` | Reads the brand `.ttf` files under `supabase/functions/pdf-worker/fonts/` and emits a TypeScript module exporting them as base64 string literals, so the pdf-worker bundles fonts inline with no runtime file I/O. Run after replacing a `.ttf`, then commit both the font and the regenerated `fonts.ts`. | `node scripts/encode-fonts.mjs` |
| `gen-0085-audit-chain.mjs` | One-shot generator that built migration `0085_audit_chain_same_txn_ordering.sql`. Reads each audit-log writer function from its source migration and rewrites only the per-org chain-head lookup, printing the `CREATE OR REPLACE` blocks to stdout for review. It does not modify the database and is not part of any migration. | `node scripts/gen-0085-audit-chain.mjs` |

## Allowlists

| File | Used by |
|---|---|
| `canon-steward-allowlist.txt` | `canon-steward-check.mjs` |
| `trigger-audit-allowlist.txt` | `trigger-audit-check.mjs` |

Each allowlist entry suppresses a known historical finding and is expected to cite a follow-up; see the file headers for the require-a-follow-up rule.
