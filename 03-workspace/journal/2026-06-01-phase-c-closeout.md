# Phase C closeout (full-DoD plan) 2026-06-01

Phase C of the full-DoD-green plan (WS7 polish). Three PRs, three disjoint parallel worktree agents, all merged to prod main (baseline e719e57 to ebb62e4). Migration-free.

## Shipped

### #199 CI gates
- Expanded the size-limit budget from one entry to seven, adding budgets for the significant lazy chunks (React vendor, Supabase vendor, TanStack Query, Sonner, the dnd-kit phases chunk, and the KitCost/recharts chunk). The KitCost entry specifically pins recharts inside its lazy chunk so it never bleeds into the main SPA index. All seven pass at current sizes with headroom.
- Rewired lighthouse.yml to support two modes selected automatically: static (build locally, run against dist, no extra secret) and preview (resolve the Vercel preview URL with a protection-bypass header). The existing LIGHTHOUSE_ENABLED gate is unchanged, so the job stays a no-op and CI does not turn red until the operator opts in.

### #200 PILLARS card (closes SMOKE-09)
- Root cause: the pillar-tile spec only set hideWhenOff on two of the five pillar tiles, so the other three always rendered regardless of org plugin state (the fixed three-card row).
- Fix: hideWhenOff on all five tiles, and a new PillarGrid component with three states (loading skeletons, an empty-state when no pillars are enabled, and a responsive 1-to-5 card grid). The tile-visibility filter was already correct; the specs just had to ask for gating. Fifteen tests assert the contract (all-on gives five, all-off gives zero, each flag gates exactly its tile).

### #201 list-page polish (WS7)
- Client-side pagination (page size 50, prev/next, hidden when the list is short, filters reset to page 0) on eight list pages: invoices, payments, credit notes, items, customers, contacts, activities, journal entries.
- formatCents applied where a list column rendered a raw cents value: purchase orders, vendor bills, expenses.
- FK-UUID labels: no change needed. The pages that show member references already resolve names via a local member map, matching the EntityLabel posture.

## Follow-ups filed
- **F-WS7-SERVER-PAGINATION**: the #201 pagination is client-side only (the list endpoints load all rows). Add server-side limit/offset to the ops, vendors, expenses, kitforce, copack, and manufacturing list endpoints, then switch the SPA pagination to server-backed.

## Operator action queued
- Lighthouse activation: generate a Vercel Deployment Protection bypass secret, add it as the GitHub repo secret VERCEL_AUTOMATION_BYPASS_SECRET, and set the repo variable LIGHTHOUSE_ENABLED to true. No workflow edits needed after that.

## Constitutional invariants verified
- Money rules: formatCents is display-only; values stay in cents. No floats introduced.
- No migrations, no RLS changes, no audit_log changes, byte-mirror parity untouched (no canon files changed in Phase C).
- Bundle within the size-limit budget (main SPA index 37.05 kB of 40 kB).
- CI never turned red: the lighthouse change stays a no-op until the operator opts in.
- Brand voice held on disk across all files, commits, and PRs.

## Process notes
- Three disjoint agents (CI config files, DashboardPage, list pages) ran in parallel with no shared-file overlap, so all three merged without conflict.
- The display helpers (formatCents, EntityLabel) and the pagination pattern already existed and were widely used, so Phase C was gap-filling with established patterns rather than net-new work.
- Full-DoD plan Phases A, B, and C all shipped on 2026-06-01. Remaining work is Phase D (verify), which is mostly operator-gated, plus the operator-owned v1 gates.
