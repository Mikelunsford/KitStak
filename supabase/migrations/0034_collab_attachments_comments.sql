-- ============================================================================
-- Migration: 0034_collab_attachments_comments.sql
-- Wave: 2
-- Phase: Cross-cutting collaboration
-- Closes: R-W2-COLLAB-01, R-W2-COLLAB-02
-- Date: 2026-05-18
-- DOWN MIGRATION: operator-only. Drop saved_views, comments, attachments and
--   the bucket entry in storage.buckets (manually). Not auto-run.
--
-- Constitutional alignment:
--   RLS rules        Pattern A. Tenant scope by org_id = current_org_id() on
--                    each table; role guards on writes.
--   Money rules      Untouched.
--   Audit rules      attachments / comments / notifications appear in the
--                    extended audit_log entity_type CHECK in 0036.
--   Migration rules  Forward-only. All DDL idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Storage bucket for generic attachments. Idempotent.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- attachments: polymorphic file pointer table. entity_type + entity_id route
-- the file to the parent record. file lives in storage bucket 'attachments'.
-- ---------------------------------------------------------------------------
create table if not exists public.attachments (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  storage_path text not null,
  file_name text not null,
  content_type text,
  size_bytes bigint not null default 0
    check (size_bytes >= 0),
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create index if not exists attachments_org_entity_idx
  on public.attachments (org_id, entity_type, entity_id, created_at desc)
  where deleted_at is null;

alter table public.attachments enable row level security;

drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists attachments_write on public.attachments;
create policy attachments_write on public.attachments
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in (
      'org_owner', 'org_admin', 'sales', 'ops', 'accounting'
    )
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in (
      'org_owner', 'org_admin', 'sales', 'ops', 'accounting'
    )
  );

-- ---------------------------------------------------------------------------
-- comments: discussion thread on any entity. parent_id supports replies.
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  parent_id uuid references public.comments(id) on delete cascade,
  author_id uuid not null,
  body text not null,
  is_internal boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create index if not exists comments_org_entity_idx
  on public.comments (org_id, entity_type, entity_id, created_at desc)
  where deleted_at is null;

alter table public.comments enable row level security;

drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
  for select to authenticated
  using (org_id = public.current_org_id());

drop policy if exists comments_write on public.comments;
create policy comments_write on public.comments
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and public.current_user_role() in (
      'org_owner', 'org_admin', 'sales', 'ops', 'accounting', 'viewer'
    )
  )
  with check (
    org_id = public.current_org_id()
    and public.current_user_role() in (
      'org_owner', 'org_admin', 'sales', 'ops', 'accounting', 'viewer'
    )
  );

-- ---------------------------------------------------------------------------
-- saved_views: per-user per-entity-list view config. e.g. invoices list with
-- filter "status=overdue", sort "due_date asc". JSON config is the source.
-- ---------------------------------------------------------------------------
create table if not exists public.saved_views (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null,
  entity_type text not null,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (org_id, owner_user_id, entity_type, name)
);

create index if not exists saved_views_owner_idx
  on public.saved_views (org_id, owner_user_id, entity_type);

alter table public.saved_views enable row level security;

drop policy if exists saved_views_select on public.saved_views;
create policy saved_views_select on public.saved_views
  for select to authenticated
  using (
    org_id = public.current_org_id()
    and (owner_user_id = auth.uid() or is_shared = true)
  );

drop policy if exists saved_views_write on public.saved_views;
create policy saved_views_write on public.saved_views
  for all to authenticated
  using (
    org_id = public.current_org_id()
    and owner_user_id = auth.uid()
  )
  with check (
    org_id = public.current_org_id()
    and owner_user_id = auth.uid()
  );
