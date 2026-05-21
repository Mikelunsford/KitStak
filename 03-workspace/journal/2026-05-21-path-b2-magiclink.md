# Path B2 MAGICLINK-01 — portal invite swapped to magic-link + Resend

**Date:** 2026-05-21
**Decision:** F-Wave9-PORTAL-INVITE-MAGICLINK-01 closed. Customer-portal invite now lands recipients directly signed-in at /portal via a Kitstak-branded email — no Supabase-default password-set flow, no `noreply@mail.supabase.io` sender.
**Driven by:** Operator directive after Path B2 live-smoke surfaced the two follow-ups in [PR #90](https://github.com/kitstak/kitstak/pull/90) and STATUS.md:42-43.

## What changed

### Handler: `supabase/functions/crm-api/handlers/customers.ts`

`inviteCustomerToPortal` (POST `/customers/:id/invite-to-portal`) replaced the `auth.admin.inviteUserByEmail` call with `auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: 'https://www.kitstak.com/portal' } })`. The returned `data.properties.action_link` is embedded in a Kitstak-branded email body and queued through the existing `notifications` table (channel=`'email'`, `payload.to`=recipient). The 5-minute drain cron (Path B1) ships it via the Resend transport that delivered the 7 smoke emails on 2026-05-21.

Membership-side: `create_portal_membership` RPC call unchanged. Return envelope unchanged (`{ membership_id, user_id, email, customer_id }`).

Notification insert columns: `org_id`, `recipient_user_id` (the NEW portal user_id from generateLink, so the row is RLS-visible to the recipient once they sign in), `entity_type='customer'`, `entity_id=customer.id`, `channel='email'`, `subject`, `body`, `payload={ to, kind: 'portal_invite' }`, `created_by`/`updated_by=caller.userId` (audit trail of who clicked Invite).

### SPA defense-in-depth: `apps/web/src/auth/IndexRoute.tsx` + `App.tsx`

New `IndexRoute` component reads `useAuth` + `useMe` and routes the bare "/" path:
- unauthenticated → `/signin`
- `customer_user` role → `/portal`
- any other authenticated role → `/dashboard`

`App.tsx` swaps the static `<Navigate to="/dashboard" />` at "/" for `<IndexRoute />`. The MAGICLINK redirectTo already drops recipients at `/portal` directly, so this only matters for the edge case where a customer_user lands at the root (typed URL, bookmark, autocomplete). Without it, the customer would bounce through `/dashboard` → `ProtectedRoute` denies → `/signin`, a confusing loop.

### Tests

- `apps/web/test/regression/_helpers/supabase-mock.ts`: added `auth.admin.generateLink` to `makeSupabaseMock` plus `authAdminGenerateLinkCalls` / `authAdminGenerateLinkResult` on `MockState`. Legacy `inviteUserByEmail` retained for backwards compatibility (no other caller; will be pruned in a future cleanup).
- `apps/web/test/regression/crm-api-invite-portal.test.ts`: 6 tests now (was 5). Happy-path now asserts `generateLink` shape + that `inviteUserByEmail` is NOT called + that a notifications row with the action_link is inserted. `email_override` test extended to assert the override flows into `payload.to`. New 6th test asserts a `generateLink` auth error → 422 + no membership created.

## Verification

| Gate | Result |
|---|---|
| `pnpm test:contract` | 20/20 green |
| Regression suite (`vitest run --config vitest.regression.config.ts`) | 67 passed + 2 expected skips, including all 6 portal-invite tests |
| SPA src tests (`vitest run src`) | 37/37 green |
| Build (`vite build`) | green at 26s |
| `size-limit` main bundle | 30.21 kB / 40 kB (was 30.24 kB; IndexRoute is a tiny net change) |

## Constitutional invariants verified

| Invariant | Status |
|---|---|
| Forward-only migrations | None touched. The migration 0055 RPC continues to work unchanged. |
| RLS Pattern A on notifications + customers | `org_id = caller.orgId` filter on customer lookup; notifications row insert carries `org_id`. The recipient's `recipient_user_id` matches the new portal user, so the RLS select policy (`recipient_user_id = auth.uid()`) will let the customer see their own invite row from /portal if a future inbox UI ships. |
| Money helpers / cents wire | Untouched. |
| Idempotency | `respondWithIdempotency` wrapper unchanged. `generateLink` itself is safe under re-invocation: each call returns a fresh single-use token, the previous one becomes invalid (verified by Supabase docs + diagnostic in PR #90). |
| Audit log | Untouched. No new state machine. |
| Capabilities | `crm.customers.invite_to_portal` unchanged. |
| Zod canon (`_shared/types.ts` ↔ `apps/web/src/lib/types.ts`) | Untouched. `pnpm test:contract` 17 mirror pairs green. |
| Mirror parity | Untouched. |
| Branding rules | No em dashes / double hyphens / emojis in the email body or any user-facing string. Sender will render as `Kitstak <notifications@kitstak.com>` via the existing `RESEND_FROM` secret. |

## Operator action remaining

1. **Supabase Auth Site URL** (closes `F-Wave9-PORTAL-INVITE-REDIRECT-01`): set Site URL to `https://www.kitstak.com` and add `https://www.kitstak.com/**` to the Redirect URLs allow-list at https://supabase.com/dashboard/project/zmnvwhqjahwidprnjxrq/auth/url-configuration. Without this the magic links will still route through the raw Vercel deployment domain.
2. **Smoke test on prod** after PR merge + deploy: from a non-customer browser session, click Invite on a test customer with a fresh email address, confirm:
   - email arrives from `Kitstak <notifications@kitstak.com>` (not `noreply@mail.supabase.io`)
   - clicking the link lands signed-in at `/portal` with the customer_user role active
   - no password-set page is presented anywhere in the flow
3. **Path B3 (portal UI)** can now dispatch: with the invite chassis landing customers cleanly at `/portal`, the next slice is rendering real customer-portal-api data on the portal shell.

## Closes

- **`F-Wave9-PORTAL-INVITE-MAGICLINK-01`** — handler swapped to generateLink, branded email shipped via Resend, defense-in-depth IndexRoute added. Confirmed via 6 regression tests + green build + green size-limit.
- **`F-Wave9-PORTAL-INVITE-REDIRECT-01`** — operator closed the Supabase Auth Site URL configuration on the same day: Site URL set to `https://www.kitstak.com`, `https://www.kitstak.com/**` added to Redirect URLs allow-list (the 8 pre-existing Vercel-deployment-domain entries pruned for cleanup, leaving only the prod entry).

## Verified live (2026-05-21)

PR #91 merged at `f07343c` (18:43:13Z). deploy-functions workflow rolled both prod (18:44:24Z) and staging (18:45:46Z) `crm-api` bundles. Operator smoke from `/crm/customers/{Test Customer}` with `primary_email=Malunsf@gmail.com`:

| Check | Result |
|---|---|
| `Invite` click returned 200 + green success banner | Yes |
| Manual `gh workflow run notifications-drain.yml` returned `polled=2 delivered=2 failed=0` | Yes (the 2 = one stale row from an earlier test + the fresh invite) |
| Email arrived at Malunsf@gmail.com | Yes, ~10s after drain |
| Sender header rendered as `Kitstak <notifications@kitstak.com>` | Yes |
| Subject: `Sign in to your Test Customer portal` | Yes — customer.display_name interpolated correctly |
| Body: branded greeting + magic-link URL + "No password required." | Yes |
| Magic-link URL pointed at `<supabase-project>.supabase.co/auth/v1/verify?token=...&redirect_to=https://www.kitstak.com/portal` | Yes |
| Click landed signed-in at `/portal` (no password page) | Yes — portal shell rendered with Invoices / Quotes / Projects sections, honest "No X yet" empty states for the test customer |

## Quirk (documented, not a bug)

The verify URL carried `type=signup` rather than `type=magiclink`. This is Supabase's documented behavior for `generateLink({ type: 'magiclink' })` when the recipient's `auth.users` row does not yet exist (the magic-link call auto-creates the row on demand). For an existing user being re-invited, the same call returns a `type=magiclink` URL (consistent with the diagnostic captured in PR #90 against a pre-existing user). Both URLs hit the same `/auth/v1/verify` endpoint and produce an identical authenticated session; the type token only labels how the underlying user shadow was created. No code action needed.

## Carried open

- **`F-Wave9-SEND-FEEDBACK-01`** — Send button feedback on quote/invoice detail pages, surfaced during Path B1 verification. Still open.

## Spawns

None this PR. The work was bounded and self-contained.
