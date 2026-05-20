# Close F-Wave2-DNDKIT-01: drag-and-drop phase reorder via lazy-loaded `@dnd-kit`

**Date:** 2026-05-20
**Decision:** Add the three `@dnd-kit` packages as a lazy-loaded chunk; preserve Up / Down buttons as the keyboard / click fallback.
**Filed by:** Operator dispatch (`F-Wave2-DNDKIT-01`) following PR #56 / pdf-worker close.

## Motivation

`F-Wave2-DNDKIT-01` has carried since the Wave 2 domain ports close. It was the last operator-gated UX deferment that could be unlocked by one approved dependency, and the only drag-and-drop surface the SPA has today. ProjectDetailPage's PHASES section reorders phases via Up / Down buttons on every row; the operator wanted a proper handle-drag interaction for the same flow.

`00-canon/01-architecture.md` already referenced `@dnd-kit` as the intended library for this work but the dependency had never landed in `apps/web/package.json`. Operator approval cleared the dep block; this PR is the implementation.

## The lazy-load decision

The main SPA index chunk sits at **29.75 kB / 40 kB** at baseline `1fc1b72`. Adding `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` as top-level imports of `ProjectDetailPage.tsx` would land roughly 13 kB gzipped in the main chunk, pushing it close to or over the 40 kB constitutional cap. That cap exists for a reason (first-load TTI on slow connections in operator field offices) and is not negotiable.

The route boundary `ProjectDetailPage` is itself lazy-loaded via `React.lazy()` in `routes.ts`, so a nested `React.lazy(() => import('./PhasesSection'))` cleanly produces a separate Vite chunk that only loads when an operator actually visits a project detail. The Suspense fallback renders the existing Up / Down-only version of the list so the section is never blank while the chunk fetches.

Two alternatives considered and rejected:

1. **Top-level imports.** Rejected: pushes the main chunk over budget. Even if it fit today, it would consume future headroom for no reason; only ProjectDetailPage uses dnd-kit.
2. **Dynamic `import()` triggered on first drag interaction.** Rejected: more complex than `React.lazy` + `Suspense`, requires a manual ready-state shim, and offers no measurable benefit because the route is already split.

## Bundle inspection result

Post-build with `pnpm build`:

| Chunk | Raw | Gzip |
|---|---|---|
| `index-<hash>.js` (main SPA chunk) | 125.06 kB | **29.87 kB** |
| `ProjectDetailPage-<hash>.js` | 11.32 kB | 3.42 kB |
| `PhasesSection-<hash>.js` (new, dnd-kit lives here) | 48.94 kB | **16.56 kB** |

`pnpm bundle-budget` reports **29.79 kB / 40 kB** for the index chunk. Delta from the `1fc1b72` baseline is +0.04 kB (the `lazy` + `Suspense` wiring in ProjectDetailPage); none of the dnd-kit code reaches the main chunk. Confirmed by inspecting `apps/web/dist/assets/` after the build: the PhasesSection chunk is the only file whose minified contents reference `DndContext` / `useSortable` / `sortableKeyboardCoordinates`.

## Accessibility posture

Three layers, in order of preference:

1. **Drag the GripVertical handle** with a pointer device. PointerSensor `activationConstraint: { distance: 4 }` so a click anywhere else on the card cannot trigger a drag accidentally; only a deliberate 4-pixel pull does.
2. **Keyboard via the GripVertical handle.** KeyboardSensor wired with `sortableKeyboardCoordinates`. Tab to the handle (it is a `<button>`), Space to pick up, ArrowUp / ArrowDown to move, Space again to drop. Standard dnd-kit keyboard contract.
3. **Up / Down buttons** on every row. Preserved verbatim from the existing UI. Survive even if the lazy chunk fails to load (Suspense fallback) or dnd-kit's keyboard sensor breaks. These are the constitutional accessibility baseline; drag-and-drop is additive.

The drag handle is a real `<button type="button">` with an `aria-label` of `"Drag to reorder phase <name>"`, has a visible focus ring (`focus:outline focus:outline-2 focus:outline-accent`), and uses ink at 60% opacity transitioning to the accent color on hover or focus. No new brand colors were invented.

## Optimistic update strategy

`onDragEnd` (and the Up / Down `movePhase` helper) write the reordered list to a local `optimistic` state immediately, then fire `reorder.mutate({ phase_ids })`. On `onError`, local state reverts to the server's `phases` truth. On `onSuccess`, React Query invalidates `projectsKeys.byId(projectId)`, the page re-fetches, the `phases` prop updates, and a `useEffect([phases])` re-syncs the optimistic state to the canonical order. No flicker because the optimistic order should match what the server returns.

The mutation contract is unchanged: server still receives `{ phase_ids: string[] }`. Idempotency-Key header is still applied by `apiClient` on the underlying `reorderPhases` POST. The `useReorderPhases` hook signature is byte-identical to the version that shipped pre-dnd-kit.

## Canon-steward / trigger-audit posture

The new file `apps/web/src/pages/3pl-operations/projects/PhasesSection.tsx` carries no stale narrative TODOs, no Phase 6.5 markers, and no banned-import patterns. `node scripts/canon-steward-check.mjs` exits 0 against the post-edit tree; `node scripts/trigger-audit-check.mjs` exits 0 (no migration touched).

## What was NOT done (intentionally)

- **No regression test for the drag gesture itself.** The existing vitest setup runs in node + jsdom; jsdom does not synthesise real PointerEvents in the way dnd-kit's PointerSensor needs to activate a drag. A meaningful drag test would require either Playwright e2e (already scaffolded but not invoked for this PR; the smoke spec at `apps/web/test/e2e/smoke.spec.ts` is the right place when `F-Wave5-TEST-02` lights up) or a dnd-kit-specific testing harness. The optimistic-update logic and the `arrayMove` math are exercised indirectly via the Up / Down path which calls the same `reorder.mutate` shape.
- **No new caps.** Phase reorder is already gated by the existing `project.phase.reorder` cap on the server. SPA mirrors that gate via the existing `useReorderPhases` hook; no SPA cap change needed because the operation is server-authoritative.
- **No migrations.** Pure SPA work.
- **TS1 read-only zone untouched.**
- **Side-car parity untouched.**

## Constitutional alignment

- **What we use:** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` added as approved exceptions for the phase-reorder UI. All three are MIT-licensed. Constitution `00-canon/01-architecture.md` already named dnd-kit as the intended library; this PR closes the gap.
- **What we refuse:** unchanged. dnd-kit does NOT pull `react-beautiful-dnd` or `react-dnd` as transitive deps (verified via `grep` of the `node_modules/@dnd-kit/*/package.json` files).
- **Brand discipline:** drag handle uses `text-ink/60` (ink at 60% opacity, no new color), `hover:text-accent` and `focus:text-accent` on the existing accent. No new color tokens introduced.
- **No em dashes, no double hyphens, no emojis** anywhere in the new file, the journal, the STATUS.md edits, or the PR body.
- **TS1 read-only zone:** untouched.
- **Money rules / RLS / migrations / idempotency / audit log / capabilities:** all untouched; this is a SPA-only interaction layer change.

## Changes shipped in this PR

- `apps/web/src/pages/3pl-operations/projects/PhasesSection.tsx`: new lazy-loaded sortable phases section with dnd-kit, GripVertical handle, optimistic update, preserved Up / Down buttons, and FSM-driven state-transition buttons.
- `apps/web/src/pages/3pl-operations/projects/ProjectDetailPage.tsx`: replaced inline PHASES `<section>` body with `<Suspense fallback={<PhasesFallback .../>}><PhasesSection .../></Suspense>`. Added `PhasesFallback` component at the bottom of the file (static Up / Down version, no dnd-kit). `movePhase` helper kept for the fallback.
- `apps/web/package.json`: three new deps at the next-to-latest stable lines (`@dnd-kit/core@^6.1.0` resolved to 6.3.1; `@dnd-kit/sortable@^8.0.0`; `@dnd-kit/utilities@^3.2.2`).
- `pnpm-lock.yaml`: regenerated with the three new packages and their transitive `tslib` dep.
- `STATUS.md`: moved `F-Wave2-DNDKIT-01` out of "Operator-gated" into "Closed in this session (Phase 8 follow-up batch)"; date stamp bumped to 2026-05-20 (Phase 8 follow-up batch addendum).
- This journal entry.

## Verification

| Gate | Result |
|---|---|
| `pnpm typecheck` | green, zero errors |
| `pnpm lint` | green, zero errors / zero warnings |
| `pnpm test` | green, 21 passed / 2 skipped |
| `pnpm test:contract` | green, 20 / 20 (parity 17 + money parity 3) |
| `pnpm build` | green, dnd-kit lands in its own `PhasesSection-<hash>.js` chunk |
| `pnpm bundle-budget` | green, **29.79 kB / 40 kB** (delta +0.04 kB from baseline) |
| `node scripts/canon-steward-check.mjs` | exit 0 |
| `node scripts/trigger-audit-check.mjs` | exit 0 |

## Closes

- `F-Wave2-DNDKIT-01`.

## Preserved

- Up / Down phase reorder buttons on every row (accessibility baseline + keyboard / click fallback).
- `useReorderPhases` hook signature.
- Server contract: `POST /projects-api/projects/:id/phases/reorder` body shape `{ phase_ids: string[] }`.
- Idempotency-Key header behavior on the underlying mutation.
- `ProjectDetailPage` route-level lazy load (the new PhasesSection lazy is nested inside it).
