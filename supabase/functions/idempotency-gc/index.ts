// idempotency-gc: nightly sweep of rows older than 7 days.
// Triggered by a scheduled GitHub Actions workflow (see .github/workflows/
// idempotency-gc.yml) which invokes this function with a service-role JWT.
//
// Idempotent: re-running on the same window is a no-op (rows already gone).

import { createClient } from '@supabase/supabase-js';
import { fromApiError, ApiError, ok, noContent } from '../_shared/responses.ts';

const RETENTION_DAYS = 7;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return noContent();

  const authHeader = req.headers.get('authorization') ?? '';
  const expected = Deno.env.get('GC_TRIGGER_SECRET');
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

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const { count, error } = await client
    .from('idempotency_keys')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff);

  if (error) {
    return fromApiError(new ApiError('INTERNAL_ERROR', error.message));
  }

  return ok({ deleted: count ?? 0, cutoff });
});
