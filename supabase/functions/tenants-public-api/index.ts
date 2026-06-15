// tenants-public-api: the ONLY pre-auth public tenant route.
//
// Routes:
//   GET  /tenants/resolve-host?host=foo.kitstak.com   PUBLIC.
//        Resolves a custom host to (org_id, org_slug). Used at app boot
//        before the user has authenticated so the SPA knows which branding
//        and identity providers to fetch on first paint. Returns 404 when
//        the host is unknown or unverified. Service-role RPC enforces
//        verified_at filtering.
//
// This bundle exists so that tenants-api can run with verify_jwt = true at
// the Supabase gateway. The single public route lives here under
// verify_jwt = false; every authenticated tenant route (/branding,
// /tenants/me) stays in tenants-api behind gateway signature verification.
// See supabase/config.toml for the split rationale (R-W13-SEC-01).
//
// Behavior here is byte-for-byte the prior tenants-api resolveHost handler:
// same RPC, same lowercasing, same 422/404/500 envelope. resolve_org_by_host
// is the authority on verified_at filtering; this handler does not relax it.

import { route, type RouteCtx } from '../_shared/route.ts';
import { admin } from '../_shared/handler-helpers.ts';
import { ok, ApiError } from '../_shared/responses.ts';
import { ResolveHostResponseSchema } from '../_shared/types/identity.ts';

const BUNDLE = 'tenants-public-api';

async function resolveHost(ctx: RouteCtx): Promise<Response> {
  const host = ctx.url.searchParams.get('host');
  if (!host || host.length === 0) {
    throw new ApiError(
      'VALIDATION_ERROR',
      422,
      'host query parameter is required',
    );
  }
  const sb = admin();
  const { data, error } = await sb.rpc('resolve_org_by_host', {
    p_host: host.toLowerCase(),
  });
  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `resolve_org_by_host failed: ${error.message}`,
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new ApiError('NOT_FOUND', 404, 'No tenant for that host.');
  }
  const parsed = ResolveHostResponseSchema.parse({
    org_id: row.org_id,
    org_slug: row.org_slug,
  });
  return ok(parsed);
}

Deno.serve((req: Request) =>
  route(
    req,
    [
      { method: 'GET', path: '/tenants/resolve-host', handler: resolveHost },
    ],
    { bundle: BUNDLE },
  ),
);
