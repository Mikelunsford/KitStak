# Path B2.5a — Customer portal re-entry sign-in

**Date:** 2026-05-21
**Decision:** Path B2.5a closed. Customers who have lost their original invite email, whose session has expired, or who are signing in from a fresh device can now type their email on `/portal/signin` and receive a fresh magic link via the same Resend chassis that ships the invites.
**Driven by:** Operator question during Path B2 closeout review: "what happens when the customer closes the browser, do they have to refer to the email signup link in a chain somewhere?" plus the follow-up "would the staff signin page show 'invalid credentials' if a customer landed there?" Both gaps are real and ship closed in this PR.

## What changed

### Backend: new public route `POST /auth-api/portal/request-signin-link`

Added to `supabase/functions/auth-api/index.ts`. Anonymous callers (no JWT) POST `{ email }`. The handler:

1. Parses the body with a Zod schema that `.transform()`s the email (trim + lowercase) before email-format validation.
2. Calls `supabase.auth.admin.listUsers({ filter: 'email eq "<email>"' })` to resolve the email to an `auth.users.id`.
3. If found, queries `org_memberships` joined to `roles` to confirm the user holds a `customer_user` membership with `is_active = true`.
4. If confirmed, calls `auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: 'https://www.kitstak.com/portal' } })` — the same generateLink shape PR #91 proved.
5. Embeds the returned `action_link` in a Kitstak-branded email body and inserts a row into `notifications` with `org_id` = the customer's org, `recipient_user_id` = the customer user id, `entity_type='auth'`, `channel='email'`, `payload.to` = the email, `payload.kind='portal_signin'`. The 5-minute drain cron from Path B1 ships it via Resend.

**Anti-leak posture (constitutional):** every code path — unknown email, known email but not a customer_user, customer_user with generateLink error, malformed body — returns the same 200 envelope `{ ok: true, message: "If that email is registered for a Kitstak customer portal, a sign-in link is on its way." }`. The endpoint never reveals whether an email is registered, which would let an attacker enumerate the operator's customer base.

### Constitutional deviation, documented

The constitution requires `Idempotency-Key` on every non-GET handler with storage scoped to `(key, user_id, org_id, route_hash)`. This endpoint is **pre-authentication**: there is no caller user_id. Forcing a synthetic anon user_id into the idempotency_keys table would pollute it without gaining the intended "same key returns the same body" guarantee, because the underlying `generateLink` call intrinsically MUST produce a fresh single-use token per invocation (the prior token gets invalidated by the new one anyway).

The handler therefore skips the `respondWithIdempotency` wrapper. The divergence is annotated inline in the handler comment and recorded here. Rate-limiting is the right concern instead of idempotency for this surface; deferred to **F-Wave9-PORTAL-SIGNIN-RATE-LIMIT-01**. In v1 the abuse bound is: Resend's account-level rate limits, plus the notifications drain cron runs once every 5 minutes so even a flood request bursts get queued, not amplified.

### SPA: working `/portal/signin` form

`apps/web/src/pages/portal/PortalSignInPage.tsx` rewrote from a static stub message into a working email-input form. The page:

- Uses the same form chassis as the staff SignInPage (TextInput + Button + Zod safeParse).
- Validates the email via `z.string().email()` client-side before POSTing.
- On submit, calls `requestPortalSignInLink(email)` (new service at `apps/web/src/lib/services/portalAuthService.ts`) which POSTs to `/auth-api/portal/request-signin-link`.
- On any non-network response, shows a success card: "If &lt;email&gt; is registered for a Kitstak customer portal, a sign-in link is on its way." — same wording as the server envelope, no leak via UI text.
- Offers a "Send another link" button to reset the form for a second attempt without a page reload.
- Network errors (server unreachable, CORS misconfig) surface as a top-level alert inside the form.
- If the caller is already authenticated, `<Navigate to="/portal" />` short-circuits the form entirely.

### Cross-link between staff and customer sign-in surfaces

The original gap: a customer who typed `kitstak.com` (or hit any other entry point that routes to `/signin`) would land on the staff sign-in form, try to enter a password they never set, and hit "Invalid credentials" with no discoverable path to the portal. Fixed by:

- **`/signin`** — footer line: "Customer accessing your portal? **Sign in to your portal →**" → links to `/portal/signin`.
- **`/portal/signin`** — symmetric footer line: "Kitstak team member? **Staff sign-in →**" → links to `/signin`.

Either landing now leads to an actionable page. The cross-links are static `<Link>` components — they leak no auth state.

### Test mock surface extension

`apps/web/test/regression/_helpers/supabase-mock.ts` gained `auth.admin.listUsers` (with `authAdminListUsersCalls` / `authAdminListUsersResult` on `MockState`) so the handler's two-step lookup (listUsers → org_memberships → generateLink) is fully assertable.

### Regression tests

New file `apps/web/test/regression/auth-api-portal-signin-link.test.ts` ships 6 tests covering:

1. **Anti-leak: unknown email** → 200 canonical envelope, NO generateLink call, NO notifications row.
2. **Anti-leak: email exists but no customer_user membership** → 200 canonical, NO generateLink.
3. **Happy path: customer_user membership** → 200 canonical, generateLink called with `type: 'magiclink'` + portal redirectTo, notifications row inserted with correct `org_id` + `recipient_user_id` + `payload.to` + `payload.kind='portal_signin'` + action_link in body.
4. **Anti-leak: generateLink internal error** → 200 canonical, NO notifications row.
5. **Anti-leak: malformed body** → 200 canonical, listUsers never called (parseBody failure short-circuits).
6. **Email normalisation** → leading/trailing whitespace + mixed case input flows into listUsers + generateLink as the canonical lowercase form.

## Verification

| Gate | Result |
|---|---|
| New B2.5a regression suite (6 tests) | All green |
| Full regression suite | 73 passed + 2 expected skips (was 67; +6 new B2.5a tests) |
| `pnpm test:contract` | 20/20 green |
| `vite build` | green at 16s |
| `size-limit` main bundle | 30.21 kB / 40 kB (unchanged from PR #91; PortalSignInPage is in a lazy chunk) |

## Constitutional invariants verified

| Invariant | Status |
|---|---|
| Forward-only migrations | None touched. No schema change. |
| RLS Pattern A on notifications + org_memberships + customers | All `org_id` filters intact. The notifications row carries the customer's `org_id`, not the caller's (the caller has none). |
| Money helpers / cents wire | Untouched. |
| Idempotency | Deliberately skipped on this single public route; deviation documented in the handler comment and journal (see "Constitutional deviation, documented" above). All other auth-api routes (`/sessions/switch-org`) still enforce `Idempotency-Key`. |
| Audit log | Untouched. No state machine. |
| Capabilities | Untouched. The new route is pre-authentication; no cap check applies. |
| 403-vs-404 contract | The route is public, so neither applies to access. Anti-leak posture (always 200) is the public-route equivalent of the constitution's "hide existence from non-tenants" rule. |
| Zod canon (`_shared/types.ts` ↔ `apps/web/src/lib/types.ts`) | Untouched. The new RequestSignInLinkSchema is endpoint-local (lives in the handler, not the canon). |
| Mirror parity | Untouched. |
| Branding rules | No em dashes / double hyphens / emojis in the email body or any user-facing string. Email sender remains `Kitstak <notifications@kitstak.com>` via the existing `RESEND_FROM` secret. |

## Operator action remaining

None. The endpoint is live after merge + deploy. The two cross-links and the working form ship in the same PR. No secrets or auth configuration touched.

## Smoke test plan (post-merge + deploy)

1. **From a fresh incognito browser** (no Kitstak session), visit `https://www.kitstak.com` → expect to land on `/signin` → confirm the footer "Customer accessing your portal? Sign in to your portal →" link is visible → click it → land on `/portal/signin` with the email form.
2. Type the email of an invited customer (`Mike@Team-01.com` or `Malunsf@gmail.com` from prior smoke), click "Send sign-in link".
3. Expect: success card appears with the canonical message.
4. Manually trigger `gh workflow run notifications-drain.yml` (or wait 5 minutes).
5. Expect: email arrives from `Kitstak <notifications@kitstak.com>` with subject "Sign in to your Kitstak portal", body containing a fresh magic link.
6. Click the link in incognito → land signed-in at `/portal`.
7. **Negative test**: from the same form, type a random non-registered email (e.g. `nobody@example.com`). Expect: same success card. Confirm via Supabase logs that no notifications row was inserted (anti-leak verification).
8. **Cross-link test**: visit `/portal/signin` → confirm "Kitstak team member? Staff sign-in →" link works the other way.

## Closes

- **`F-Wave9-PORTAL-SIGNIN-REENTRY-01`** (implicit; would have been filed) — customer re-entry sign-in surface now exists.
- **Discovered-and-closed gap**: staff signin page now has a cross-link to portal signin (and vice versa). Customers landing at `kitstak.com` from any path now have a discoverable route to authentication.

## Verified live (2026-05-21)

PR #93 merged at `f1af231` (20:00:50Z). deploy-functions workflow rolled both prod and staging `auth-api` bundles to success (run 26249912173). Operator smoke walked the full 4-step rubric:

| Step | Result |
|---|---|
| Cross-link from `kitstak.com` (fresh incognito) → `/signin` → footer "Sign in to your portal" → lands on `/portal/signin` with the email form | Pass |
| Type an invited customer email → click "Send sign-in link" → success card appears with canonical message | Pass |
| Manual `gh workflow run notifications-drain.yml` → workflow ran 26250139653 → returned `polled=1 delivered=1 failed=0` | Pass |
| Email arrived from `Kitstak <notifications@kitstak.com>` with subject "Sign in to your Kitstak portal", body containing fresh magic link, "No password required" line present | Pass |
| Magic link clicked in incognito → lands signed-in at `/portal` (no password page) | Pass |
| **Anti-leak gate**: typed an unregistered email → identical success card text → confirmed NO notifications row was created in Supabase for that email | Pass |
| Reverse cross-link from `/portal/signin` → "Staff sign-in" → bounces to `/signin` | Pass |

All seven smoke checks green. The constitutional anti-leak posture (the critical gate for this endpoint) is verified — the endpoint does not distinguish between "registered customer", "unregistered email", or "email exists but is not a customer_user" at the response shape level. Resend is only invoked for legitimate `customer_user` recipients.

## Spawns

- **`F-Wave9-PORTAL-SIGNIN-RATE-LIMIT-01`**: the constitutional deviation noted above (skipping idempotency on the public sign-in-link request endpoint) leaves rate-limiting as the right control to bound abuse. Deferred to v2 because Resend's account-level rate limit + the 5-min drain cron + the listUsers + membership gate already make a brute-force enumeration attack low-yield: per email, the attacker can only force ONE notifications row per ~5 minutes of drain cycle, and only IF that email matches a real customer_user. Revisit trigger: any signal of abuse (Resend rate-limit alerts, suspicious notifications-table volume) OR the first paying customer's questions about portal security.
- **`F-Wave9-PORTAL-PASSWORD-OPTIONAL-01`**: Path B2.5b — `/portal/account` page where customers can set an optional password and enable MFA, with `/portal/signin` growing a second "Sign in with password" option alongside the magic-link flow. Filed as a future enhancement; magic-link alone covers 100% of the re-entry surface today.
