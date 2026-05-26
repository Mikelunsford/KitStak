# 2026-05-26: first-signin password prompt with skip option

PR F (#150, merged earlier today) shipped the password chassis: signed-in
`/account/security` page, public `/auth/recovery` page that consumes a
Supabase recovery token, and a Forgot-password link on `/signin`. Live
verification with `accounts@team-01.com` confirmed the chassis works: a
staff invitee clicks the magic-link email, lands on `/dashboard` clean,
no 401s. But the invitee has no password set. If they sign out, they
cannot sign back in via `/signin` until they round-trip through the
recovery loop.

This follow-up closes the gap: nudge invitees toward setting a password
on their very first dashboard arrival, while keeping the dashboard
reachable (skip stays in-product and never blocks).

## Closes

- `F-Wave9-INVITE-PASSWORD-PROMPT-01`: first-signin password prompt
  surface. Out of scope for PR F.

## What shipped

### New pure helper

- `apps/web/src/pages/firstSigninPromptState.ts`. Per-user localStorage
  flag (`kitstak:password-prompt-seen:<user_id>`). Mirrors
  `setupCelebrationState.ts` exactly: pure (no React), guarded against
  SSR, private browsing, locked-down embedded webviews, and
  quota-exceeded writes. Empty userId is a no-op on both read and
  write so callers cannot accidentally mark "" as seen.

### Dashboard redirect on first mount

- `apps/web/src/pages/DashboardPage.tsx`. On mount, once `useMe()`
  resolves, if the userId has never seen the prompt, the page calls
  `navigate('/account/security?welcome=1', { replace: true })`.
  - Gated on `!me.isLoading && me.data?.user_id` so the effect never
    fires with an empty userId (which would otherwise re-fire forever
    because `hasSeenPasswordPrompt('')` always returns false).
  - `replace: true` removes `/dashboard` from history so the operator
    cannot back-button bounce out of the welcome flow.

### SecurityPage welcome branch + skip

- `apps/web/src/pages/account/SecurityPage.tsx`. Reads the `?welcome=1`
  search param. When present, renders `FirstSigninWelcomeBanner` above
  the password form. The password form's success handler marks the
  prompt as seen, on every successful set (not only when arriving via
  `?welcome=1`); a user who comes here directly to change their password
  has clearly engaged with the surface and should not see the welcome
  redirect later.
- `apps/web/src/pages/account/FirstSigninWelcomeBanner.tsx`. New
  presentational component (no hooks) so it follows the
  `SetupCompleteCelebration` family pattern and is unit-testable via
  the repo's no-jsdom render-as-function pattern. KeyRound icon (on
  theme for a security surface, vs. Sparkles for the dashboard
  celebration), display headline `WELCOME TO KITSTAK`, body explaining
  that skip stays magic-link only, secondary `Skip for now` button that
  fires the parent-supplied `onSkip` callback (mark-seen +
  `navigate('/dashboard')`).

### Tests

- `apps/web/src/pages/firstSigninPromptState.test.ts`. Empty-storage
  read returns false; mark/check round-trip; per-user isolation; empty
  userId is a no-op; defensive against SSR (no window) and throwing
  storage (private browsing, quota exceeded).
- `apps/web/src/pages/account/FirstSigninWelcomeBanner.test.ts`.
  Renders headline, body, KeyRound icon, Skip button with the
  documented testid; onSkip wiring fires the callback exactly once;
  copy-discipline branch rejects em dash, en dash, double hyphen,
  and emoji in any rendered string.

## Constitutional alignment

- Brand voice: zero em dashes, en dashes, double hyphens, or emoji on
  disk. Copy uses periods and semicolons only. Welcome headline is
  `WELCOME TO KITSTAK` (one word, capital K only).
- No new top-level dependencies. `lucide-react` already in the bundle;
  `KeyRound` is a free icon.
- Tailwind tokens only (`bg-bg-2`, `border-line`, `border-t-accent`,
  `text-accent`, `text-ink`, `text-ink-dim`, `font-display`,
  `font-sans`, `tracking-wide`). No hex values.
- Capabilities: none required. The route is `/account/security` which
  is already protected; every user has the right to manage their own
  password. The redirect side of the flow is `DashboardPage`'s own
  protected mount; no cap check required to bounce a logged-in user
  to their own account page.
- RLS: untouched. No database changes.
- Money: untouched.
- Migrations: none.
- Audit log: untouched.
- canon-steward-check: passes locally. `/account/security` is already
  in the allowlist as orphan-by-design (Topbar profile-dropdown link,
  added in PR F).

## Verification

- `pnpm typecheck`: clean.
- `pnpm test`: 204 passed, 2 skipped (status quo).
- `pnpm test:contract`: 20 passed.
- `pnpm build`: clean. DashboardPage chunk grew from 11.78 kB to
  12.18 kB (gzip 4.07 kB); SecurityPage chunk gained the banner +
  KeyRound import. No change to the index chunk or any vendor bundle.
- `node scripts/canon-steward-check.mjs`: exit 0.

## Risks

- Risk: a user clears localStorage and gets re-prompted. Accepted: the
  prompt is short and the skip is one click; re-priming an
  already-set-password user is a minor annoyance, not a flow break.
- Risk: a user with two browsers / two devices sees the prompt twice
  (per-device storage). Accepted: same reasoning. The mark-seen-on-
  success branch also helps because once the password is set, the
  recovery loop is no longer required and the prompt's value is gone.
- Risk: an SSO-only future tenant would not benefit from the prompt.
  Accepted: deferred; SSO-only branching ships when the SSO surface
  does.

## Follow-ups spawned

None. This is a closed leaf of the auth surface for the magic-link era.
A future SSO chassis (deferred) would gate the prompt on tenant
configuration; that decision belongs to whichever wave delivers SSO.
