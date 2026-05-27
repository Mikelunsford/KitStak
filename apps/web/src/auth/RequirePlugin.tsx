import type { ReactNode } from 'react';

import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * RequirePlugin. SPA-side mirror of the Edge bundle-level plugin gate
 * defined in supabase/functions/_shared/bundleGate.ts.
 *
 * Constitutional rule (CLAUDE.md, 00-canon/01-architecture.md):
 *   Plugin bundle gates return 404. The SPA must render the NotFound
 *   surface for any /3pl-operations/* or /manufacturing/* route when
 *   the pillar plugin flag is off for the active org. A redirect to
 *   /feature-unavailable is the WRONG envelope here: that surface is
 *   for per-route 403 FEATURE_DISABLED misses.
 *
 * The hook waits for org flags to resolve before rendering either the
 * gated content or the NotFound surface so the operator never sees a
 * flicker between "loading" and "404". While loading, render nothing
 * (the route Suspense fallback already covers the lazy chunk load).
 *
 * The Edge layer is still authoritative: a SPA-only bypass cannot
 * write through because every state-changing handler is gated at the
 * bundle dispatcher. This guard exists so an org without the plugin
 * never sees write CTAs (Add buttons, forms) for pillar surfaces it
 * cannot use, fixing the half-gated manufacturing ADD-button bug
 * caught by Cowork on 2026-05-26 (F-Wave9-COWORK-SMOKE-06).
 */
export interface RequirePluginProps {
  /** Plugin flag key, e.g. FEATURE_FLAGS.PLUGINS_THREE_PL. */
  flag: string;
  children: ReactNode;
}

export function RequirePlugin({ flag, children }: RequirePluginProps) {
  const flags = useOrgFlags();

  if (flags.isLoading) {
    return null;
  }

  if (flags.data[flag] !== true) {
    return <NotFoundPage />;
  }

  return <>{children}</>;
}
