# 2026-05-26 - Onboarding chassis end to end (8 PRs)

Status: closed. All 8 PRs merged + live-verified on prod.
Branches: all deleted post-merge.

## The arc

Started the day with a polish wedge plan (3 follow-ups: send-feedback, detail-empty-coaching, celebration banner). Ended the day with the entire fresh-operator onboarding journey shipped from "got an email" through "I have credentials I control and can use the product."

The arc broke into three movements:

### Movement 1: polish wedge (PRs A + B + C)

Three parallel agents dispatched against tight self-contained specs. Each got a hard brand-discipline mandate (no em dashes, no emojis, no double hyphens), Tailwind tokens only, no new top-level deps. All three opened green within 14 minutes wall time. Brand-discipline scan caught two em-dash slips (PR A test comment, PR B component comment + journal) and pushed chore commits on the agent branches before merging. PR C was the cleanest (zero violations from the agent).

Merged A then B then C, deploy-prod concurrency gate (PR #141 from earlier this week) serialized the three deploys without any alias race.

### Movement 2: staff invite chassis (PRs D + E + F)

Operator-prompted dispatch of two parallel agents (backend + frontend) for the staff invite chassis. Both seeded with the SAME Zod schema block verbatim so byte-mirror parity held. Cross-PR overlap on 6 shared files; post-D-merge conflicts on E were all trivial (kept origin/main's better-documented version on cross_cutting.ts, deduped identical Zod blocks on identity.ts in both layers because git auto-merge kept both copies).

PR D security review passed cleanly:
- Capability gate `org.member.invite` first
- Schema validation before privilege check (org_admin cannot mint org_owner)
- `org_id` locked to caller JWT (no cross-tenant invite possible)
- Inside `respondWithIdempotency` wrapper
- RPC `SECURITY DEFINER` + service_role only
- Notification queue failure logs but does not unwind the membership

PR E shipped the members LIST as a stub (only shows caller) because the corresponding backend `GET /auth-api/members` endpoint is not built yet. Filed as `F-Wave9-STAFF-INVITE-MEMBERS-LIST-01`.

Then the operator walked the invite flow end to end on prod and caught two real bugs that no PR review could have surfaced:

1. **Claim-stamp gap**: the invite handler created the membership row but never stamped `kitstak_org_id` / `kitstak_org_role` on the invitee's `auth.users.raw_app_meta_data`. The very first JWT Supabase minted on magic-link sign-in had no org context. Every org-scoped Edge API (branding, flags, dashboard summary) returned 401. Dashboard rendered with broken sections.
2. **Password setup gap**: magic-link sign-in mints a session but never sets a password. If the invitee signed out, they were completely locked out: no password to enter on `/signin`, no "Forgot password" link, no `/account/security` page.

Manually patched the operator's session (SQL update on `auth.users.raw_app_meta_data` for the existing invitee) so he could continue testing, then dispatched PR F as one focused agent covering both fixes in a single branch.

### Movement 3: PR F + PR G + chore #152

PR F shipped:

- `postInviteStaffMember` patch: `auth.admin.updateUserById(inviteeUserId, { app_metadata: { kitstak_org_id, kitstak_org_role } })` inside the idempotency wrapper, after the RPC, before the notification. Failure is logged but does not unwind the membership.
- New public `POST /auth-api/auth/request-password-reset` endpoint (no JWT, anti-enumeration: always 200 with same envelope, mirrors `postRequestSignInLink` posture). Generates Supabase recovery link via `auth.admin.generateLink({ type: 'recovery' })`, queues via the notifications chassis.
- New `/auth/recovery` page consuming the recovery token from the URL hash via the Supabase SDK auto-parse (does not trust client-supplied tokens).
- New `/account/security` page for signed-in password changes, wired into the Topbar profile dropdown.
- `/signin` "Forgot password" inline form.
- Migration `0066_notifications_nullable_org_id.sql` dropping `NOT NULL` on `notifications.org_id` so user-scoped recovery emails can be queued without a synthetic platform-tenant stand-in. RLS posture preserved because existing SELECT/UPDATE policies filter `org_id = current_org_id()` and a NULL `org_id` is unreachable through those policies; INSERT remains service_role only.

PR F CI initially failed on `canon-steward-check` because both new routes (`/account/security` + `/auth/recovery`) are intentional orphans by design (accessed via profile dropdown and recovery email link respectively, never via sidebar). Pushed a chore commit to add both to `scripts/canon-steward-allowlist.txt` with explicit "orphan by design" reasoning and CI cleared. This was the SECOND time today an agent shipped a new orphan route without remembering the allowlist (PR E also had the same trip on `/admin/members`). Worth a chassis improvement: emit a hint pointing at the allowlist format in the canon-steward error message itself so agents self-heal without a re-push. Filed as `F-Wave9-CANON-STEWARD-ROUTE-HINT-01`.

Operator re-tested the full invite flow after F merged. Clean magic-link sign-in. No 401s. Dashboard rendered fully. PR F claim-stamp fix verified live. But operator noted that the invitee was never prompted to set a password.

Dispatched PR G to close `F-Wave9-INVITE-PASSWORD-PROMPT-01`:

- New pure helper `firstSigninPromptState.ts` (per-user localStorage key `kitstak:password-prompt-seen:<user_id>`, defensive against SSR / throwing storage / empty userId, tests under the repo no-jsdom convention)
- `DashboardPage` `useEffect` redirect to `/account/security?welcome=1` on first mount (gated on `!me.isLoading && userId` to never fire with empty id, `replace: true` so back button can't bounce out)
- New presentational `FirstSigninWelcomeBanner.tsx` (KeyRound icon, WELCOME TO KITSTAK display headline, "Built to Ship." tagline, secondary "Skip for now" button)
- `SecurityPage` renders the banner conditionally on `?welcome=1` and calls `markPasswordPromptSeen(userId)` on BOTH successful password set AND Skip click

Smoke-tested live by re-inviting `mike+test01@team-01.com` (original magic link was single-use and consumed), opened the new link in incognito, observed the redirect fire, set a password via the form, signed out, signed back in cleanly via `/signin` with the new password. Only console message was a benign Chrome DOM hint about a missing hidden username field on password forms (Chrome / 1Password / Bitwarden expect a `username` input adjacent to the password fields so saved passwords can be bound to specific accounts; screen readers use the same field to announce account context).

Shipped chore PR #152: hidden `input[type=text][name=username]` with `autoComplete="username"`, `readOnly`, `hidden`, `tabIndex={-1}`, `aria-hidden="true"` on both `SecurityPage` (email from `useMe()`) and `RecoveryPage` (email captured from the recovery session at `getSession()` time, stored alongside the recovery state machine). Closes `F-Wave9-PASSWORD-FORM-USERNAME-A11Y-01`.

## Constitutional invariants verified across all 8 PRs

| Invariant | Status |
|---|---|
| Money rules | Untouched. No `_cents` columns added. |
| RLS rules | Pattern A preserved. SECURITY DEFINER + service_role only on `create_staff_membership` RPC. The `auth.admin.updateUserById` calls happen inside Edge function handlers with capability gates. |
| Audit rules | `trg_audit_organizations_status` still fires. New `org_memberships` insert via the RPC does not currently write to `audit_log` (filed as `F-Wave9-STAFF-INVITE-AUDIT-01`; `org_membership` is not in the audit `entity_type` enum yet). |
| Migration rules | Forward-only. Both 0065 and 0066 are idempotent (CREATE OR REPLACE FUNCTION; ALTER COLUMN DROP NOT NULL is safe to re-apply). DOWN MIGRATIONS documented as operator-only in both migration headers. |
| Idempotency | New `POST /auth-api/members/invite` requires `Idempotency-Key` per constitution. `respondWithIdempotency` wrap verified intact post-PR F. New public `POST /auth-api/auth/request-password-reset` deliberately omits Idempotency-Key per anti-enumeration design (mirrors `postRequestSignInLink`). |
| Zod canon | Byte-mirror parity asserted 8/8 times via `pnpm test:contract`. Cross-PR identical Zod block additions were detected and deduplicated during the D/E merge. |
| Brand discipline | No em dashes, no double hyphens, no emojis in any new code, comments, or journals. 5 pre-merge slips caught and fixed (em-dashes in PR A test header, PR B component comment + journal). |

## Bundle delta

Main bundle started ~30.40 kB gzipped, ended **30.77 kB** gzipped. Well within the 40 kB cap. Per-page chunks lazy-loaded with their pages so the entry bundle stayed lean despite shipping 7 new SPA components.

## Follow-ups filed

| ID | Scope |
|---|---|
| `F-Wave9-STAFF-INVITE-MEMBERS-LIST-01` | Real `GET /auth-api/members` endpoint + replace the v1 MembersPage stub with a real list (paginated, sortable). |
| `F-Wave9-STAFF-INVITE-PATCH-01` | Per-row PATCH on `/admin/members` for role change and deactivate. |
| `F-Wave9-STAFF-INVITE-RESEND-01` | Per-row "Resend invite" after the list endpoint ships. |
| `F-Wave9-STAFF-INVITE-AUDIT-01` | Add `org_membership` to `audit_log.entity_type` enum + a trigger that captures invite events on the hash chain. |
| `F-Wave9-INVITE-EMAIL-SUBJECT-COPY-01` | `"You have been invited to Kitstak on Kitstak"` reads awkwardly when the org's `display_name` IS Kitstak. Change the template to `"You have been invited to join {orgDisplayName}"` or similar. |
| `F-Wave9-CANON-STEWARD-ROUTE-HINT-01` | When `orphan-route` violation is detected, emit a hint pointing at the allowlist file + format so agents can self-heal without a re-push. Twice today an agent shipped a new orphan route without remembering the allowlist. |

## Process notes worth keeping

- **Parallel agent dispatch keeps working** for focused implementation PRs when each agent has a tight self-contained spec with explicit done criteria. Held up across all 8 PRs without coordination thrash. Continues to validate the `parallel_audit_agents_thrash` memory's qualifier ("focused implementation PRs, not open-ended audits").
- **Live smoke walking finds bugs no PR review surfaces.** The two real bugs caught today (claim-stamp gap, password-setup gap) were both invisible to vitest, contract tests, and PR review. They only surfaced when a real user clicked a real magic link and watched the real dashboard render. This is the case for inviting the operator (or anyone) to walk the flow before declaring a chassis done.
- **Byte-mirror Zod parity contract test pulled its weight** at least twice today: caught identical-block duplication after the D/E auto-merge in `identity.ts`, and would have caught a single-side drift if either agent had paraphrased the schema.
- **canon-steward-check tripped agents twice in one day** on the same class of issue (new route, no sidebar entry, no allowlist entry). Filed as a chassis improvement (`F-Wave9-CANON-STEWARD-ROUTE-HINT-01`) rather than living with the re-push.
- **The temp-password-via-SQL pattern (`crypt('value', gen_salt('bf'))`) is the right tool** for unblocking a locked-out test account when password-recovery isn't yet built. Used three times today (existing `mike@team-01.com`, new `accounts@team-01.com`, then again on the invitee for the password-prompt smoke). Consistent and fast.
