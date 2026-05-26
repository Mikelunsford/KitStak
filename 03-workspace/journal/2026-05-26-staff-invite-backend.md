# 2026-05-26 - Staff Invite Chassis (Backend)

Status: shipped via PR (pending).
Branch: `feat/staff-invite-backend`
Closes: backend half of `F-Wave9-STAFF-INVITE-CHASSIS-01`.

## Why this work

Operators provisioned via `provision_organization` arrive as the sole `org_owner` of a fresh tenant. Today there is no in-product surface to invite teammates, so a multi-person operator can only co-work by sharing the founder credential. That blocks the very first multi-seat customer.

This PR ships the backend chassis. A second PR (frontend, running in parallel) lands the admin members page that hits this surface.

## What shipped

### Migration 0065_staff_invite_function.sql

- `create_staff_membership(p_org_id uuid, p_user_id uuid, p_role_code text, p_invited_by uuid) returns uuid`
- `SECURITY DEFINER`, `set search_path = public`.
- Permissions: revoke from public/anon/authenticated; grant to service_role only.
- Validation: `p_role_code` must be one of `org_owner`, `org_admin`, `sales`, `ops`, `accounting`, `viewer`. Customer and vendor portal codes are intentionally excluded; they have their own provisioning paths.
- Tenant guard: the target org must exist (`deleted_at is null`) and be `status = 'active'`. Suspended or archived orgs raise NOT_FOUND.
- Insert into `org_memberships (org_id, user_id, role_id, is_active, joined_at, created_by, updated_by)` with `on conflict (org_id, user_id) do nothing`. A re-invite of the same email (which resolves to the same `auth.users.id`) returns the existing membership id without changing role or activation state. Intentional role changes are out of scope for this chassis; that ships as a separate PATCH route.
- Returns the membership id whether newly inserted or already present.

Patterned exactly on the customer-portal `create_portal_membership` RPC from migration 0055.

### Zod canon (byte-mirror parity)

Both `_shared/types/identity.ts` and `apps/web/src/lib/types/identity.ts` now expose:

- `StaffRoleCodeSchema` (the six staff role codes).
- `InviteStaffRequestSchema` (`email`, `role`).
- `InviteStaffResponseSchema` (`user_id`, `membership_id`, `role`, `email`).

Both `_shared/types/cross_cutting.ts` and `apps/web/src/lib/types/cross_cutting.ts` now carry a new `setup_team_invited: z.boolean().default(false)` field on `DashboardSummarySchema`, immediately after the existing seven setup booleans.

`pnpm test:contract` confirms byte parity (parity.test.ts + money.parity.test.ts both green).

### Edge handler: auth-api `POST /members/invite`

- `requireCap('org.member.invite')` gates the route. The matrix already grants this cap to `org_owner` and `org_admin`; no capability changes needed.
- Body validated against `InviteStaffRequestSchema`. Malformed email or non-staff role surface as 422 `VALIDATION_ERROR` before any side effect.
- Privilege-escalation guard: if `body.role === 'org_owner'` and `caller.role !== 'org_owner'`, throw 403 `FORBIDDEN`. An `org_admin` cannot mint another owner; only an existing owner can.
- Wrapped in `respondWithIdempotency` so a re-click of the same Invite button replays the stored response from `idempotency_keys` instead of firing a second magic link.
- `sb.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: 'https://www.kitstak.com/dashboard' } })`. On error, throw 422 `AUTH_ERROR`. Read `data.user.id` and `data.properties.action_link`; if either is missing, throw 500.
- Call `sb.rpc('create_staff_membership', { p_org_id, p_user_id, p_role_code, p_invited_by })`. On error, throw 500. Membership creation is atomic at the DB layer.
- Resolve org `display_name` for the email subject; fall back to `'Kitstak'` if the lookup fails.
- Queue the invite email through `notifications` (channel `email`, `type: 'staff_invite'`). The 5-minute drain cron ships it via Resend. Failure to queue is logged but does not unwind the membership.
- Returns 201 with the documented envelope.

Route registered in `auth-api/index.ts` Deno.serve route table alongside `/sessions/switch-org` and `/portal/request-signin-link`.

### dashboard-api: `setup_team_invited`

Added a new boolean to `GET /dashboard/summary`. Computed via `existsRowForOrg('org_memberships', orgId, q => q.eq('is_active', true).in('role_id', staffRoleIdsExcludingOwner))`.

`staffRoleIdsExcludingOwner` is resolved once per request from `roles` where `code in ('org_admin','sales','ops','accounting','viewer')`. Owner is excluded because every org has exactly one owner created at provisioning (migration 0064); counting that membership would mark `setup_team_invited` true from day one and defeat the checklist signal.

### Test coverage

`apps/web/test/regression/auth-api-members-invite.test.ts` (8 tests, all passing):

1. Cap gate (viewer -> 403).
2. Privilege-escalation guard (admin granting owner -> 403, no side effects).
3. Validation (bad email -> 422).
4. Validation (non-staff role -> 422).
5. Auth-error path (generateLink fails -> 422 AUTH_ERROR, no membership).
6. Happy path (org_owner -> 201, generateLink + RPC + notifications all called with the right args).
7. org_admin can invite a peer role (sales) -> 201.
8. Idempotency-Key required (missing header -> 400 IDEMPOTENCY_KEY_REQUIRED).

Note on idempotency replay: the regression-test harness mocks Supabase at the `.from()` level and does not persist inserts back into the row store, so a same-key replay test would always fail on a harness limitation rather than on real handler behaviour. The canonical idempotency replay contract is covered by the shared `idempotency` unit suite against the wrapper directly. This is the same approach the existing crm-api portal invite regression takes.

Two unrelated test fixture files were updated to add the new `setup_team_invited: false` field to their `DashboardSummary` stubs:

- `apps/web/src/pages/dashboardChecklistSteps.test.ts`
- `apps/web/src/pages/dashboardWorkCards.test.ts`

The factory pattern intentionally requires every field, so a new Zod field surfaces as a TS error in the fixtures (per the existing comment on those files).

## Constitutional invariants verified

| Invariant | Outcome |
|---|---|
| Money rules | Untouched. No `_cents` columns added or modified. |
| RLS rules | The RPC is `SECURITY DEFINER` + `service_role` only, mirroring 0055. Caller authz happens at the handler boundary (`requireCap('org.member.invite')` plus the privilege-escalation guard). `org_memberships` already enforces Pattern A `current_user_role() in ('org_owner','org_admin')` for writes via the policy installed in 0001; the service-role bypass is the documented escape hatch and the RPC is the only surface that uses it. Cross-tenant probes surface as NOT_FOUND. |
| Migration rules | Forward-only. Idempotent (`CREATE OR REPLACE FUNCTION`; `ON CONFLICT DO NOTHING` inside; explicit re-select after insert). |
| Zod canon | Both pairs of side-cars byte-identical. `pnpm test:contract` green. |
| Idempotency | `respondWithIdempotency` wraps the side-effecting block. Missing header returns 400 IDEMPOTENCY_KEY_REQUIRED. Same-key + same-body replays from `idempotency_keys`. |
| Audit log | `org_memberships` is not in the audit_log entity_type enum today (identity-side, not business-data). Caller is captured via `created_by` / `updated_by` on the row. Audit at the identity layer can be added later via a forward migration. |
| Capabilities | `org.member.invite` cap is already in the matrix (granted to `org_owner` and `org_admin`). No new cap added. |
| Branding | No em dashes, no double hyphens, no emojis in any user-facing copy (email subject, body, error messages). Subject uses the resolved org `display_name`; body uses periods and newlines only. |

## Risks carried

- `F-Wave9-STAFF-INVITE-FRONTEND-01` is the parallel SPA work (admin/members page). It hits `POST /members/invite` and renders the new dashboard `setup_team_invited` boolean as the optional team-invite checklist step.
- `F-Wave9-STAFF-INVITE-AUDIT-01` (deferred). Adding `org_membership` to the `audit_log` entity_type enum so role grants are first-class audit rows. Not blocking the v1 chassis.
- `F-Wave9-STAFF-INVITE-PATCH-01` (deferred). A separate PATCH route to change an existing membership's role or deactivate. This PR's RPC intentionally does not mutate existing rows (idempotent re-invite contract); role changes are a different operator workflow.

## Files touched

```
supabase/migrations/0065_staff_invite_function.sql            (new)
supabase/functions/_shared/types/identity.ts                  (modified)
supabase/functions/_shared/types/cross_cutting.ts             (modified)
supabase/functions/auth-api/index.ts                          (modified)
supabase/functions/dashboard-api/index.ts                     (modified)
apps/web/src/lib/types/identity.ts                            (modified, byte-mirror)
apps/web/src/lib/types/cross_cutting.ts                       (modified, byte-mirror)
apps/web/src/pages/dashboardChecklistSteps.test.ts            (modified, fixture)
apps/web/src/pages/dashboardWorkCards.test.ts                 (modified, fixture)
apps/web/test/regression/auth-api-members-invite.test.ts      (new)
03-workspace/journal/2026-05-26-staff-invite-backend.md       (new)
```

## CI pre-flight

Local results before pushing:

- `pnpm typecheck` -> clean.
- `pnpm test` -> 52 src + 30 regression test files, 466 + 198 tests passing.
- `pnpm test:contract` -> 2 files, 20 tests passing (parity + money parity).
- `pnpm build` -> success in ~10s, no bundle changes.
