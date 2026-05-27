# Members PATCH + Resend — closeout

Date: 2026-05-27
Wave: 9
Closes: F-Wave9-STAFF-INVITE-PATCH-01, F-Wave9-STAFF-INVITE-RESEND-01
Migration to staging and prod: 0068_org_membership_update_audit

## What shipped

Two follow-ups bundled into a single PR because they touch the same surface
area (auth-api route table, capabilities canon, identity types canon,
membersService, useOrgMembers, MembersPage). Splitting risked a canon-mirror
merge conflict.

### F-Wave9-STAFF-INVITE-PATCH-01 — per-row role change and deactivate

Backend route: `PATCH /auth-api/members/:user_id`.

Capability `org.member.update` (granted to org_owner and org_admin) was
already declared in the canon when the chassis shipped in 0065 but no
handler claimed it. This PR claims it.

Body schema lives in the byte-mirrored identity canon as
`PatchOrgMemberRequestSchema` and refines on "at least one of role or
is_active". Empty body is a 422.

Guards (in order):
1. requireCap('org.member.update') — sales and viewer get 403.
2. parseUuidParam on the path segment — bad UUID returns 400 BAD_REQUEST.
3. Self-deactivate guard — `is_active=false` on the caller's own row
   returns 422 CANNOT_DEACTIVATE_SELF so an operator cannot lock
   themselves out.
4. Privilege escalation guard — `role=org_owner` from a non-owner caller
   returns 403 FORBIDDEN_ROLE_ESCALATION. Mirrors the same guard in
   postInviteStaffMember.
5. Cross-tenant target — `.eq('user_id', :id).eq('org_id', caller.orgId)`
   resolves to nothing for a foreign user_id; returns 404 NOT_FOUND per
   the constitutional Pattern A workflow-POST rule (hide existence).

UPDATE is issued via service-role with `role_id` resolved from the
requested `role` code through the `roles` table. Response is a re-read of
the row in the same shape `listOrgMembers` returns (now including the
`claimed` flag).

### F-Wave9-STAFF-INVITE-RESEND-01 — per-row resend invite

Backend route: `POST /auth-api/members/:user_id/resend`.

New capability `org.member.resend` (granted to org_owner and org_admin),
declared in the byte-mirrored capabilities canon and asserted by
`pnpm test:contract`.

Guards (in order):
1. requireCap('org.member.resend') — sales and viewer get 403.
2. parseUuidParam on the path segment.
3. Cross-tenant target — 404 (Pattern A).
4. Already-claimed guard — `email_confirmed_at` set on the auth.users row
   returns 422 MEMBER_ALREADY_CLAIMED. Re-issuing a magic link to a
   fully signed-in account does nothing useful and risks misleading the
   operator into thinking a stuck teammate just needs another email.

On success, calls `supabase.auth.admin.generateLink({ type: 'magiclink' })`
with the same `STAFF_INVITE_REDIRECT_URL` as the original invite. Queues
the resend email through the notifications chassis (same 5-minute drain
cron via Resend). The response shape is `{ status: 'sent', resent_at }` —
the magic link itself is NOT echoed to the caller; it goes to the
invitee's inbox only.

Notification queue failure is logged but does not unwind the resend
(mirrors postInviteStaffMember's posture). The operator can re-click
Resend to retry queueing.

### listOrgMembers now returns `claimed`

The list endpoint (`GET /auth-api/members`) was extended to compute and
return a `claimed: boolean` field per row by looking up
`auth.users.email_confirmed_at` for each member via `auth.admin
.getUserById`. The SPA gates the per-row Resend button on `claimed=false`
so the button only appears for invitees who never signed in.

Per-user `getUserById` is N round-trips; supabase-js does not expose a
batch surface. Org member counts are bounded (< 50 for the first operator
year) so the cost is acceptable. A `getUserById` failure is treated as
"claimed" (defaults to hiding the Resend button) so a transient auth
error never produces a stuck "send the invite again" affordance.

### Migration 0068 — UPDATE-side audit trigger

0067 wired `audit_org_memberships_created` AFTER INSERT only and its
regression test explicitly asserts the absence of an AFTER UPDATE wire.
0068 adds `audit_org_memberships_updated` AFTER UPDATE alongside it.

Trigger function `trg_org_memberships_updated_audit`:
- Skips emission when neither `role_id` nor `is_active` changed
  (`IS DISTINCT FROM` guards on both columns) so a touch-only UPDATE
  bumping `updated_at` does not pollute the audit chain.
- Emits `action='updated'`, `from_state` and `to_state` derived from the
  is_active transition, `metadata` carrying user_id + role_id + the
  prior role_id so the audit reader sees the full transition without
  back-joining.
- Per-org advisory lock + prev_hash lookup mirror 0067 exactly. Hash
  chain integrity verified live on staging (see verification below).

No backfill. PostgreSQL has no UPDATE history log; the chain starts at
trigger-attach time. The migration header documents this.

### Frontend

- `membersService.patchOrgMember(userId, body)` and
  `membersService.resendOrgMemberInvite(userId)` wrappers, both parse
  through the byte-mirrored response schemas.
- `useUpdateOrgMember(userId)` and `useResendOrgMemberInvite(userId)`
  hooks in `useOrgMembers.ts`. Both invalidate the members list on
  success so the table refreshes without a manual reload.
- `MembersPage` `MembersTable` now renders an Actions column. The
  caller's own row stays action-less (already marked "(you)"). Other
  rows get a role-change select (org_owner option only visible when
  caller is org_owner; otherwise the five non-owner staff codes from
  `INVITE_ROLE_OPTIONS`), a Deactivate or Reactivate button depending
  on the row's `is_active`, and a Resend Invite button when
  `claimed=false`.
- Inline success and error chips render under the controls in the brand
  palette, mirroring the InviteTeammateSection pattern. Deactivate
  uses `window.confirm` for the destructive prompt (chassis-light by
  design; a full modal can be added later if operators ask for it).

## Verification

### Test suite
- `pnpm test:contract` — 20 tests pass. Byte-mirror parity held for
  both capabilities canon and identity types canon.
- `pnpm --filter web test:regression` — 264 tests pass, 2 skipped.
  Includes 12 new PATCH tests, 6 new RESEND tests, 14 new migration
  0068 shape tests. Existing members-list and members-invite suites
  still green.
- `pnpm --filter web vitest run src` — 506 unit tests pass.
- `pnpm typecheck` — clean.
- `pnpm build` — clean. Main index chunk 31.03 kB gzipped, under the
  40 kB ceiling. MembersPage chunk 3.51 kB gzipped.

### Live verification on staging (dnkgaufydcnedgkuoyml)

After applying 0068 to staging via Supabase MCP:

1. Both `audit_org_memberships_created` and
   `audit_org_memberships_updated` triggers present on
   `public.org_memberships`. Confirmed via `pg_trigger`.

2. No-op UPDATE check: `update public.org_memberships set updated_at =
   now() where id = ...` emitted ZERO new audit_log rows. The
   `IS DISTINCT FROM` guard works as designed.

3. Real is_active flip check: ran `is_active=false` then `is_active=true`
   on the same row. Both UPDATEs emitted one audit row each with the
   correct shape: `action=updated`, `from_state` / `to_state` matching
   the transition, `metadata.user_id` correct, `diff_json.is_active`
   carrying both `from` and `to`, 64-char sha256 payload_hash.

4. Hash chain integrity: ordered the three audit rows for the test
   membership by id and confirmed each row's `prev_hash` matches the
   prior row's `payload_hash`:
   - invited row (oldest):    payload_hash = `09b9...`
   - updated row (active->inactive):    prev_hash = `09b9...`,
     payload_hash = `7275...`
   - updated row (inactive->active):    prev_hash = `7275...`,
     payload_hash = `7426...`

   The advisory lock did its job. Two UPDATEs within the same
   transaction serialized through `pg_advisory_xact_lock`, each
   reading the freshest payload_hash via the explicit
   `order by triggered_at desc, id desc`.

### Live apply to prod (zmnvwhqjahwidprnjxrq)

Migration 0068 applied via Supabase MCP. Both triggers confirmed
present on `public.org_memberships`.

## Risks closed

- R-W9-IDENTITY-AUDIT-PATCH (carried from 0067 closeout): PATCH-side
  audit coverage was deferred. This PR closes it via the 0068 trigger.
- R-W9-MEMBERS-NO-LIFECYCLE: the team-members admin had no surface for
  role change or deactivation after invite. This PR ships both.
- R-W9-INVITE-STUCK: an invitee who never claimed had no recovery
  affordance short of re-inviting them with a duplicate POST. The
  Resend button provides the recovery path with deduped state
  (refuses already-claimed accounts).

## Risks carried

None new. The destructive confirm is `window.confirm` rather than a
brand-styled modal; this is a known UX gap across the repo and is
tracked elsewhere as a separate UX follow-up.

## Constitutional invariants verified

- Byte-mirror parity (capabilities canon, identity types canon): green.
- Forward-only migration (0068): no edit to 0065 or 0067.
- Idempotent DDL (CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS).
- Idempotency-Key required on both new endpoints; missing header
  returns 400 IDEMPOTENCY_KEY_REQUIRED.
- RLS Pattern A: cross-tenant returns 404, never 403.
- Capability gate before any DB work in both handlers.
- Audit hash chain integrity verified live on staging.
- Brand discipline on disk: no em-dashes, no double hyphens, no emojis
  in code, comments, migration, journal, or email body content.
- No new top-level dependencies.
