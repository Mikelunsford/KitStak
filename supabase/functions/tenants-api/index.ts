// tenants-api: tenant surface for the SPA.
//
// Routes:
//   GET  /tenants/resolve-host?host=foo.kitstak.com   PUBLIC.
//        Resolves a custom host to (org_id, org_slug). Used at app boot
//        before the user has authenticated so the SPA knows which branding
//        and identity providers to fetch on first paint. Returns 404 when
//        the host is unknown or unverified. Service-role RPC enforces
//        verified_at filtering.
//
//   GET  /branding                                    Authenticated.
//        Returns the active org's branding row. Consumed by
//        BrandingProvider on the SPA. Falls back to platform defaults at
//        the SPA layer when the row is absent.
//
//   GET  /tenants/me                                  Authenticated.
//        Returns the caller's active organization row. Lightweight surface
//        the topbar / dashboard can call without joining memberships.
//
// Public resolve-host runs with verify_jwt = false (Supabase function
// settings configuration is a deploy concern; documented in
// docs/api/identity.md).

import { route, type RouteCtx } from '../_shared/route.ts';
import { admin, requireCap } from '../_shared/handler-helpers.ts';
import { readCallerContext, requireCaller, type Caller } from '../_shared/tenant.ts';
import { ok, ApiError } from '../_shared/responses.ts';
import {
  BrandingResponseSchema,
  OrganizationSchema,
  ResolveHostResponseSchema,
} from '../_shared/types/identity.ts';

const BUNDLE = 'tenants-api';

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

async function getBranding(ctx: RouteCtx): Promise<Response> {
  const ctxRead = readCallerContext(ctx.req);
  if (!ctxRead.userId || !ctxRead.orgId || !ctxRead.role) {
    throw new ApiError('UNAUTHORIZED', 401, 'Authentication required.');
  }
  const caller: Caller = {
    userId: ctxRead.userId,
    orgId: ctxRead.orgId,
    role: ctxRead.role,
  };
  requireCap(caller, 'branding.read');

  const sb = admin();
  const { data, error } = await sb
    .from('org_branding')
    .select(
      'org_id, logo_url, icon_url, email_logo_url, primary_color, accent_color, on_primary, font_family, invoice_pdf_footer, quote_pdf_footer, app_name_override, support_url, privacy_url, terms_url, custom_css',
    )
    .eq('org_id', caller.orgId)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `branding lookup failed: ${error.message}`,
    );
  }
  if (!data) {
    throw new ApiError('NOT_FOUND', 404, 'Branding row missing.');
  }
  return ok(BrandingResponseSchema.parse(data));
}

async function getTenant(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'tenancy.org.read');

  const sb = admin();
  const { data, error } = await sb
    .from('organizations')
    .select(
      'id, slug, display_name, legal_name, industry, region, default_locale, default_timezone, default_currency_code, date_format, plan_code, status, billing_email, support_email',
    )
    .eq('id', caller.orgId)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `organization lookup failed: ${error.message}`,
    );
  }
  if (!data) {
    throw new ApiError('NOT_FOUND', 404, 'Organization not found.');
  }
  return ok(OrganizationSchema.parse(data));
}

Deno.serve((req: Request) =>
  route(
    req,
    [
      { method: 'GET', path: '/tenants/resolve-host', handler: resolveHost },
      { method: 'GET', path: '/branding',             handler: getBranding },
      { method: 'GET', path: '/tenants/me',           handler: getTenant },
    ],
    { bundle: BUNDLE },
  ),
);
