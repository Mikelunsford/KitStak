# Handoff: WMS B0 dynamic-workflow run plan

Date: 2026-06-15. Wave 12. Companion to `2026-06-14-wms-bodyb-phase1-handoff.md` (the spec of record for all of Body B). This doc is the orchestration layer: how a fresh session implements B0 (the `plugins.wms` gated chassis) as a dynamic multi-agent Workflow on a clean post-merge main. Read the main handoff section "B0. WMS chassis" first; this doc does not repeat the file-by-file checklist, it tells you how to drive it.

## 0. Start state (confirmed 2026-06-15)

- main carries the SPA index lean-up (PR #265 merged, squash `236fa17`) so the index sits at 33.7 of 40 kB gz with about 6 kB of headroom. B0's new `/wms` sidebar section plus the `/wms` route fit under the held 40 kB budget. Do not raise the budget.
- main carries the locked Body B decisions (PR #266). All five (a) through (e) are settled to the handoff recommendations. Build B0 to them; do not re-litigate.
- Body A is complete. A7 shipped at prod max migration 0104. Before you cut the B0 migration, run `ls supabase/migrations/` and take the real next free id (expected 0105). The handoff migration numbers are placeholders; renumber contiguously from the real max.
- The latest `seed_org_settings` redefinition is `0064_provision_organization_completeness.sql` (confirmed 2026-06-15). Re-confirm no migration after 0064 redefines it before you copy its body.
- B0 adds NO domain tables, NO capabilities, NO Zod types beyond the flag constant. It mirrors the `manufacturing-api` plus `plugins.manufacturing` sibling. After B0, `/wms/*` resolves to NotFoundPage (404, never 403) for every org, because the flag defaults OFF (paid add-on) and no org reaches it until it is flipped on via `/admin/flags`.
- B0 has NO operator stop-point. The only stop-point in Body B is B2 (the `stock_movements` `location_id` change). B0 is safe to build, verify, and PR autonomously.

## 1. Why the implement phase is a single writer

Two byte-mirror pairs are release blockers and must stay byte-identical: `supabase/functions/_shared/constants.ts` equals `apps/web/src/lib/constants.ts`. `pnpm test:contract` asserts it. Do NOT split the constants edit across parallel agents; a one-character drift fails the gate. The implement phase below is ONE writer for exactly this reason. The review and verification fan-out come after the files exist.

## 2. The dynamic workflow

Run this with the Workflow tool next session: `Workflow({ script: <the block below> })`, or drop it at `.claude/workflows/wms-b0-chassis.js` and run `Workflow({ name: 'wms-b0-chassis' })`. It has two phases: a single-writer implement-and-self-verify phase, then a parallel adversarial review. The staging migration apply, the flag-off probe, and the PR are kept by the supervising main agent (section 3), not delegated.

```js
export const meta = {
  name: 'wms-b0-chassis',
  description:
    'Implement WMS Body B Phase B0, the plugins.wms gated chassis, by mirroring the manufacturing sibling; self-verify all gates to green; then adversarially review gating, byte-mirror identity, and the seed migration.',
  phases: [
    {
      title: 'Implement',
      detail:
        'single-writer chassis: flag mirror, wms-api bundle, deploy BUNDLES, routes, sidebar, the seed migration, db static test, WmsHomePage; self-verify the front-end gates to green',
    },
    {
      title: 'Review',
      detail:
        'parallel adversarial lenses: gating 404-not-403 plus flag-off, byte-mirror plus constitution plus brand voice, the seed migration idempotency plus seed_org_settings fidelity',
    },
  ],
};

const MANIFEST = {
  type: 'object',
  additionalProperties: false,
  required: ['filesChanged', 'gates', 'sizeLimitIndexKb', 'notes'],
  properties: {
    filesChanged: { type: 'array', items: { type: 'string' } },
    migrationId: { type: 'string' },
    gates: {
      type: 'object',
      additionalProperties: false,
      required: ['contract', 'typecheck', 'lint', 'test', 'denoCheck', 'build', 'sizeLimit'],
      properties: {
        contract: { type: 'string' },
        typecheck: { type: 'string' },
        lint: { type: 'string' },
        test: { type: 'string' },
        denoCheck: { type: 'string' },
        build: { type: 'string' },
        sizeLimit: { type: 'string' },
      },
    },
    sizeLimitIndexKb: { type: 'number' },
    notes: { type: 'string' },
  },
};

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'verdict', 'findings'],
  properties: {
    lens: { type: 'string' },
    verdict: { type: 'string', enum: ['APPROVE', 'APPROVE_WITH_NITS', 'BLOCK'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'issue'],
        properties: {
          severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
          file: { type: 'string' },
          issue: { type: 'string' },
        },
      },
    },
  },
};

phase('Implement');
const impl = await agent(
  [
    'Implement WMS Body B Phase B0, the plugins.wms gated chassis, in this Kitstak repo. You are the SINGLE WRITER for this phase. Keep the two byte-mirror constants files byte-identical.',
    '',
    'Read first: 03-workspace/specs/2026-06-14-wms-bodyb-phase1-handoff.md section "B0. WMS chassis" (the exact nine-item checklist with file paths and line numbers) and section 6 (reference files). Mirror the manufacturing sibling throughout: supabase/functions/manufacturing-api/index.ts, the plugins.manufacturing usage in apps/web/src/routes.ts and sidebarModes.ts, and the kitforce and manufacturing route and sidebar blocks.',
    '',
    'Do exactly the nine B0 items, no more. B0 adds NO domain tables, NO caps, NO types beyond the PLUGINS_WMS flag constant. Specifics that must hold:',
    '- Add PLUGINS_WMS: plugins.wms to BOTH constants files, byte-identical.',
    '- wms-api/index.ts mirrors manufacturing-api with an empty route table and serveBundleWithGate using flagKey (one flag), failing closed to 404.',
    '- Append wms-api to .github/workflows/deploy-functions.yml env.BUNDLES.',
    '- routes.ts: add the inferPluginForPath clause returning PLUGINS_WMS for /wms, and the /wms home route with a lazy WmsHomePage import. A gated pillar route declares only path, element, guard, layout; withPluginGate injects requiresPlugin. RequirePlugin renders NotFoundPage (404, never 403) when the flag is off.',
    '- sidebarModes.ts: a new wms mode section gated requiresFlag PLUGINS_WMS; update sidebarModes.test.ts with the exact-paths assertion.',
    '- Migration: run ls supabase/migrations/ and use the real next free id (expected 0105). Copy seed_org_settings verbatim from its CURRENT latest redefinition (confirm 0064 is still latest), append only plugins.wms to the flags array, preserve the revoke and grant to service_role and the comment, plus an idempotent backfill loop over organizations. Full header block (Wave 12, Phase B0, Closes this handoff, DOWN migration operator-only, date, Constitutional alignment). Idempotent DDL. The flag seeds is_enabled false. It does NOT touch RLS, money, idempotency, or audit_log DDL.',
    '- Add the db static regression test asserting the migration redefines seed_org_settings, appends plugins.wms, seeds false, and includes the backfill loop.',
    '- Create apps/web/src/pages/wms/WmsHomePage.tsx (a minimal lazy page, eyebrow WMS).',
    '',
    'Then self-verify and FIX until green, from apps/web: pnpm test:contract, pnpm typecheck, pnpm lint, pnpm test, pnpm build, pnpm bundle-budget. Also run deno check across the bundles including the new wms-api. The SPA index must stay under 40 kB gz (the /wms page is lazy, so it should barely move). Do NOT apply the migration to any database. Do NOT open a PR. Do NOT push.',
    '',
    'Return the manifest: files changed, the migration id used, per-gate status (pass or fail plus the first error if fail), the size-limit index kB, and notes on any deviation from the handoff.',
  ].join('\n'),
  { label: 'wms-b0-implement', phase: 'Implement', schema: MANIFEST },
);

phase('Review');
const lenses = [
  {
    key: 'gating-security',
    brief:
      'Gating and security. wms-api uses serveBundleWithGate with flagKey PLUGINS_WMS (single flag), fails closed to 404. routes.ts inferPluginForPath returns PLUGINS_WMS for /wms and only /wms. RequirePlugin renders NotFoundPage (404, never 403) when the flag is off. The flag seeds OFF in the migration. Confirm there is no 403-where-404 path and no way to reach /wms with the flag off.',
  },
  {
    key: 'byte-mirror-constitution',
    brief:
      'Byte-mirror and constitution. The new PLUGINS_WMS line is byte-identical in _shared/constants.ts and lib/constants.ts (test:contract). No em dashes, no prose double hyphens, no emojis in any new or edited file (brand voice on disk). No new top-level dependency. The sidebarModes wms section and the sidebarModes.test exact-paths assertion agree.',
  },
  {
    key: 'seed-migration',
    brief:
      'The seed migration. Forward-only, four-digit zero-padded, idempotent (create or replace, on conflict do nothing). seed_org_settings body is a faithful copy of the current latest redefinition with only plugins.wms appended (no other flag dropped or reordered). The backfill loop re-seeds existing orgs. revoke and grant to service_role preserved. Header block declares Wave 12, Phase B0, Closes, DOWN, date, Constitutional alignment. It does NOT touch RLS, money, idempotency, or audit_log DDL.',
  },
];
const reviews = await parallel(
  lenses.map((l) => () =>
    agent(
      [
        'Adversarially review the just-implemented WMS B0 chassis through ONE lens. Read the changed files in the working tree and the handoff section "B0. WMS chassis".',
        `Lens: ${l.brief}`,
        '',
        'Be concrete and skeptical. Default to flagging a real issue over inventing one. If the lens is clean, say so plainly. Return your verdict and findings with severity and file.',
      ].join('\n'),
      { label: `wms-b0-review:${l.key}`, phase: 'Review', schema: VERDICT },
    ).then((v) => ({ ...v, lens: l.key })),
  ),
);

return { impl, reviews: reviews.filter(Boolean) };
```

After the workflow returns, the supervising agent reads `impl.gates` (all must be pass), reads `reviews` (resolve every CRITICAL and HIGH, fold the rest by judgment), and fixes anything the implement agent left red. Re-run the affected gate after each fix. If a review finds a real defect, fix it as the single writer (preserve byte-mirror identity) and re-verify.

## 3. Steps the MAIN agent keeps (do not delegate to workflow agents)

- Apply the B0 migration to STAGING ONLY via the Supabase MCP `apply_migration` (project `dnkgaufydcnedgkuoyml`). Never push to prod via MCP; the post-merge file-based push ships prod and staging (see the MCP phantom-version note in memory). Confirm a freshly provisioned org gets `plugins.wms = false`, and that `/wms` resolves to NotFoundPage with the flag off.
- Open the B0 PR. Cite the risk closed (`F-Wave12-WMS-B0-01`), the constitutional invariants verified, and paste the gate results. Do not merge without the operator.
- There is no operator stop-point in B0. Build and PR it autonomously. The next stop-point is B2.

## 4. Gate set (B0)

`pnpm test:contract` (constants parity), `pnpm typecheck`, `pnpm lint` (max-warnings 0), `pnpm test` (full vitest including the new db static test and the updated sidebarModes test), `deno check` across ALL bundles including the new `wms-api`, `pnpm build`, `size-limit` (SPA index under 40 kB gz; the `/wms` page is lazy). A drift in any byte-mirror pair is a release blocker.

## 5. House rules (unchanged)

The Body B house rules in `2026-06-14-wms-bodyb-phase1-handoff.md` section 8 apply verbatim: brand voice on disk, byte-mirror release blockers, forward-only idempotent migrations with the full header block, NOT_FOUND not 403 for cross-tenant and flag-miss, `requireCap` on every state-changing handler, and the audit superset rule (not exercised in B0, which adds no entity_type). Every PR cites the risk closed, the follow-up spawned, and the constitutional invariants verified. Wave 12.
