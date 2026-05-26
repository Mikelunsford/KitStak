// SetupCompleteCelebration. One-shot dashboard banner shown the first
// time an operator transitions from the SetupChecklist to the work-card
// grid.
//
// F-Wave9-CHECKLIST-CELEBRATION-01. The banner is dismissible, persists a
// per-org "shown" flag in localStorage on dismiss, and never returns for
// that org once acknowledged. The dashboard decides whether to render
// the banner at all by combining `isSetupComplete(summary)` with
// `hasSetupCelebrationBeenShown(activeOrgId)` from setupCelebrationState.
//
// Visual family: matches WorkCard, SetupChecklist, and ListEmptyState
// surface tokens (bg-2 surface, accent for the top border, font-display
// tracking-wide for the headline, font-sans for the body). The icon is
// Sparkles for warmth without juvenility; it stays small and accent-toned
// rather than centered or oversized so the banner reads as a progress
// marker, not a confetti modal. Confetti and emojis are forbidden by the
// constitution; this surface follows that line. A 300ms ease-out fade-in
// is driven by Tailwind transition utilities applied on the first frame
// after mount, so we do not need an animation library.

import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';

import { markSetupCelebrationShown } from '@/pages/setupCelebrationState';

export interface SetupCompleteCelebrationProps {
  /** Active org id. Used as the localStorage namespace on dismiss. */
  orgId: string;
  /** Optional dismiss observer. Fires AFTER the storage write. */
  onDismiss?: () => void;
}

export function SetupCompleteCelebration({
  orgId,
  onDismiss,
}: SetupCompleteCelebrationProps) {
  // Fade-in. Start opacity-0 then flip on the next frame so the transition
  // animates instead of mounting in its final state.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  function handleDismiss() {
    markSetupCelebrationShown(orgId);
    onDismiss?.();
  }

  return (
    <section
      data-testid="setup-complete-celebration"
      aria-label="Setup complete"
      className={[
        'relative flex items-start gap-4 border border-line border-t-2 border-t-accent bg-bg-2 px-6 py-5',
        'transition-opacity duration-300 ease-out',
        visible ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
    >
      <Sparkles
        size={28}
        strokeWidth={2}
        className="mt-1 shrink-0 text-accent"
        aria-hidden="true"
        data-testid="setup-complete-celebration-icon"
      />
      <div className="flex flex-1 flex-col gap-1">
        <h2
          className="font-display text-2xl tracking-wide text-ink"
          data-testid="setup-complete-celebration-headline"
        >
          SETUP COMPLETE
        </h2>
        <p
          className="font-sans text-sm uppercase tracking-wide text-accent"
          data-testid="setup-complete-celebration-tagline"
        >
          Built to Ship.
        </p>
        <p
          className="font-sans text-sm text-ink-dim"
          data-testid="setup-complete-celebration-body"
        >
          Your dashboard is now showing today's work. Here is what is open.
        </p>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss setup complete notice"
        data-testid="setup-complete-celebration-dismiss"
        className="ml-2 shrink-0 p-1 text-ink-dim transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X size={20} strokeWidth={2} aria-hidden="true" />
      </button>
    </section>
  );
}
