# 2026-05-26: invite-claim stamp + password-setup flow

Two security/auth follow-ups surfaced during a live demo walk on
2026-05-26, both closed in a single PR off `feat/invite-claim-stamp-and-
password-setup`. The operator hit them in real time with
`accounts@team-01.com`.

## Closes

- `F-Wave9-STAFF-INVITE-CLAIM-STAMP-01`: invite handler did not stamp the
  org claim on the invitee's `app_metadata`, so the first JWT minted on
  magic-link click had no `kitstak_org_id` / `kitstak_org_role` and every
  org-scoped Edge API 401'd.
- `F-Wave9-INVITE-PASSWORD-SETUP-01`: no SPA surface lets a user set a
  password after magic-link sign-in, no Forgot-password affordance on
  `/signin`, no `/auth/recovery` page to consume a Supabase recovery
  token. Magic-link-only users were effectively locked out after sign-
  out.

## What shipped

### Backend

- `supabase/functions/auth-api/index.ts`
  - `postInviteStaffMember`: after `create_staff_membership` RPC succeeds
    and BEFORE the notifications insert, call
    `auth.admin.updateUserById(inviteeUserId, { app_metadata: { ... } })`.
    Failure is logged but does not unwind (membership row already
    exists, invitee can self-heal via the SPA switch-org fallback).
    Stays inside the `respondWithIdempotency` wrapper so replay is still
    no-op.
  - `postRequestPasswordReset`: new public route. No JWT. Anti-
    enumeration posture mirrors `postRequestSignInLink` exactly: every
    code path returns `200 { accepted: true }`, including malformed
    body, missing email, `generateLink` failure, and notification queue
    failure. Uses `generateLink({ type: 'recovery' })` and queues a
    branded email through the notifications chassis (drained by the
    5-minute pg_cron job, shipped via Resend).
  - Local normalising schema for the request body (trim + lowercase
    before email validation), so callers can post whitespace-padded
    addresses without leaking through a 422 differentiator.

- `supabase/migrations/0066_notifications_nullable_org_id.sql`
  - Drops `NOT NULL` on `notifications.org_id` so user-scoped rows
    (password recovery being the first) do not need a synthetic
    platform tenant. RLS SELECT/UPDATE policies still gate on
    `org_id = current_org_id()`; a NULL `org_id` is unreachable through
    those policies, which is the intended privacy posture (recovery
    emails are worker-only).

### Byte-mirrored Zod canon

- `supabase/functions/_shared/types/identity.ts` and
  `apps/web/src/lib/types/identity.ts`: added
  `RequestPasswordResetSchema` + `RequestPasswordResetResponseSchema`
  with their inferred types. Contract test
  (`test/contract/parity.test.ts`) passes.

### Frontend

- `apps/web/src/pages/account/SecurityPage.tsx`: new `/account/security`
  surface. Any signed-in user (no admin guard) can set or change their
  password via `supabase.auth.updateUser({ password })`. Pending /
  success / error feedback inline; success clears the form and shows
  "Password updated".
- `apps/web/src/pages/account/passwordValidator.ts` + test: pure
  validator extracted so unit tests do not have to import the SPA
  supabase client.
- `apps/web/src/pages/auth/RecoveryPage.tsx`: new `/auth/recovery` page,
  public route. The Supabase JS SDK auto-parses the recovery token from
  the URL hash on mount (`detectSessionInUrl: true` default). The page
  reads the session state from the SDK and renders one of two views:
    - happy path: a session is present, render the password-set form.
      Submit calls `updateUser({ password })` and routes to `/dashboard`.
    - fallback: no session, render "This link is invalid or has expired"
      with a link back to `/signin`.
  We do not trust the token client-side; validation is delegated to the
  SDK and Supabase Auth server.
- `apps/web/src/pages/SignInPage.tsx`: added a `ForgotPasswordPanel`
  below the sign-in form. Toggle-revealed inline form. On submit calls
  `requestPasswordReset({ email })` and shows the anti-enumeration
  confirmation message regardless of outcome (network error included).
  The error branch deliberately swallows so the UI is not a side
  channel.
- `apps/web/src/components/shell/Topbar.tsx`: profile dropdown gains an
  "Account security" entry above "Sign out".
- `apps/web/src/lib/services/authResetService.ts` + Zod-validated
  envelope.
- `apps/web/src/lib/hooks/useAuthReset.ts`: TanStack Query mutation.
- `apps/web/src/routes.ts`: registered `/account/security` (protected)
  and `/auth/recovery` (public).

### Tests

- `apps/web/test/regression/auth-api-members-invite.test.ts`: extended
  the happy-path assertion to verify `auth.admin.updateUserById` is
  called with the correct args, and added a new test that proves a
  claim-stamp failure does not unwind the membership or block the
  notification.
- `apps/web/test/regression/auth-api-request-password-reset.test.ts`:
  new regression suite. Five tests cover anti-enumeration (unknown
  email, generateLink failure, malformed body), happy path (recovery
  link, notifications row with `org_id: null`, payload tag), and email
  normalisation.
- `apps/web/src/pages/account/passwordValidator.test.ts`: six unit
  tests pinning the validator contract.
- `apps/web/src/lib/types/identityResetSchemas.test.ts`: six unit tests
  pinning the wire-shape semantics.
- `apps/web/test/regression/_helpers/supabase-mock.ts`: extended the
  mock with `auth.admin.updateUserById` (calls + result) and a default
  `getUserById` stub.

## Verification

- `pnpm --filter web typecheck`: green.
- `pnpm --filter web lint`: green.
- `pnpm --filter web test`: 483 src tests + 204 regression tests pass.
- `pnpm --filter web test:contract`: 20 tests pass (byte-mirror parity
  preserved).
- `pnpm --filter web build`: 9.55s, no errors.
- `pnpm --filter web bundle-budget`: 30.77 kB gzipped, under the 40 kB
  limit.

## Constitutional alignment

- Money rules: untouched. No new `_cents` columns.
- RLS rules: notifications policies unchanged. NULL `org_id` is
  unreachable through the existing `org_id = current_org_id()` gate,
  which is the intended privacy posture for user-scoped rows.
- Migration rules: 0066 is forward-only and idempotent (drop-NOT-NULL is
  safe to re-apply). DOWN migration documented as operator-only.
- Zod canon: byte-mirror parity preserved (contract test green).
- Idempotency: `postInviteStaffMember` still wraps the whole side-
  effecting block in `respondWithIdempotency`, including the new claim-
  stamp. `postRequestPasswordReset` documents the same idempotency
  deviation as `postRequestSignInLink` (pre-auth, every call mints a
  fresh single-use token, key-scoping cannot provide the intended
  guarantee).
- Capabilities: no new caps. `/auth/request-password-reset` is public;
  `/account/security` is protected; no admin guard needed because every
  user has the right to manage their own password.
- Audit log: not touched. `notifications` is not in the audit_log
  entity_type CHECK and does not participate in the hash chain.
- Brand discipline: no em-dashes, no double hyphens, no emojis anywhere
  on disk. Built to Ship voice throughout.

## Security review notes

- Anti-enumeration: the password-reset endpoint returns the same
  envelope and status in every branch. Malformed body, unknown email,
  generateLink failure, and notifications queue failure all yield
  `200 { accepted: true }`. The SPA forgot-password form mirrors this
  by swallowing network errors and rendering the same confirmation.
- Recovery token TTL: Supabase recovery links are valid for 1 hour by
  default. The email body states this explicitly.
- Password minimum length: 8 characters enforced both client-side
  (validator + `minLength` attribute) and server-side (Supabase Auth
  setting). The validator is also used by `/auth/recovery` so the same
  gate applies to recovery flows.
- Claim-stamp ordering: stamp happens AFTER the membership RPC (so we
  do not stamp an org claim for a membership that failed to create) and
  BEFORE the notifications queue (so the row exists for the worker even
  if the stamp logs a transient error). All inside the idempotency
  wrapper, so a replay does not double-fire any side effect.
- Recovery handler trust posture: the page does not parse or validate
  the token. The Supabase SDK is the authoritative consumer; we only
  read `getSession()` to decide which view to render.
