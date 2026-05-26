# 2026-05-26 . Staff invite SPA chassis

## Scope

SPA half of `F-Wave9-STAFF-INVITE-CHASSIS-01`. Lands the `/admin/members`
page, fixes the dead-end dashboard `invite_teammate` onboarding card, and
extends the SetupChecklist from 7 steps to 8.

The backend half (migration + RPC + Edge handler) ships in a parallel PR
against the same Zod schemas added here. Byte-parity contract test gates
any drift between SPA and `_shared/types/identity.ts`.

## What shipped

### New surfaces
- `/admin/members` route registered behind the `admin` guard.
- `MembersPage.tsx`: stacked TEAM MEMBERS list (v1 stub backed by `/me`)
  plus INVITE A TEAMMATE form (email, role dropdown, Send button with
  pending / success / error states).
- `data-testid="org-members-list-stub"` on the list container so the
  follow-up that wires the LIST endpoint can find and replace.

### New service + hook + queryKeys
- `lib/services/membersService.ts` . `inviteStaffMember(body)` POSTs to
  `/auth-api/members/invite`. Parses the response through
  `InviteStaffResponseSchema` on the wire boundary.
- `lib/hooks/useMembers.ts` . `useInviteStaffMember()` mutation. On
  success invalidates the members list and the dashboard summary so the
  SetupChecklist step 8 ticks on the next dashboard visit.
- `lib/queryKeys/members.ts` . `membersKeys.{all,list,detail}` namespace.

### Zod canon additions (byte-mirrored)
- `apps/web/src/lib/types/identity.ts` and
  `supabase/functions/_shared/types/identity.ts`:
  - `StaffRoleCodeSchema` (the six staff codes, excluding portal codes)
  - `InviteStaffRequestSchema` ({ email, role })
  - `InviteStaffResponseSchema` ({ user_id, membership_id, role, email })
- `apps/web/src/lib/types/cross_cutting.ts` and the `_shared` mirror:
  - `setup_team_invited: z.boolean().default(false)` on
    `DashboardSummarySchema`.
- Contract test (`pnpm test:contract`) green: 20/20 passing.

### Dashboard card fix
- `dashboardWorkCards.ts` `invite_teammate` route flipped from
  `/admin/settings` (dead end) to `/admin/members`. Helper copy updated
  to match the new destination.

### SetupChecklist extension (7 -> 8)
- `dashboardChecklistSteps.ts`:
  - New step 8 `team_invited` with label "Invite a teammate", helper
    copy, deep link to `/admin/members`.
  - `SETUP_STEPS_TOTAL` bumped from 7 to 8.
  - Step ordering rationale added to file header.
- `SetupChecklist.tsx` renders an arbitrary-length step array; no
  component change required. Progress bar and "X of 8 complete" counter
  recompute automatically from the new total.

### Pure helper for testability
- `pages/admin/membersInviteForm.ts` lifts the role-options list, the
  default role, and the submit predicate out of the page component so
  Vitest can exercise them under the repo's no-jsdom convention.

## Tests

- `pnpm typecheck`: clean.
- `pnpm test` (src + regression): 477 + 190 = 667 passing, 2 skipped.
  - 11 new tests on `membersInviteForm.test.ts`.
  - 4 updated tests on `dashboardChecklistSteps.test.ts` (8-step order,
    new total, route assertion, completion fixtures).
  - 1 updated assertion + summary factory in `dashboardWorkCards.test.ts`.
- `pnpm test:contract`: 20/20 passing. SPA and `_shared` `identity.ts`
  and `cross_cutting.ts` are byte-identical.
- `pnpm build`: clean. `MembersPage` chunked at 5.78 kB raw / 2.22 kB
  gzipped, lazy-loaded behind the admin guard. No new top-level
  dependencies.

## Constitutional alignment

| Invariant | Verified |
|---|---|
| Zod canon byte-parity | Yes (pnpm test:contract green; copied SPA over `_shared` for both `identity.ts` and `cross_cutting.ts`) |
| Idempotency-Key on every non-GET | Yes (apiClient injects automatically; verified) |
| No new top-level deps | Yes (lucide-react icons already in bundle: Users, UserPlus, Mail) |
| No em dash / double hyphen / emoji in copy | Yes (covered by existing checklist-step copy guards; new step 8 strings pass the same regex) |
| RLS Pattern A on `/admin/members` | Route guard is admin; backend agent handles RPC-side check |
| Capabilities | SPA defers to admin route guard; backend `requireCap` on the invite handler is the authority per CLAUDE.md "SPA mirrors the role policy for button hiding only" |
| Migration rules | No SPA migration. Backend PR ships the DB side |
| Forward-only | No DB changes here |

## Follow-ups carried

- `F-Wave9-STAFF-INVITE-MEMBERS-LIST-01`: replace the `MembersPage` stub
  with a real list once the backend `GET /auth-api/members` endpoint
  lands. The stub container carries `data-testid="org-members-list-stub"`
  to make the replacement trivial.
- `F-Wave9-STAFF-INVITE-RESEND-01`: a Resend button per pending member
  row would be a small follow-up after the list endpoint exists.
