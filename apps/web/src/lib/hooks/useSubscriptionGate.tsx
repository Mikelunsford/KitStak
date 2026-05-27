import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { useAuthOptional } from '@/auth/AuthContext';
import { billingKeys } from '@/lib/queryKeys/billing';
import {
  getSubscription,
  type PlanCode,
  type Subscription,
} from '@/lib/services/billingService';

import {
  isPathAllowlistedForGate,
  isSubscriptionExpired,
  trialDaysRemainingFor,
  type SubscriptionStatus,
} from './subscriptionGateHelpers';

// Re-export the pure helpers so existing callers (and tests) can keep
// importing from the public hook surface if they prefer.
export {
  SUBSCRIPTION_ALLOWLIST,
  SUBSCRIPTION_ALLOWLIST_PREFIXES,
  isPathAllowlistedForGate,
  isSubscriptionExpired,
  trialDaysRemainingFor,
} from './subscriptionGateHelpers';
export type { SubscriptionStatus } from './subscriptionGateHelpers';

// ---------------------------------------------------------------------------
// Public hook surface.
// ---------------------------------------------------------------------------

export interface SubscriptionGateState {
  status: SubscriptionStatus | null;
  isTrialing: boolean;
  trialDaysRemaining: number;
  isExpired: boolean;
  plan: PlanCode | null;
  isLoading: boolean;
  data: Subscription | undefined;
}

/**
 * Subscription state hook. Mirrors the chassis policy for queries
 * (staleTime 30_000, refetchOnWindowFocus false, retry 1; inherited
 * from the QueryClient defaults in main.tsx).
 *
 * Disabled until auth resolves so the billing-api fetch never fires
 * unauthenticated.
 */
export function useSubscriptionGate(): SubscriptionGateState {
  const auth = useAuthOptional();
  const enabled = auth ? auth.state.status === 'authenticated' : false;
  const query = useQuery({
    queryKey: billingKeys.subscription,
    queryFn: getSubscription,
    enabled,
  });
  const data = query.data;
  const status = data?.status ?? null;
  const trialEndsAt = data?.trial_ends_at ?? null;
  const isTrialing = status === 'trialing';
  const isExpired = status
    ? isSubscriptionExpired(status, trialEndsAt)
    : false;
  const trialDaysRemaining = isTrialing ? trialDaysRemainingFor(trialEndsAt) : 0;

  return {
    status,
    isTrialing,
    trialDaysRemaining,
    isExpired,
    plan: data?.plan ?? null,
    isLoading: query.isLoading,
    data,
  };
}

// ---------------------------------------------------------------------------
// SubscriptionGate component. Wraps any authenticated subtree and walls
// off lapsed trials to /admin/billing. Allowlist paths render children
// regardless so the operator can pick a plan and finish their session.
// ---------------------------------------------------------------------------

export function SubscriptionGate({ children }: { children: ReactNode }) {
  const gate = useSubscriptionGate();
  const { pathname } = useLocation();

  // Loading or unauthenticated -> render children. ProtectedRoute /
  // AdminProtectedRoute will have already redirected unauthenticated
  // callers; rendering children during the loading window keeps the
  // shell from flashing.
  if (gate.isLoading || !gate.status) return <>{children}</>;
  if (!gate.isExpired) return <>{children}</>;
  if (isPathAllowlistedForGate(pathname)) return <>{children}</>;
  return <Navigate to="/admin/billing?gated=true" replace />;
}
