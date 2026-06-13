import { Link } from 'react-router-dom';
import { CreditCard } from 'lucide-react';

import {
  useSubscriptionGate,
  TRIAL_GATE_FLAG,
} from '@/lib/hooks/useSubscriptionGate';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';

// ---------------------------------------------------------------------------
// Pure copy helper. Centralised so tests can pin the wording without
// rendering React.
// ---------------------------------------------------------------------------

export function trialBannerCopy(daysRemaining: number): string {
  if (daysRemaining <= 0) return 'Trial ends today. Pick a plan.';
  if (daysRemaining === 1) return 'Trial ends in 1 day. Pick a plan.';
  return `Trial ends in ${daysRemaining} days. Pick a plan.`;
}

/**
 * Visibility predicate. Banner is shown only when trial-gate enforcement is
 * turned on for the org AND the org is trialing AND has three or fewer days
 * left. Enforcement defaults off (TRIAL_GATE_FLAG absent), so the nag stays
 * silent until the operator opts in to monetize, matching the
 * <SubscriptionGate> wall. Lapsed trials are walled by that redirect, not by
 * this banner.
 */
export function shouldShowTrialBanner(input: {
  enforcementEnabled: boolean;
  isTrialing: boolean;
  trialDaysRemaining: number;
}): boolean {
  if (!input.enforcementEnabled) return false;
  return input.isTrialing && input.trialDaysRemaining <= 3;
}

// ---------------------------------------------------------------------------
// TrialBanner component. Sticky, undismissible, lives above the Topbar.
// Uses the accent token (Kitstak brand red) so it reads as a billing-
// pressure cue instead of a transient notification.
// ---------------------------------------------------------------------------

export function TrialBanner() {
  const gate = useSubscriptionGate();
  const orgFlags = useOrgFlags();
  const enforcementEnabled = orgFlags.data[TRIAL_GATE_FLAG] === true;
  if (
    !shouldShowTrialBanner({
      enforcementEnabled,
      isTrialing: gate.isTrialing,
      trialDaysRemaining: gate.trialDaysRemaining,
    })
  ) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-30 flex items-center justify-center gap-3 border-b border-line bg-accent px-4 py-2 text-ink"
    >
      <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="font-sans text-sm font-medium tracking-wide">
        {trialBannerCopy(gate.trialDaysRemaining)}
      </span>
      <Link
        to="/admin/billing"
        className="border border-ink bg-transparent px-3 py-1 font-sans text-xs font-medium uppercase tracking-wider text-ink hover:bg-ink hover:text-accent"
      >
        Choose plan
      </Link>
    </div>
  );
}
