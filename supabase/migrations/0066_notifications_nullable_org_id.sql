-- ============================================================================
-- Migration: 0066_notifications_nullable_org_id.sql
-- Wave: 9
-- Phase: Auth / portal hardening
-- Closes: F-Wave9-INVITE-PASSWORD-SETUP-01 (chassis half)
-- Date: 2026-05-26
-- DOWN MIGRATION (operator-only; not auto-run):
--   alter table public.notifications alter column org_id set not null;
--   (Will fail if any user-scoped rows have been inserted in the interim.
--   The operator must first either backfill org_id or delete those rows.)
--
-- Background:
--   The notifications table was introduced in 0035 with `org_id NOT NULL`
--   on the assumption that every notification belongs to a tenant. That
--   held while the only senders were org-scoped (staff invites, customer
--   portal invites, in-app activity). The password-recovery email shipped
--   in this PR is the first user-scoped notification: it is addressed to
--   an auth.users row that may belong to many orgs, and the email content
--   is identical across them, so there is no single tenant to attribute
--   the row to. Forcing a "platform org" stand-in would create a fake
--   tenant whose rows are visible to nobody under the existing RLS policy
--   (which requires `org_id = current_org_id()`); the row would still be
--   drained by the service-role worker because INSERT and the worker SELECT
--   both bypass RLS. The cleaner path is to make org_id nullable and let
--   the worker carry the row as-is.
--
--   The RLS policies on notifications already filter `org_id = current_org_id()
--   AND recipient_user_id = auth.uid()` for SELECT and UPDATE. A NULL org_id
--   will never satisfy that equality, so authenticated users cannot read or
--   mutate user-scoped rows even via the recipient_user_id filter. That is
--   the intended privacy posture: recovery emails are shipped by the worker
--   and never need to be visible through the in-app notification surface.
--
-- Constitutional alignment:
--   Money rules        Untouched. No _cents columns.
--   RLS rules          Pattern A preserved. Existing SELECT/UPDATE policies
--                      continue to gate on org_id = current_org_id(); a NULL
--                      org_id is unreachable through those policies, which
--                      keeps user-scoped rows server-only as intended.
--   Audit rules        Untouched. notifications is not in the audit_log
--                      entity_type CHECK and does not participate in the
--                      hash chain.
--   Migration rules    Forward-only. Idempotent (NOT NULL drop is safe to
--                      re-apply; the column already accepts NULLs after the
--                      first run). A second invocation is a no-op.
--   Capability rules   No new caps. INSERT is still service-role only.
-- ============================================================================

alter table public.notifications
  alter column org_id drop not null;

-- Document the new semantic on the column for future operators reading
-- the schema directly.
comment on column public.notifications.org_id is
  'Tenant scope. NULL for user-scoped notifications (e.g. password recovery '
  'emails that span all of a user''s orgs). Org-scoped rows MUST set this; '
  'user-scoped rows omit it. Drained by service-role worker either way.';
