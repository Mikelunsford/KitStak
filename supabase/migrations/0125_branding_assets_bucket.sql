-- ============================================================================
-- Migration: 0125_branding_assets_bucket.sql
-- Wave: 13
-- Phase: C. White-label branding asset uploads. The org Branding admin page
--   gains direct logo / favicon upload (previously URL-paste only). Uploaded
--   assets need anonymous read because the SPA shell renders the favicon and
--   the pdf-worker embeds the logo into rendered invoices / quotes, neither of
--   which carries an authenticated session for the asset fetch. So the bucket
--   is PUBLIC (read), while WRITES are service-role only: the settings-api
--   `POST /branding/logo/upload-url` route mints a short-lived signed upload
--   URL after `requireCap(caller, 'branding.logo.upload')`. No storage.objects
--   write policy is added (mirrors 0034, which left the attachments bucket
--   without object policies); the signed token is the single write authority.
-- Closes: F-BRANDING-LOGO-UPLOAD-01
-- Date: 2026-06-18
--
-- DOWN MIGRATION (operator-only): not auto-run.
--   To reverse, remove any objects then the bucket row:
--     delete from storage.objects where bucket_id = 'branding';
--     delete from storage.buckets where id = 'branding';
--
-- Constitutional alignment:
--   RLS rules        No tenant-table RLS change. Object writes are service-role
--                    only via signed upload URLs minted behind the
--                    branding.logo.upload capability. Tenant isolation is by
--                    object path prefix: branding/<org_id>/... where the org_id
--                    is taken from caller.orgId (JWT), never client input.
--   Money rules      Untouched.
--   Idempotency      Untouched. The mint route runs under respondWithIdempotency
--                    in the edge layer; no schema surface here.
--   Audit rules      Untouched. Branding column writes already flow through the
--                    audited org_branding update path (settings-api PUT /branding).
--   Migration rules  Forward-only. DDL is idempotent (on conflict do nothing).
-- ============================================================================

-- Public branding asset bucket. Idempotent.
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;
