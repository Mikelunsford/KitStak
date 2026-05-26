# 2026-05-27 · Staff invite members list

Closes F-Wave9-STAFF-INVITE-MEMBERS-LIST-01. Replaces the v1
/admin/members stub (which only showed the caller's own row from /me)
with a real list backed by a real `GET /auth-api/members` endpoint.

## What shipped

### Backend (auth-api)
- New capability `org.member.list` added to the singular byte-mirrored
  canon (`_shared/capabilities.ts` and `apps/web/src/lib/capabilities.ts`).
  Granted to org_owner, org_admin, ops, accounting, viewer. Denied to
  sales, customer_user, vendor_user.
- New handler `listOrgMembers` in `supabase/functions/auth-api/index.ts`,
  registered as `GET /members` on the route table.
- New Zod canon `OrgMemberRowSchema` and `OrgMembersListResponseSchema`
  added to the byte-mirrored identity types side-car.
- Envelope: flat array per F-Wave7-LISTENVELOPE-01, not `{ items: ... }`.
- No new migration. All read-side, served from existing `org_memberships`,
  `roles`, and `profiles` tables.

### Frontend (SPA)
- New `listOrgMembers()` in `apps/web/src/lib/services/membersService.ts`.
- New `useOrgMembers({ orgId })` hook in `apps/web/src/lib/hooks/`,
  scoped to org id so a workspace switch evicts cleanly. Reuses the
  existing `membersKeys.list({ org_id })` key so the existing
  `useInviteStaffMember` mutation (which already invalidates
  `membersKeys.all`) refreshes the list automatically after an invite.
- Rewrote `MembersPage.tsx`: replaces the stub with a real table
  (Name, Email, Role, Joined). Caller's own row marked "(you)". Loading,
  error, and empty states all brand-aligned. The invite form below is
  untouched beyond an `id="invite-teammate"` anchor on the section so
  the empty-state hint can scroll to it.

## Tests

- New regression suite `apps/web/test/regression/auth-api-members-list.test.ts`.
  Six tests, all green:
  - viewer allowed (cap granted)
  - sales denied (403)
  - customer_user denied (403)
  - cross-tenant: org A caller sees only org A rows (Pattern A read)
  - happy path: 200, flat array, every row matches schema
  - profile-missing rows are silently dropped so the response always
    parses cleanly through the Zod schema
- `pnpm test:contract`: green (capabilities and identity types parity).
- `pnpm --filter web test`: all 506 prior tests + 6 new = 512 passing.

## Bundle delta

- `MembersPage` chunk: 7.56 kB (gzipped 2.69 kB). Spec budget was
  40 kB main; well under.
- Main `index` chunk: 30.94 kB gzipped. Landing-page budget 150 kB
  gzipped; well under.

## Constitutional invariants verified

- Money: untouched.
- RLS: handler filters defensively by `caller.orgId` even though the
  Pattern A policy on `org_memberships` already constrains; constitutional
  "200 + filtered" for cross-tenant reads on Pattern A.
- Migration: forward-only; no migration shipped this round.
- Idempotency: GET handler, no Idempotency-Key required.
- Audit log: untouched; read-only endpoint.
- Zod canon: byte parity verified by `pnpm test:contract`.
- Capabilities: new cap `org.member.list` added to both byte-mirrored
  canon files in the same commit. Parity test green.
- Brand: no em-dashes, double hyphens, or emojis in any new code,
  comment, or doc.

## Follow-ups

- F-Wave9-STAFF-INVITE-PATCH-01 (role change on existing membership) is
  already filed and remains the natural next step.
- F-Wave9-STAFF-INVITE-RESEND-01 (re-trigger magic link from the row)
  is already filed and remains the natural next step.
- F-Wave9-STAFF-INVITE-REMOVE-01 (deactivate membership from the row)
  is implied by `org.member.remove` and can be filed when the operator
  hits the use case.
