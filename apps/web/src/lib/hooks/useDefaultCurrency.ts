// useDefaultCurrency. Reads the org-wide default transaction currency from the
// settings store (readable by every staff role) so create forms can seed their
// currency from it. The pure resolver and the setting key constants live in
// `@/lib/defaultCurrency` so they stay testable without the supabase client.

import { useMemo } from 'react';

import { resolveDefaultCurrency } from '@/lib/defaultCurrency';
import { useSettings } from '@/lib/hooks/useSettings';
import { useAuth } from '@/auth/AuthContext';

/**
 * The resolved org default currency, or `undefined` while the settings query is
 * still loading so a form can seed exactly once on first load (and not lock in
 * the fallback over a later real value). Returns the fallback once loaded with
 * no setting present.
 */
export function useDefaultCurrency(): string | undefined {
  const { state } = useAuth();
  const enabled = state.status === 'authenticated';
  const { data } = useSettings({ enabled });
  return useMemo(
    () => (data ? resolveDefaultCurrency(data) : undefined),
    [data],
  );
}
