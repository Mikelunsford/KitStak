// Tests for the pure branding-asset helpers. The network two-step
// (mint + uploadToSignedUrl) in brandingUpload.ts is exercised via manual/E2E
// verification; here we lock the content-type normalisation and per-kind size
// caps from the IO-free brandingAsset module.

import { describe, it, expect } from 'vitest';

import {
  brandingAssetMaxBytes,
  resolveBrandingContentType,
} from './brandingAsset';

describe('resolveBrandingContentType', () => {
  it('passes through the canonical allowed types', () => {
    expect(resolveBrandingContentType('image/png')).toBe('image/png');
    expect(resolveBrandingContentType('image/jpeg')).toBe('image/jpeg');
    expect(resolveBrandingContentType('image/svg+xml')).toBe('image/svg+xml');
    expect(resolveBrandingContentType('image/webp')).toBe('image/webp');
    expect(resolveBrandingContentType('image/x-icon')).toBe('image/x-icon');
  });

  it('normalises common aliases', () => {
    expect(resolveBrandingContentType('image/jpg')).toBe('image/jpeg');
    expect(resolveBrandingContentType('image/vnd.microsoft.icon')).toBe('image/x-icon');
  });

  it('is case-insensitive on the MIME', () => {
    expect(resolveBrandingContentType('IMAGE/PNG')).toBe('image/png');
  });

  it('returns null for disallowed types', () => {
    expect(resolveBrandingContentType('image/gif')).toBeNull();
    expect(resolveBrandingContentType('application/pdf')).toBeNull();
    expect(resolveBrandingContentType('')).toBeNull();
  });
});

describe('brandingAssetMaxBytes', () => {
  it('caps a favicon smaller than a logo', () => {
    expect(brandingAssetMaxBytes('icon')).toBe(262_144);
    expect(brandingAssetMaxBytes('logo')).toBe(1_048_576);
    expect(brandingAssetMaxBytes('email_logo')).toBe(1_048_576);
    expect(brandingAssetMaxBytes('icon')).toBeLessThan(brandingAssetMaxBytes('logo'));
  });
});
