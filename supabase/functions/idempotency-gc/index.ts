// idempotency-gc: nightly sweep of rows older than 7 days.
// Triggered by a scheduled GitHub Actions workflow (see .github/workflows/
// idempotency-gc.yml) which invokes this function with a service-role JWT.
//
// Idempotent: re-running on the same window is a no-op (rows already gone).

import { fromApiError, ApiError, ok, internalError } from '../_shared/responses.ts';
import { admin } from '../_shared/handler-helpers.ts';
import { serverCorsHeaders } from '../_shared/cors.ts';
import { ERROR_CODES, HTTP_HEADERS } from '../_shared/constants.ts';

const RETENTION_DAYS = 7;

Deno.serve(async (req: Request) => {
  // Server-only worker: emit the non-browser CORS origin (D6).
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: serverCorsHeaders() });
  }

  const authHeader = req.headers.get(HTTP_HEADERS.AUTHORIZATION) ?? '';
  const expected = Deno.env.get('GC_TRIGGER_SECRET');
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return fromApiError(new ApiError(ERROR_CODES.UNAUTHORIZED));
  }

  let client;
  try {
    client = admin();
  } catch (err) {
    if (err instanceof ApiError) return fromApiError(err);
    return fromApiError(internalError('idempotency-gc:admin', err));
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const { count, error } = await client
    .from('idempotency_keys')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff);

  if (error) {
    return fromApiError(internalError('idempotency-gc:delete', error));
  }

  return ok({ deleted: count ?? 0, cutoff });
});
