import { useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { switchOrg } from '@/lib/services/sessionService';

/**
 * Workspace switcher mutation. Wave 2 wiring of the auth-api/switch-org
 * endpoint. Refreshes the Supabase session to pick up the new JWT claim,
 * then drops every TanStack Query cache entry so per-org data is re-fetched
 * against the new tenant.
 */
export function useSessionSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orgId: string) => switchOrg({ org_id: orgId }),
    onSuccess: async () => {
      await supabase.auth.refreshSession();
      await qc.invalidateQueries();
    },
  });
}
