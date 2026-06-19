# Closeout: operator active-org claim fix and dual-role portal dead-end

Date: 2026-06-19. Type: prod data fix (one account) plus a product follow-up.
Scope: identity / auth. No code change shipped in this entry; the fix was a
direct, operator-authorized claim re-stamp on prod.

## Symptom

The operator (mike@team-01.com) reported being unable to switch to the Team 1
Supplier Services workspace, and separately suspected that the upper and lower
case spellings of the email were two different logins with different views.

## Investigation

Read against prod (`zmnvwhqjahwidprnjxrq`):

- There is exactly one auth account for the email, `ce7c0eaf`, stored lowercase.
  Supabase normalises email case to a single row, so both case spellings sign in
  to the same account. The "two logins" theory was a red herring.
- That account holds two active memberships: `org_owner` in Team 1 Supplier
  Services (`4e234c7d`) and `customer_user` in the Kitstak org (`ba4622dd`).
- The active-org claim on `app_metadata` was pinned to the Kitstak org with role
  `customer_user`.

## Root cause

`customer_user` is a portal role. The workspace switcher lives only in the
operator shell (`Topbar`); the customer portal has no switcher. A session whose
active claim is a portal role therefore has no UI control to switch itself out.
The operator's claim was parked on the Kitstak portal membership (most likely via
a portal sign-in link), so the app rendered the customer portal with no way back
to the operator org. The differing "views" the operator saw were the same account
rendering the portal versus the operator app depending on the active claim at the
time, not a case-sensitivity split.

The backend was not at fault: `GET /auth-api/me` returns every active membership
(no role filter) and `POST /auth-api/sessions/switch-org` validates membership
and stamps the claim. The trap is purely that the switch control is unreachable
from a portal-role session.

## Fix applied (operator-authorized)

Direct re-stamp of the active-org claim to Team 1 as owner, the same write
`switch-org` performs:

- `auth.users.raw_app_meta_data`: `kitstak_org_id` to `4e234c7d`,
  `kitstak_org_role` to `org_owner`.
- `public.profiles.last_org_id` to `4e234c7d` so future sign-ins default there.

Verified the claim now reads `4e234c7d` / `org_owner`. Both memberships remain
intact; the Kitstak portal access is unchanged, just no longer the default. The
operator must sign out and back in to mint a fresh JWT carrying the new claim.

Note: the Supabase MCP write was twice blocked by the auto-mode classifier as a
prod auth mutation until the operator gave explicit authorization, which is the
correct guardrail for a shared-state write.

## Follow-up filed

`F-Wave14-PORTAL-DUALROLE-SWITCH-01`. A user who is an operator-role member of one
org and a `customer_user` of another can be stranded: a portal-role active claim
drops them into the customer portal, which exposes no workspace switcher, so there
is no UI path back to their operator workspace. Options to harden:

- Surface a "switch to your operator workspace" affordance in the portal chrome
  for sessions whose `/me` carries a non-`customer_user` membership.
- Or make a minimal switch control reachable from the portal for dual-role
  sessions, posting to the existing `switch-org` endpoint.
- Consider defaulting the active claim to the highest-privilege membership on
  sign-in rather than the last-stamped one, so a portal link does not silently
  demote an owner's default workspace.

## Housekeeping noted (not actioned)

An unconfirmed typo account `accounts@team-01.om` (`fbada073`, never signed in)
exists from a fat-fingered invite. Left in place pending operator direction.
