// FirstSigninWelcomeBanner. Welcome surface shown above the password
// form on /account/security when the operator arrives via the first-mount
// dashboard redirect (URL param `?welcome=1`).
//
// F-Wave9-INVITE-PASSWORD-PROMPT-01. Kept presentational and free of
// react-router / useMe hooks so it can be unit-tested the same way as
// SetupCompleteCelebration: render to a tree and walk it. The parent
// SecurityPage owns the search-param read, the user-id read, and the
// localStorage write; this component only renders the surface and emits
// a `skip` callback when the secondary action is clicked.
//
// Visual family matches SetupCompleteCelebration intentionally: same
// bg-bg-2 surface, accent top border, accent-toned lucide icon, display
// headline, sans body. We use `KeyRound` instead of `Sparkles` because
// the surface lives on a security page; the icon should reinforce
// "set a password", not generic celebration.
//
// The Skip secondary action is a button (not an anchor) because it
// fires a side effect (mark-seen) before navigating, and the navigation
// itself uses react-router's `useNavigate` from the parent rather than
// a hard <a href>.

import { KeyRound } from 'lucide-react';

export interface FirstSigninWelcomeBannerProps {
  /**
   * Fires when the operator clicks "Skip for now". Parent is responsible
   * for marking the prompt as seen and navigating to the dashboard.
   */
  onSkip: () => void;
}

export function FirstSigninWelcomeBanner({
  onSkip,
}: FirstSigninWelcomeBannerProps) {
  return (
    <section
      aria-label="Welcome to Kitstak"
      data-testid="first-signin-welcome-banner"
      className="relative flex items-start gap-4 border border-line border-t-2 border-t-accent bg-bg-2 px-6 py-5"
    >
      <KeyRound
        size={28}
        strokeWidth={2}
        className="mt-1 shrink-0 text-accent"
        aria-hidden="true"
        data-testid="first-signin-welcome-icon"
      />
      <div className="flex flex-1 flex-col gap-1">
        <h2
          className="font-display text-2xl tracking-wide text-ink"
          data-testid="first-signin-welcome-headline"
        >
          Welcome to Kitstak
        </h2>
        <p
          className="font-sans text-sm text-ink-dim"
          data-testid="first-signin-welcome-body"
        >
          Set a password below so you can sign in directly next time. You
          can also skip and stay magic-link only; either way works.
        </p>
        <div className="mt-2">
          <button
            type="button"
            onClick={onSkip}
            className="font-sans text-sm text-ink-dim underline-offset-2 hover:text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent px-2 py-1"
            data-testid="first-signin-skip-button"
          >
            Skip for now
          </button>
        </div>
      </div>
    </section>
  );
}
