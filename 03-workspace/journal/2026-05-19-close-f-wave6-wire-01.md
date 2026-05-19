# Close F-Wave6-WIRE-01 — `bigintReplacer` YAGNI strike

**Date:** 2026-05-19
**Decision:** Option B (strike from constitution).
**Filed by:** Operator dispatch during read-only audit sweep.

## Context

`F-Wave6-WIRE-01` (filed 2026-05-18 in `2026-05-18-drift-audit-consolidated.md:40` and `2026-05-18-drift-pm-architect.md:98`) flagged a long-standing inconsistency:

- The constitution (`CLAUDE.md:18`) named `bigintReplacer` as the canonical wire serializer for monetary values.
- `bigintReplacer` was defined in both `_shared/money.ts:32` and `apps/web/src/lib/money.ts:32`.
- Neither call site that does the actual serialization used it. `apiClient.ts:80` and `_shared/responses.ts:70` both invoked bare `JSON.stringify`.
- Today no `BigInt` ever reaches `JSON.stringify` (every `_cents` value is held as a `number` or comes back from Postgres as a `string`), so nothing was breaking. The function was dead code.

The follow-up was advisory: either wire the function or strike it.

## Decision

Strike it. Three reasons:

1. **Headroom.** Largest plausible Kitstak invoice in cents is ~11 digits ($1M). `Number.MAX_SAFE_INTEGER` is 16 digits. ~5 orders of magnitude of safety margin before precision could be lost.
2. **Constitution hygiene.** A line that's neither enforced nor needed is the kind of drift the constitution exists to prevent. Every line should be load-bearing.
3. **Reversibility.** If headroom is ever consumed, the four-line helper can be reinstated from `git log` in minutes.

## Changes shipped in this PR

- `CLAUDE.md:18` — removed `` `bigintReplacer` for serialization`` from the Money rules. Line now reads `- Wire: cents as integer or string. Never floats.`.
- `apps/web/src/lib/money.ts` — removed the `bigintReplacer` export (4 lines).
- `supabase/functions/_shared/money.ts` — removed the `bigintReplacer` export (4 lines, byte-identical to SPA copy).
- This journal entry.

## Verification

- Parity test (`apps/web/test/contract/parity.test.ts`) continues to enforce byte-identity between the two `money.ts` copies. Both files received the identical edit.
- No call sites used `bigintReplacer`. No import statements need updating. Grep confirms zero remaining references in `apps/` or `supabase/` (only this journal and the historical 2026-05-18 entries that documented the original drift).

## Constitutional alignment

- **Money rules:** still intact. BIGINT cents, banker's rounding, currency snapshot, mirror parity all preserved. Only the unused wire helper is gone.
- **Forward-only:** no migrations touched.
- **Mirror:** both `money.ts` copies remain byte-identical.

## Closes

- `F-Wave6-WIRE-01` — resolved via YAGNI strike.
