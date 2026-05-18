# Wave 2 Hotfix: Deno workspace import map for zod

Date: 2026-05-18
Wave: 2 (second post-merge hotfix)
Status: Closed
Branch: `claude/wave-2-hotfix-deno-zod`

## What broke

After PR #5 (the first Wave 2 CI hotfix) merged, the Supabase CLI accepted `db.major_version = 17` and the pooler connection succeeded, but `deploy-functions` failed at the third bundle (`auth-api`) and `Supabase Preview` failed at the bundle step. Both share the same root cause:

```
Error: failed to create the graph
Caused by:
    Relative import path "zod" not prefixed with / or ./ or ../
      hint: If you want to use a JSR or npm package, try running `deno add jsr:zod` or `deno add npm:zod`
        at file:///.../supabase/functions/_shared/types/identity.ts:11:19
```

All six side-car types files (`_shared/types/{identity,crm,sales,finance,vendors_inventory_ops,cross_cutting}.ts`) import zod with the bare specifier `from 'zod'`. The SPA side resolves it via `node_modules` (Vite + `moduleResolution: bundler`); Deno requires either an `npm:` prefix or an import map.

The bare import worked for Wave 0 / Wave 1 because the only deployed edge functions (`audit-chain-verify`, `idempotency-gc`) never imported `_shared/types.ts`. Wave 2 added 21 bundles that import their domain side-car, exercising the bare specifier for the first time.

## Why this approach

Changing the side-car files to `from 'npm:zod@3.23.8'` would break the byte-mirror with the SPA copies. Changing the SPA copies to match would force the SPA build to resolve a Deno-style specifier.

The correct answer is to teach the Deno runtime to resolve bare `zod`. A workspace-level `supabase/functions/deno.json` import map does exactly that without touching either copy of any side-car.

## Changes

- `supabase/functions/deno.json` (new):
  ```json
  {
    "imports": {
      "zod": "npm:zod@3.23.8"
    }
  }
  ```
- `.github/workflows/deploy-functions.yml`: pass `--import-map ./supabase/functions/deno.json` to every `supabase functions deploy` call. Belt-and-suspenders so the workflow does not rely on the CLI auto-discovering the workspace deno.json. The Supabase Preview check uses Supabase's own bundling pipeline, which honors `supabase/functions/deno.json` natively.

The version `npm:zod@3.23.8` matches the SPA's `zod ^3.23.0` pin in `apps/web/package.json`. Pinning the exact patch on the Deno side prevents resolver drift between SPA tests and edge runtime.

## What did NOT change

- The byte-mirror canon files. All 22 pairs still byte-identical (`pnpm test:contract` 25 / 25).
- Side-car type files. Both copies still import `from 'zod'`.
- The SPA bundle (still 25.55 kB gzip).
- Any migration. No schema change.

## Migration state at fix time

Unchanged. All 37 migrations still applied at the remote per Supabase MCP `list_migrations`.

## Gates verified locally

- `pnpm typecheck` zero errors.
- `pnpm test:contract` 25 / 25 (4 singular pairs + 18 side-car pairs + 3 money behaviour assertions).

`pnpm lint`, `pnpm test`, `pnpm build`, `pnpm bundle-budget` not re-run; no SPA files touched.

## Gates expected after PR merges

- `deploy-functions.yml` next run: bundles all 23 functions through the import map, deploys to prod.
- `Supabase Preview` next PR run: bundles successfully against the workspace `deno.json`.
- `migrate.yml`: already green after the prior hotfix; unchanged.

## Risks closed

- `R-W2-HOTFIX-04`: Deno bundle failure on side-car zod imports.

## Follow-ups still open after this PR

Unchanged from the Wave 2 closeout list. Notably:

- `F-Wave2-CO-01` pdf-worker render endpoint (operator-approved JS PDF dep).
- `F-Wave2-DNDKIT-01` add `dnd-kit` to `apps/web/package.json` (Phase 1 oversight).
- `F-Wave2-AGENT-A-05` Canon Steward merge of domain side-car capabilities into master.
- `F-Wave2-CO-02` through `F-Wave2-CO-04` (search tsvector, imports async, notifications transports).
- `F-Wave2-CRM-01` through `F-Wave2-CRM-05`.

## Constitutional invariants verified

- Forward-only migrations: nothing changed.
- Byte-mirror parity: intact across 22 pairs.
- Idempotency PK shape per D-010: unchanged.
- Audit log hash chain: unchanged.
- Bundle budget: unchanged at 25.55 kB / 40 kB.
- No banned dependencies introduced. `npm:zod` is the same `zod` already in the SPA dep list; the Deno-side import map is a runtime resolution mechanism, not a new dependency.
- No em dashes, double hyphens, or emojis in user-facing copy.
- No "Built to Deliver", "Team 1", or "TS1" in product copy.
