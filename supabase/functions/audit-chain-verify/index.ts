// audit-chain-verify: nightly walker over every active org's audit_log chain.
// Calls public.verify_audit_chain(org_id) for each row in organizations.
// Returns the first broken row (if any) per org. A non-empty array is a P0:
// the nightly workflow fails and pages the operator.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fromApiError, ApiError, ok, noContent } from '../_shared/responses.ts';

type BrokenRow = {
  org_id: string;
  broken_id: string;
  broken_triggered_at: string;
  expected_hash: string;
  stored_hash: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return noContent();

  const authHeader = req.headers.get('authorization') ?? '';
  const expected = Deno.env.get('AUDIT_VERIFY_SECRET');
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return fromApiError(new ApiError('UNAUTHORIZED'));
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return fromApiError(new ApiError('INTERNAL_ERROR', 'Missing service-role credentials'));
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: orgs, error: orgErr } = await client
    .from('organizations')
    .select('id')
    .is('deleted_at', null);

  if (orgErr) {
    return fromApiError(new ApiError('INTERNAL_ERROR', orgErr.message));
  }

  const broken: BrokenRow[] = [];
  for (const row of orgs ?? []) {
    const { data, error } = await client.rpc('verify_audit_chain', {
      p_org_id: row.id,
    });
    if (error) {
      return fromApiError(new ApiError('INTERNAL_ERROR', error.message));
    }
    for (const r of (data as Array<Omit<BrokenRow, 'org_id'>>) ?? []) {
      broken.push({ org_id: row.id, ...r });
    }
  }

  return ok({
    checked_org_count: (orgs ?? []).length,
    broken_count: broken.length,
    broken,
  });
});
