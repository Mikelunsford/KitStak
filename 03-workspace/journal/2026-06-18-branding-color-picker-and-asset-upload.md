# Branding overhaul: color-wheel picker, text-on-brand color, logo/favicon upload

Date: 2026-06-18
CHANGELOG: `0.30.0`
PR: #342

## Scope

The operator asked to make the Branding admin section (`/admin/branding`) easily customizable: a color wheel instead of static hex codes, and direct logo/favicon setup instead of pasting hosted URLs. After a planning pass the operator chose real file upload (not just a nicer URL flow), the native swatch + hex picker, and exposing the text-on-brand color (`on_primary`); the other schema fields (font family, legal URLs, custom CSS) were left deferred.

## What shipped

### Colors (frontend only, no backend change)

- **`components/ui/ColorField.tsx`**: a controlled, stateless primitive pairing a native `<input type="color">` swatch (the OS color wheel) with a synced hex text field and a small preview, on the existing brand tokens. Exports a pure `normalizeHexColor` (optional `#`, three-digit shorthand expansion, case fold, returns `null` for partial input so the swatch gets a safe fallback). Tested directly (`ColorField.test.ts`, element-tree walk, no jsdom).
- **`pages/admin/BrandingSettingsPage.tsx`**: the three color text inputs became `ColorField`, including a new "Text on brand color" wired to `on_primary`. The live preview now uses `on_primary` for foreground text instead of a hardcoded cream, so it reflects the real saved token (which drives `--ink` at runtime via `BrandingProvider`). Save validation extended to `on_primary`.

### Logo / favicon upload

- **Migration `0125_branding_assets_bucket.sql`**: a new public `branding` storage bucket. Public read only (the favicon and the pdf-worker logo are fetched without an authenticated session); no `storage.objects` write policy (the signed token is the single write authority, mirroring how `0034` left the attachments bucket without object policies).
- **`POST /settings-api/branding/logo/upload-url`** (settings-api): mints a single-use signed upload URL with `createSignedUploadUrl`, after `requireCap(caller, 'branding.logo.upload')`, an Idempotency-Key, and a per-kind size/content-type guard. The object path is `<org_id>/<kind>-<uuid>.<ext>` from `caller.orgId` (never client input), so an asset can only land under the caller's own prefix.
- **`components/ui/ImageUploadField.tsx`**: drag-and-drop or click to upload, a live thumbnail preview, and an "or paste a URL" text fallback. On file select it validates type and size client-side, then `lib/services/brandingUpload.ts` requests the signed URL and uploads the bytes via supabase-js `uploadToSignedUrl`. Pure helpers (`resolveBrandingContentType`, `brandingAssetMaxBytes`) live in `lib/services/brandingAsset.ts` so they unit-test without the supabase/apiClient chain (`brandingUpload.test.ts`).
- **Canon**: byte-identical `BrandingAssetKind` / `BrandingAssetContentType` / `BrandingAssetUploadRequest` / `BrandingAssetUploadResponse` schemas in both `_shared/types/identity.ts` and `apps/web/src/lib/types/identity.ts`.

## Decisions

- **Signed upload URL, not direct-SPA-with-storage-RLS or base64-through-edge.** The `branding.logo.upload` capability already existed in the canon; storage RLS is role-based and cannot enforce a fine-grained capability, so an edge-mediated mint is the correct gate. The signed token authorizes the single write, so the migration stays to just the public bucket (no `storage.objects` policy), and the binary never rides the JSON-only apiClient.
- **Public bucket for read.** Logos and favicons are public brand assets, and both the SPA favicon swap and the PDF worker fetch them without a session. A private bucket would need expiring signed read URLs, unusable for a persisted favicon.
- **UUID-named objects, not a stable path.** A re-upload yields a new URL so the favicon/img cache busts correctly. The cost is possible orphans; filed as a follow-up.
- **Zero backend change for colors.** `PUT /branding` already accepted every field including `on_primary`; only the UI surfaced fewer fields than the contract allowed.

## Verification

- Gates green: typecheck, lint (max-warnings 0), 751 unit tests (15 new), contract/byte-mirror parity, build (SPA index 36.46 kB gz under the 40 kB budget), size-limit.
- Bucket applied to staging (`dnkgaufydcnedgkuoyml`) before merge via `execute_sql` (idempotent insert, not `apply_migration`, to avoid the phantom-version stamp); after merge the migrate workflow pushed `0125` to prod and staging. Both verified to carry the `branding` bucket (public=true); prod stamped at `0125`.
- Prod security advisors unchanged: the two deliberate SECURITY DEFINER exceptions (`current_org_id`, `current_user_role`), plus the pre-existing `stripe_webhook_events` and `citext` notices. The public bucket adds no advisor.
- No render test covers the Branding page (the repo runs Vitest without jsdom); the color normalization and the upload helpers are covered by unit tests, and the upload-and-repaint flow is left for an operator/browser click-through.

## Constitutional invariants

Migration is forward-only and idempotent. No tenant-table RLS, money math, idempotency, or `audit_log` change. The write authority is the `branding.logo.upload` capability (already in the canon); object writes are service-role only. Byte-mirror canon held (contract parity green). No new dependency (native color input plus lucide icons already in use).

## Follow-ups

- `F-BRANDING-ASSET-GC-01`: nightly sweep of orphaned `branding/` objects not referenced by any `org_branding` row.
- Deferred branding fields: font-family picker, `email_logo_url`, `support_url` / `privacy_url` / `terms_url`, `custom_css`.
- Manual browser smoke of the upload-and-repaint flow on a live build.
