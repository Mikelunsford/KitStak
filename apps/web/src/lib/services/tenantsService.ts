/**
 * Tenants service. Wraps tenants-api endpoints (public host resolver,
 * authenticated tenant-me).
 */

import { apiRequest } from '@/lib/apiClient';
import {
  BrandingResponseSchema,
  OrganizationSchema,
  ResolveHostResponseSchema,
  type BrandingResponse,
  type Organization,
  type ResolveHostResponse,
} from '@/lib/types/identity';

/**
 * GET /tenants-api/tenants/resolve-host?host=foo.kitstak.com. Public. Used
 * at app boot before authentication so the SPA can pick the right branding
 * for a custom-host deployment on first paint.
 */
export async function resolveHost(host: string): Promise<ResolveHostResponse> {
  const data = await apiRequest<unknown>(
    `/tenants-api/tenants/resolve-host?host=${encodeURIComponent(host)}`,
    { method: 'GET' },
  );
  return ResolveHostResponseSchema.parse(data);
}

/**
 * GET /tenants-api/branding. Authenticated. Returns the active org's
 * branding row.
 */
export async function getTenantBranding(): Promise<BrandingResponse> {
  const data = await apiRequest<unknown>('/tenants-api/branding', {
    method: 'GET',
  });
  return BrandingResponseSchema.parse(data);
}

/**
 * GET /tenants-api/tenants/me. Authenticated. Returns the active
 * organization row (no joins).
 */
export async function getActiveTenant(): Promise<Organization> {
  const data = await apiRequest<unknown>('/tenants-api/tenants/me', {
    method: 'GET',
  });
  return OrganizationSchema.parse(data);
}
