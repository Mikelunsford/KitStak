import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, Check, CreditCard } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { billingKeys } from '@/lib/queryKeys/billing';
import {
  PLAN_CATALOG,
  createBillingPortalSession,
  createCheckoutSession,
  planByCode,
  type PlanCode,
  type PlanSpec,
} from '@/lib/services/billingService';
import { useSubscriptionGate } from '@/lib/hooks/useSubscriptionGate';

import {
  annualSavingsBadge,
  formatPlanPrice,
  isCurrentPlanCard,
  parseBillingUrlState,
  shouldShowManageInStripe,
} from './billingFormatters';

/**
 * /admin/billing. The Stripe-wiring SPA surface.
 *
 *   - Current plan card: status, plan name, trial countdown, period end,
 *     "Manage in Stripe" button (hidden until a stripe_customer_id exists).
 *   - Plan grid: six cards (3 tiers x 2 cadences). Each "Upgrade" /
 *     "Switch" button POSTs to /billing-api/checkout-session and
 *     redirects to the returned Stripe Checkout URL.
 *   - URL state: ?checkout=success | ?checkout=canceled | ?gated=true.
 */
export function BillingPage() {
  const gate = useSubscriptionGate();
  const qc = useQueryClient();
  const location = useLocation();
  const [pendingCode, setPendingCode] = useState<PlanCode | null>(null);
  const [portalPending, setPortalPending] = useState(false);

  const currentPlan = planByCode(gate.plan);

  // Handle URL state once per query-string change.
  useEffect(() => {
    const state = parseBillingUrlState(
      location.search,
      currentPlan?.displayName ?? null,
    );
    if (!state) return;
    if (state.kind === 'success') {
      const label = state.planDisplayName ?? 'your new plan';
      toast.success(`Subscription active. Welcome to ${label}.`);
      void qc.invalidateQueries({ queryKey: billingKeys.subscription });
    } else if (state.kind === 'canceled') {
      toast('Checkout canceled.');
    }
    // 'gated' is rendered inline below as a sticky banner; no toast.
  }, [location.search, currentPlan?.displayName, qc]);

  const checkoutMutation = useMutation({
    mutationFn: (plan: PlanCode) => createCheckoutSession(plan),
    onSuccess: ({ checkout_url }) => {
      window.location.assign(checkout_url);
    },
    onError: () => {
      toast.error('Could not start checkout. Try again.');
      setPendingCode(null);
    },
  });

  const portalMutation = useMutation({
    mutationFn: () => createBillingPortalSession(),
    onSuccess: ({ portal_url }) => {
      window.location.assign(portal_url);
    },
    onError: () => {
      toast.error('Could not open billing portal. Try again.');
      setPortalPending(false);
    },
  });

  const onUpgrade = (plan: PlanCode) => {
    setPendingCode(plan);
    checkoutMutation.mutate(plan);
  };

  const onManage = () => {
    setPortalPending(true);
    portalMutation.mutate();
  };

  const urlState = parseBillingUrlState(
    location.search,
    currentPlan?.displayName ?? null,
  );

  return (
    <div className="space-y-8 p-6">
      <header>
        <h1 className="font-display text-3xl text-ink">Billing</h1>
        <p className="font-sans text-sm text-ink-dim">
          Manage your Kitstak subscription. Pricing in USD.
        </p>
      </header>

      {urlState?.kind === 'gated' ? (
        <div
          role="status"
          className="border border-line bg-bg-2 px-4 py-3 font-sans text-sm text-ink"
        >
          Your trial has ended. Pick a plan to continue.
        </div>
      ) : null}

      <CurrentPlanCard
        loading={gate.isLoading}
        currentPlan={currentPlan}
        status={gate.status}
        trialDaysRemaining={gate.trialDaysRemaining}
        currentPeriodEnd={gate.data?.current_period_end ?? null}
        stripeCustomerId={gate.data?.stripe_customer_id ?? null}
        onManage={onManage}
        portalPending={portalPending || portalMutation.isPending}
      />

      <section>
        <h2 className="mb-4 font-display text-2xl text-ink">Pick a plan</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PLAN_CATALOG.map((plan) => (
            <PlanCard
              key={plan.code}
              plan={plan}
              isCurrent={isCurrentPlanCard(plan.code, gate.plan)}
              onUpgrade={onUpgrade}
              pending={pendingCode === plan.code && checkoutMutation.isPending}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CurrentPlanCard.
// ---------------------------------------------------------------------------

interface CurrentPlanCardProps {
  loading: boolean;
  currentPlan: PlanSpec | null;
  status: string | null;
  trialDaysRemaining: number;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  onManage: () => void;
  portalPending: boolean;
}

function CurrentPlanCard(props: CurrentPlanCardProps) {
  const {
    loading,
    currentPlan,
    status,
    trialDaysRemaining,
    currentPeriodEnd,
    stripeCustomerId,
    onManage,
    portalPending,
  } = props;

  if (loading) {
    return (
      <section className="border border-line bg-bg-2 p-5">
        <p className="font-sans text-sm text-ink-dim">Loading subscription.</p>
      </section>
    );
  }

  const isTrialing = status === 'trialing';
  return (
    <section className="border border-line bg-bg-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-ink-dim" aria-hidden="true" />
            <h2 className="font-display text-xl text-ink">Current plan</h2>
            {status ? <StatusBadge status={status} /> : null}
          </div>
          <p className="mt-3 font-display text-2xl text-ink">
            {currentPlan?.displayName ?? 'No plan selected'}
          </p>
          {currentPlan ? (
            <p className="font-sans text-sm text-ink-dim">
              {formatPlanPrice(currentPlan)}
            </p>
          ) : null}
          {isTrialing ? (
            <p className="mt-2 font-sans text-sm text-ink-dim">
              Trial:{' '}
              {trialDaysRemaining === 0
                ? 'ends today'
                : `${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'} left`}
            </p>
          ) : null}
          {currentPeriodEnd && !isTrialing ? (
            <p className="mt-2 font-sans text-sm text-ink-dim">
              Renews {formatPeriodEnd(currentPeriodEnd)}
            </p>
          ) : null}
        </div>
        {shouldShowManageInStripe(stripeCustomerId) ? (
          <Button
            variant="secondary"
            onClick={onManage}
            disabled={portalPending}
            data-testid="manage-in-stripe"
          >
            {portalPending ? 'Opening.' : 'Manage in Stripe'}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function formatPeriodEnd(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="border border-line bg-bg px-2 py-0.5 font-sans text-[10px] uppercase tracking-wider text-ink-dim">
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PlanCard.
// ---------------------------------------------------------------------------

interface PlanCardProps {
  plan: PlanSpec;
  isCurrent: boolean;
  onUpgrade: (plan: PlanCode) => void;
  pending: boolean;
}

function PlanCard({ plan, isCurrent, onUpgrade, pending }: PlanCardProps) {
  const badge = annualSavingsBadge(plan);
  return (
    <article
      className={`flex flex-col border bg-bg-2 p-5 ${
        isCurrent ? 'border-accent' : 'border-line'
      }`}
      data-testid={`plan-card-${plan.code}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-xl text-ink">{plan.tierLabel}</p>
          <p className="font-sans text-xs uppercase tracking-wider text-ink-dim">
            {plan.cadenceLabel}
          </p>
        </div>
        {badge ? (
          <span className="border border-accent bg-accent/10 px-2 py-0.5 font-sans text-[10px] uppercase tracking-wider text-ink">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-4 font-display text-3xl text-ink" data-testid={`plan-price-${plan.code}`}>
        {formatPlanPrice(plan)}
      </p>
      <div className="mt-auto pt-5">
        {isCurrent ? (
          <p
            className="inline-flex items-center gap-2 font-sans text-sm font-medium text-ink"
            data-testid={`plan-current-${plan.code}`}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Current plan
          </p>
        ) : (
          <Button
            variant="primary"
            onClick={() => onUpgrade(plan.code)}
            disabled={pending}
            className="flex items-center gap-2"
            data-testid={`plan-upgrade-${plan.code}`}
          >
            {pending ? 'Redirecting.' : 'Switch to this plan'}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </article>
  );
}
