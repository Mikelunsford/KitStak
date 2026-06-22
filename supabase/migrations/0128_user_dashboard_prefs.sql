-- =============================================================================
-- Migration: 0128_user_dashboard_prefs.sql
-- Wave:      Personalization 2026-06-22 (navigation redesign)
-- Phase:     Per-user dashboard preferences
-- Closes:    F-NAV-PERSONALIZATION-WIDGETS-01 (DB-backed widget show/hide +
--            reorder and saved-view-as-widget; cross-device because per-user
--            dashboard layout should follow the operator between machines).
-- Date:      2026-06-22
-- DOWN MIGRATION: operator-only. drop table public.user_dashboard_prefs;
--   Not auto-run.
--
-- Constitutional alignment:
--   RLS rules        RLS from creation. Owner-scoped: a user sees and edits
--                    only their own rows in the active org
--                    (org_id = current_org_id() AND user_id = auth.uid()),
--                    mirroring saved_views (0034). Cross-tenant / cross-user
--                    reads simply return no rows (RLS filters, never throws).
--   Money rules      Untouched. config is layout only, no monetary values.
--   Audit rules      Untouched. UI layout preferences are not audited.
--   Migration rules  Forward-only. All DDL idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- user_dashboard_prefs: per-user, per-section dashboard layout. section_key is
-- 'dashboard' (the global home) or a sidebar section home ('sell','money',...).
-- config jsonb holds the app-shaped layout, e.g.
--   { "widgets": { "<widgetId>": { "hidden": true, "order": 2 } },
--     "pinned_views": [ { "saved_view_id": "<uuid>", "order": 0 } ] }
-- The shape is validated by the app (Zod), not the database.
-- ---------------------------------------------------------------------------
create table if not exists public.user_dashboard_prefs (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  section_key text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (org_id, user_id, section_key)
);

create index if not exists user_dashboard_prefs_owner_idx
  on public.user_dashboard_prefs (org_id, user_id);

alter table public.user_dashboard_prefs enable row level security;

drop policy if exists user_dashboard_prefs_select on public.user_dashboard_prefs;
create policy user_dashboard_prefs_select on public.user_dashboard_prefs
  for select to authenticated
  using (
    org_id = public.current_org_id()
    and user_id = auth.uid()
  );

drop policy if exists user_dashboard_prefs_write on public.user_dashboard_prefs;
create policy user_dashboard_prefs_write on public.user_dashboard_prefs
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and user_id = auth.uid()
  )
  with check (
    org_id = public.current_org_id()
    and user_id = auth.uid()
  );
