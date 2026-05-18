-- ============================================================================
-- Migration: 0039_collab_attachments_quote_view.sql
-- Wave: 2
-- Phase: Cross-cutting collaboration
-- Closes: R-W2-COLLAB-05
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. DROP VIEW quote_attachments. Not auto-run.
--
-- Constitutional alignment:
--   RLS rules        The view inherits RLS from public.attachments via
--                    security_invoker = true (Postgres 15+). No additional
--                    policy is required because the base table policy is
--                    Pattern A (org_id = current_org_id()).
--   Migration rules  Forward-only. Idempotent (CREATE OR REPLACE VIEW).
-- ============================================================================

create or replace view public.quote_attachments
with (security_invoker = true)
as
  select
    a.id,
    a.org_id,
    a.entity_id as quote_id,
    a.storage_path,
    a.file_name,
    a.content_type,
    a.size_bytes,
    a.uploaded_by,
    a.created_at,
    a.updated_at,
    a.deleted_at
  from public.attachments a
  where a.entity_type = 'quote';

comment on view public.quote_attachments is
  'Quote attachments view over the polymorphic attachments table. Inherits RLS via security_invoker.';
