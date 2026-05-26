# 2026-05-26 - Setup Complete Celebration Banner

Status: shipped via PR (pending).
Branch: `feat/setup-complete-celebration`.
Closes: `F-Wave9-CHECKLIST-CELEBRATION-01`.
Builds on: PR #144 (SetupChecklist) and PR #143 (provision-org completeness).

## Why this work

PR #144 shipped the 7-step SetupChecklist. The follow-up
`F-Wave9-CHECKLIST-CELEBRATION-01` was filed to add a one-shot
acknowledgement the first time an operator transitions from the checklist
to the work-card grid. The checklist is purely derived from entity counts,
so the transition is the only durable signal we have for "you got it
done." Operators have one chance to feel the milestone; if we miss it the
moment is gone forever.

The banner also screenshots well for marketing. The operator explicitly
flagged this as a surface that will show up in product imagery, so brand
discipline mattered more here than in the typical internal-tooling
surface.

## What shipped

### SPA

- `apps/web/src/pages/setupCelebrationState.ts` - pure helper exporting
  `hasSetupCelebrationBeenShown(orgId)`, `markSetupCelebrationShown(orgId)`,
  and `setupCelebrationStorageKey(orgId)`. Storage namespace is
  `kitstak:setup-celebration-shown:<org_id>` so a multi-org user
  celebrates once per workspace they bring to completion. No React import;
  testable under Vitest without jsdom, matching the
  `dashboardChecklistSteps.ts` pattern. Every storage access is wrapped
  in a try/catch and a `safeLocalStorage()` guard so SSR, private
  browsing, and quota-exceeded scenarios degrade silently instead of
  crashing the dashboard render.

- `apps/web/src/components/shell/SetupCompleteCelebration.tsx` - new
  component. Horizontal banner with an accent-colored top border on a
  `bg-bg-2` surface. Lucide `Sparkles` icon in the accent color (chosen
  over `PartyPopper` because Sparkles reads as a quiet milestone marker
  rather than a confetti modal, and confetti is explicitly forbidden by
  the constitution). Headline `SETUP COMPLETE` in
  `font-display tracking-wide`; tagline `Built to Ship.` in
  uppercase-tracked `font-sans` accent; body line points the operator at
  what is now visible. Dismiss button is a lucide `X` in the top-right
  with `text-ink-dim` baseline and `hover:text-accent`. Fade-in is a
  300ms ease-out opacity transition driven by a `requestAnimationFrame`
  state flip, so no animation library is needed.

- `apps/web/src/pages/DashboardPage.tsx` - wired. Reads
  `me.data?.active_org_id` via the existing `useMe` hook. Renders the
  banner above the `WorkCardGrid` when ALL of:
  1. `isSetupComplete(summary)` is true.
  2. An `active_org_id` is known.
  3. The operator has not dismissed in this session (`dismissed` local
     state).
  4. `hasSetupCelebrationBeenShown(activeOrgId)` returns false.
  Dismiss calls `markSetupCelebrationShown(activeOrgId)` so the flag
  flips and the banner never returns for that org.

### Tests

- 10 new pure-helper tests in `setupCelebrationState.test.ts` covering:
  - Storage key shape (per-org namespacing).
  - Empty-storage default returns false.
  - Round-trip via `markSetupCelebrationShown` returns true.
  - Per-org isolation: marking org A leaves org B at false.
  - Empty `orgId` short-circuits without touching storage.
  - SSR (no `window`) does not throw; returns false.
  - Throwing storage (private browsing, quota) does not throw; returns
    false.
  - `markSetupCelebrationShown` does not throw under either failure
    mode and is a no-op for empty `orgId`.

Pure-only test surface keeps with the repo convention of "no jsdom"; the
helper itself guards every storage path so a minimal in-memory `Storage`
shim is enough to exercise both the happy path and the defensive
fallbacks.

## Constitutional invariants verified

| Invariant | Outcome |
|---|---|
| Money rules | Untouched. No `_cents` columns or wire shapes affected. |
| RLS rules | Untouched. No new API surface. |
| Audit rules | Untouched. No new mutations; the dismiss flag is client-side state only. |
| Migration rules | No migration needed. Pure SPA addition. |
| Idempotency | Not applicable. No non-GET handlers added. |
| Zod canon | Untouched. No `_shared` or `types.ts` changes. |
| Brand discipline | All copy linted: no em dash, no double hyphen, no emoji, no confetti. Sparkles icon is muted, not celebratory. |
| No new top-level dependencies | Confirmed. Reuses existing `lucide-react` icons (`Sparkles`, `X`) and CSS transitions only. |
| Tailwind tokens only | Confirmed. `bg-bg-2`, `border-line`, `border-t-accent`, `text-ink`, `text-ink-dim`, `text-accent`, `font-display`, `font-sans` exclusively. |

## Bundle delta

- Main bundle (`index-*.js`): `30.40 kB` gzipped (was `30.39 kB`; +0.01
  kB). Well within the +0.5 kB main-bundle ceiling.
- DashboardPage chunk: `11.73 kB / 3.88 kB gzipped` (was `9.00 kB /
  3.03 kB gzipped`; +2.73 kB raw / +0.85 kB gzipped). The new banner
  component and the pure helper land in the lazy DashboardPage chunk so
  they only download on dashboard navigation.

## Design decisions worth flagging

- **`Sparkles` over `PartyPopper`.** Both are in the existing
  `lucide-react` bundle. PartyPopper reads as a consumer celebration
  pattern (Slack, Discord); Sparkles is the same family of "milestone"
  marker that Linear, Stripe, and Notion use for product progress states
  without veering juvenile. The operator runs B2B ops software for
  warehouse/manufacturing teams.
- **Defensive `hasSetupCelebrationBeenShown` returns false on storage
  failure.** In an unstorable environment (SSR, private browsing) the
  banner may re-appear on subsequent visits. We chose this over the
  alternative (return true to suppress) because the banner is small,
  one-line, and easily dismissed; a missed celebration would feel worse
  than an occasional re-appearance for the SSR/private-browsing long
  tail.
- **No telemetry on dismiss.** PostHog is wired but instrumenting a
  one-shot banner adds noise without insight; if a follow-up surfaces a
  question like "what fraction of completers acknowledge?" we can add it
  then.
- **Per-org localStorage namespace.** A user with memberships in two
  orgs gets to feel the milestone for each. Matches the spirit of
  "celebrate the WORKSPACE that got it done, not the user."
- **Local `dismissed` state in addition to the storage check.** The
  banner unmounts on click without waiting for a re-render to observe
  the storage write. Defends against React-Query refetch races.

## Out of scope (potential follow-ups)

| Follow-up | Why deferred |
|---|---|
| Analytics event on dismiss | One-shot signal, low expected information yield. Reopen if marketing or product surfaces a conversion question. |
| Dashboard-level "tour" surface | Operator has not asked for one. The banner is the lightest possible acknowledgement; a tour is a different product decision. |
| Server-side persistence of the "shown" flag | Cross-device parity is overkill for a one-line one-shot. localStorage is fine. |
