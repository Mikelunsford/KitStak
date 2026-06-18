// useDefaultExpiration. Reads the org-wide default quote expiration from the
// settings store (readable by every staff role) so the quote create form can
// seed its expiration date from it. The pure resolver and date math live in
// `@/lib/quoteExpiration` so they stay testable without the supabase client.

import { useMemo } from 'react';

import {
  resolveDefaultExpiration,
  type ExpirationDuration,
} from '@/lib/quoteExpiration';
import { useSettings } from '@/lib/hooks/useSettings';
import { useAuth } from '@/auth/AuthContext';

/**
 * The org default quote-expiration duration, `null` when no default is set, or
 * `undefined` while the settings query is loading (so a form can seed exactly
 * once on first load without locking in a stale value).
 */
export function useDefaultExpiration(): ExpirationDuration | null | undefined {
  const { state } = useAuth();
  const enabled = state.status === 'authenticated';
  const { data } = useSettings({ enabled });
  return useMemo(
    () => (data ? resolveDefaultExpiration(data) : undefined),
    [data],
  );
}
