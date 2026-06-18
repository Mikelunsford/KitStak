// Pure branding-asset helpers. No IO imports (no apiClient / supabase), so this
// is unit-testable in isolation and safe to import anywhere. The network
// two-step lives in brandingUpload.ts, which builds on these.

import type {
  BrandingAssetContentType,
  BrandingAssetKind,
} from '@/lib/types/identity';

// Client-side mirror of the server's per-kind ceilings (settings-api
// BRANDING_ASSET_MAX_BYTES). Checked client-side for a fast, friendly error;
// the server enforces the real limit.
const MAX_BYTES: Record<BrandingAssetKind, number> = {
  logo: 1_048_576,
  email_logo: 1_048_576,
  icon: 262_144,
};

// Allowed MIME types, with a couple of common aliases normalised to the
// canonical value the server enum accepts.
const CONTENT_TYPE_ALIASES: Record<string, BrandingAssetContentType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/svg+xml': 'image/svg+xml',
  'image/webp': 'image/webp',
  'image/x-icon': 'image/x-icon',
  'image/vnd.microsoft.icon': 'image/x-icon',
};

export function resolveBrandingContentType(
  mime: string,
): BrandingAssetContentType | null {
  return CONTENT_TYPE_ALIASES[mime.toLowerCase()] ?? null;
}

export function brandingAssetMaxBytes(kind: BrandingAssetKind): number {
  return MAX_BYTES[kind];
}
