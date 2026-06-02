# WS-D review remediation. Authz and security hardening.

Wave: 10
Phase: Review remediation
Closes: F-Wave10-REVIEW-REMEDIATION (WS-D blocking review item)
Date: 2026-06-01

## Blocking review item

The WS-D implement step output was not registered as a committed artifact by the
orchestrator ("implement step did not commit"). This entry records the
verification that the implement step did land on disk and that every relevant
gate is green, and registers a committed remediation artifact for WS-D.

## Verification

The WS-D authz and security remediation implementation is present in commit
ef9901103e7c45fb3f7ccf5d25abd29bc63a2016 on branch wave10-review-remediation.
The working tree is clean against that commit and the byte-mirror capability
canon is identical across both sides.

Scope confirmed in that commit:

- D1. Added the saved_views capability triad (read, create, delete) to both
  sides of the byte-mirror capability canon and gated every collaboration-api
  saved-view handler via requireCap. Granted read plus create plus delete to
  org_owner, org_admin, sales, ops, accounting. Read-only for viewer. None for
  customer_user and vendor_user. The last unguarded state-changing saved-view
  handlers now enforce the capability invariant.
- D2. Added the internalError(logContext, rawErr) shared helper that logs the
  real error server-side and returns an opaque INTERNAL_ERROR 500. Swept every
  site that interpolated a raw error message into a 500 across the edge bundles,
  the route-dispatch catch arm, and the two scheduled workers. Error messages no
  longer leak internal detail to the wire.
- D3. Referenced F-Wave9-PORTAL-SIGNIN-RATE-LIMIT-01 in a code comment. Deferred
  by design.
- D4. Per-row webhook_url is validated (https plus WEBHOOK_ALLOWED_HOSTS
  allow-list) before fetch in the webhook sender. A reject is terminal and never
  falls back to the global WEBHOOK_URL. Closes the per-row SSRF surface.
- D5. Stripe redirect URLs are asserted https plus a .stripe.com host before
  window.location.assign in BillingPage.
- D6. Replaced the wildcard Access-Control-Allow-Origin with an ALLOWED_ORIGINS
  allow-list echo. Server-only workers emit the non-browser empty origin.
- D7. Replaced the auth-api listUsers filter-string interpolation with a
  parameterised profiles lookup plus admin.getUserById in the portal sign-in and
  password-reset flows. Constant-shape anti-enumeration responses preserved.
- D8. Extracted the Stripe price-id to plan map to _shared/stripe-plans.ts,
  imported by both stripe-webhook and billing-api, with a parity test asserting
  the forward and reverse maps are exact inverses.

Regression coverage confirmed:

- test/regression/auth-api-portal-signin-link.test.ts. Parameterised lookup,
  anti-leak canonical 200 on generateLink internal error, no notifications row.
- test/regression/auth-api-request-password-reset.test.ts. Same anti-leak
  guarantees on the password-reset path.
- test/contract/stripe-plans.parity.test.ts. Forward and reverse map inverse
  parity for the extracted Stripe plan map.

## Gates run

- pnpm typecheck. Pass.
- pnpm test:contract. Pass. 3 files, 26 tests. Includes money.parity, the full
  capability and types parity suite, and the new stripe-plans inverse-map
  parity.
- pnpm --filter web test (full unit suite). Pass. 66 files, 686 tests.
- WS-D regression suites. Pass. 2 files, 11 tests
  (auth-api-portal-signin-link plus auth-api-request-password-reset).

## Constitutional alignment

- Capabilities. requireCap on every state-changing saved-view handler. 403
  FORBIDDEN when denied. The capability canon stays byte-identical across
  apps/web/src/lib/capabilities.ts and
  supabase/functions/_shared/capabilities.ts. SPA mirrors the role policy for
  button hiding only. Server is authority.
- RLS unchanged. Cross-tenant reads still return 200 plus empty. No 403 where a
  404 is the constitutional answer.
- Error messages do not leak sensitive data. internalError returns an opaque
  INTERNAL_ERROR and logs detail server-side only.
- Input validation at the boundary. Per-row webhook_url and Stripe redirect URL
  are validated before use. SSRF and open-redirect surfaces closed.
- No new top-level dependency. crypto.randomUUID() only. No refused imports
  added.

## Outcome

WS-D is verified committed and green. No further code change required for the
blocking item. This entry is the registered remediation artifact.
