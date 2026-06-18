/**
 * Branding asset upload. Two-step flow that keeps the binary off the JSON-only
 * apiClient: settings-api mints a single-use signed upload URL (gated by the
 * branding.logo.upload capability + a size/type guard), then the SPA streams
 * the bytes straight to the public `branding` bucket via supabase-js
 * `uploadToSignedUrl`. The caller persists the returned public URL through the
 * existing PUT /branding on save.
 */

import { apiRequest } from '@/lib/apiClient';
import { supabase } from '@/lib/supabase';
import {
  BrandingAssetUploadResponseSchema,
  type BrandingAssetKind,
} from '@/lib/types/identity';
import {
  brandingAssetMaxBytes,
  resolveBrandingContentType,
} from '@/lib/services/brandingAsset';

const BRANDING_BUCKET = 'branding';

export { brandingAssetMaxBytes, resolveBrandingContentType };

/**
 * Validate a file client-side, mint a signed upload URL, upload the bytes, and
 * return the resulting public URL. Throws a user-friendly Error on a rejected
 * type / size or a failed upload.
 */
export async function uploadBrandingAsset(
  kind: BrandingAssetKind,
  file: File,
): Promise<{ url: string }> {
  const contentType = resolveBrandingContentType(file.type);
  if (!contentType) {
    throw new Error('Use a PNG, JPEG, SVG, WebP, or ICO image.');
  }
  const cap = brandingAssetMaxBytes(kind);
  if (file.size > cap) {
    throw new Error(`Image is too large. Max ${Math.round(cap / 1024)} KB.`);
  }

  const minted = await apiRequest<unknown>(
    '/settings-api/branding/logo/upload-url',
    {
      method: 'POST',
      body: { kind, content_type: contentType, size_bytes: file.size },
    },
  );
  const { token, path, public_url } =
    BrandingAssetUploadResponseSchema.parse(minted);

  const { error } = await supabase.storage
    .from(BRANDING_BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType });
  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  return { url: public_url };
}
