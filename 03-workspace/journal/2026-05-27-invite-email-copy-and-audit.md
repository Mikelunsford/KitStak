# 2026-05-27 invite email copy + org_membership audit chain

## Scope

Two follow-ups bundled in one PR to avoid merge conflict on the staff invite
handler.

- F-Wave9-INVITE-EMAIL-SUBJECT-COPY-01: humane subject + body copy.
- F-Wave9-STAFF-INVITE-AUDIT-01: extend audit_log entity_type enum to include
  org_membership, add an AFTER INSERT trigger on org_memberships, and
  backfill historical rows.

## What changed

### supabase/functions/auth-api/index.ts

postInviteStaffMember:

- Subject changed from "You have been invited to {orgDisplayName} on Kitstak"
  (which read awkwardly as "Kitstak on Kitstak" when the inviting org IS
  Kitstak) to "You have been invited to join {orgDisplayName}".
- Body rewritten to open with "You have been invited to join {orgDisplayName}
  on Kitstak." so the destination remains clear when the subject is
  truncated.
- Org lookup now branches on the error case explicitly: when the
  organizations row lookup errors, the handler logs via console.error and
  falls back to the literal "Kitstak" rather than 500ing the invite. The
  membership row already exists at that point so the invitee can still sign
  in via the magic link.

### supabase/migrations/0067_org_membership_audit.sql (new)

Three pieces:

1. Drop + recreate audit_log_entity_type_check to include 'org_membership'.
   Full enumeration mirrors the 0052 list (latest authoritative state) plus
   the new entity_type. Forward-only; mirrors 0036 pattern exactly.
2. trg_org_memberships_created_audit (SECURITY DEFINER) wired AFTER INSERT
   on public.org_memberships. Writes one audit_log row per insert with
   action='invited', from_state=null, to_state=is_active::text. Carries
   user_id + role_id in metadata so the audit reader does not have to
   back-join. Per-org advisory lock + prev_hash lookup + payload hash via
   kitstak_audit_canonical, identical structure to 0061's
   trg_audit_manufacturing_runs_created.
3. Backfill DO-block iterates org_memberships ORDER BY created_at and
   inserts an 'invited' audit row for every membership that lacks one. NOT
   EXISTS guard makes the backfill idempotent.

### apps/web/test/regression/staff-invite-email-copy.test.ts (new)

4 cases:

- Subject reads "You have been invited to join {orgDisplayName}" and does
  NOT contain "on Kitstak".
- Subject does not collapse to "Kitstak on Kitstak" when the inviting org
  IS named Kitstak.
- Body opens with "You have been invited to join {orgDisplayName} on
  Kitstak." and preserves the action_link + expiry line.
- Fallback: when the organizations row is missing, the handler returns 201
  and falls back to the literal "Kitstak" rather than 500ing.

### apps/web/test/regression/db-0067-org-membership-audit.test.ts (new)

15 cases asserting the migration text shape: SECURITY DEFINER, AFTER INSERT
wiring, action='invited', to_state derived from is_active via a CASE
expression that returns a non-null string (audit_log.to_state is NOT NULL),
entity_type/entity_id positional VALUES order, metadata carries user_id +
role_id, coalesce(auth.uid(), new.created_by) for triggered_by, hash chain
uses kitstak_audit_canonical, per-org advisory lock, backfill iterates ORDER
BY created_at with a NOT EXISTS guard, REVOKE from public+anon, full
enumeration of every prior entity_type preserved, header documents the
risk closure + DOWN MIGRATION + date.

## Verification

### Local

- `pnpm test:contract`: 20 / 20 green (parity holds).
- `pnpm --filter web test`: 223 / 225 green (2 skipped, unrelated).
- `pnpm --filter web build`: green; bundle budgets clean.
- `node scripts/trigger-audit-check.mjs`: clean (exit 0); the new trigger
  does not pass any literal null to a NOT NULL column.

### Staging (dnkgaufydcnedgkuoyml)

Applied via Supabase MCP `apply_migration`. Verified:

- audit_log_entity_type_check now includes 'org_membership'.
- audit_org_memberships_created trigger wired on public.org_memberships.
- Backfill: 4 memberships, 4 'invited' audit rows, 0 missing.
- Live trigger probe: inserted a probe membership, observed an
  audit_log row with to_state='active', action='invited',
  metadata={user_id, role_id}, prev_hash + payload_hash populated. Cleaned
  up the probe row + its audit entry after observation (staging hash
  chains are not contractual).

Note: The MCP execute_sql contract auto-commits each statement, so a
`begin; ... rollback;` wrapper did not roll back the probe insert. The
probe was cleaned up explicitly via service-role delete.

### Production (zmnvwhqjahwidprnjxrq)

Applied via Supabase MCP `apply_migration` ONLY after staging confirmed
green. Verified:

- audit_log_entity_type_check includes 'org_membership'.
- audit_org_memberships_created trigger wired (1 trigger by that name).
- Backfill: 7 memberships, 7 'invited' audit rows, 0 missing.

## Constitutional check

- Money rules: untouched.
- RLS rules: trigger is SECURITY DEFINER; audit_log INSERTs continue to be
  service-role-only via existing RLS (the trigger writes via table-owner
  identity, bypassing RLS by design, mirroring 0061).
- Audit rules: identity layer now in the audit_log hash chain.
- Migration rules: forward-only; idempotent (DROP CONSTRAINT IF EXISTS;
  CREATE OR REPLACE FUNCTION; DROP TRIGGER IF EXISTS; NOT EXISTS guard on
  backfill). 0065 (the prior staff invite migration) is untouched.
- Brand discipline on disk: no em-dashes, no double hyphens, no emojis in
  any code, comment, journal entry, migration body, or test string. Email
  copy on disk respects the brand voice; the user-facing strings are
  plain, declarative, and link-driven.
- Zod canon: `pnpm test:contract` green. The audit_log entity_type field
  is `z.string()` in both _shared/types/cross_cutting.ts and
  apps/web/src/lib/types/cross_cutting.ts (no enum mirror); the DB CHECK
  constraint is the authority.

## Risks carried forward

None for this scope. The two follow-ups close cleanly.

## Follow-ups spawned

None new. The audit-created-symmetry follow-up
(F-Wave9-AUDIT-CREATED-SYMMETRY-01, from 2026-05-22) continues to track
the systemic case of "every entity should have a created audit row, not
just status-transition rows"; this migration adds the org_membership case
to that pattern.
