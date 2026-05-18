import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/lib/apiClient';
import { supabase } from '@/lib/supabase';

/**
 * Workspace-switcher mutation. POSTs to /auth-api/sessions/switch-org,
 * then calls `refreshSession()` so the SPA picks up the new JWT and
 * invalidates the TanStack Query cache wholesale to drop per-org data.
 *
 * Wave 1 stub: the auth-api endpoint ships in Wave 2 (Agent A). The
 * mutation is wired now so Topbar can call it; in Wave 1 the network
 * call will 404 until the function deploys. Callers should treat the
 * stub as a no-op for the duration of Wave 1.
 */
export function useSwitchOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orgId: string) => {
      // TODO(Wave 2 Agent A): auth-api/sessions/switch-org ships then.
      return apiRequest<{ org_id: string }>(
        '/auth-api/sessions/switch-org',
        { method: 'POST', body: { org_id: orgId } },
      );
    },
    onSuccess: async () => {
      await supabase.auth.refreshSession();
      await qc.invalidateQueries();
    },
  });
}
