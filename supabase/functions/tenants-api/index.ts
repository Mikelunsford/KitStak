// tenants-api: authenticated tenant surface for the SPA.
//
// Routes:
//   GET  /branding                                    Authenticated.
//        Returns the active org's branding row. Consumed by
//        BrandingProvider on the SPA. Falls back to platform defaults at
//        the SPA layer when the row is absent.
//
//   GET  /tenants/me                                  Authenticated.
//        Returns the caller's active organization row. Lightweight surface
//        the topbar / dashboard can call without joining memberships.
//
// This bundle runs with verify_jwt = true at the Supabase gateway: the
// platform verifies the JWT signature before any handler executes, so the
// decode-only claim reader in _shared/tenant.ts is safe (a forged token is
// rejected at the gateway with 401 and never reaches these handlers). The
// single pre-auth public route (/tenants/resolve-host) was split out into
// the tenants-public-api bundle (verify_jwt = false). See
// supabase/config.toml for the split rationale (R-W13-SEC-01).

import { route, type RouteCtx } from '../_shared/route.ts';
import { admin, requireCap } from '../_shared/handler-helpers.ts';
import { readCallerContext, requireCaller, type Caller } from '../_shared/tenant.ts';
import { ok, ApiError } from '../_shared/responses.ts';
import {
  BrandingResponseSchema,
  OrganizationSchema,
} from '../_shared/types/identity.ts';

const BUNDLE = 'tenants-api';

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
      { method: 'GET', path: '/branding',   handler: getBranding },
      { method: 'GET', path: '/tenants/me', handler: getTenant },
    ],
    { bundle: BUNDLE },
  ),
);
