/**
 * Branding service. Wraps `tenants-api/branding` in a typed call.
 *
 * Wave 1 stub: the tenants-api edge function ships in Wave 2 (Agent A).
 * The shape mirrors the Wave 2 contract so BrandingProvider, Topbar, and
 * the per-org bake snapshot can be written now.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import { UuidSchema } from '@/lib/types';

const HexColorSchema = z.string().regex(/^#?[0-9a-fA-F]{6}$/);

export const BrandingSchema = z.object({
  org_id: UuidSchema,
  primary_color: HexColorSchema,
  accent_color: HexColorSchema,
  on_primary: HexColorSchema,
  font_family: z.string(),
  logo_url: z.string().url().nullable(),
  icon_url: z.string().url().nullable(),
  app_name_override: z.string().nullable(),
});
export type Branding = z.infer<typeof BrandingSchema>;

/**
 * GET /tenants-api/branding. Authenticated. Returns the brand token set
 * for the caller's active org.
 */
export async function getBranding(): Promise<Branding> {
  const data = await apiRequest<unknown>('/tenants-api/branding', {
    method: 'GET',
  });
  return BrandingSchema.parse(data);
}
