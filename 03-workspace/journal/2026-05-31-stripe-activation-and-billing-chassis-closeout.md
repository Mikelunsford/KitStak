# 2026-05-31 Stripe activation and billing chassis closeout

**Risks closed:** D-CSP-01, D-DEP-01, D-IDEMP-01, D-IDEMP-02, F-Wave10-STRIPE-SCHEMA-01, F-Wave9-COWORK-SMOKE-07, F-Wave9-COWORK-SMOKE-08, plus the Phase 1.2 prod secret activation.
**Follow-ups filed:** F-Wave10-STRIPE-CHECKOUT-SMOKE-01 (live round-trip, operator-gated on Stripe account review).
**Wave shape:** Twelve PRs (#164 to #175) merged 2026-05-27, then the live Stripe secret activation on prod 2026-05-31. This journal documents both because #164 to #175 shipped after the #163 closeout and were not yet recorded.
**Baseline:** `4436883 -> 4ef8011 on main`.

## Source

Two distinct work streams reconciled here:

1. The hardening and billing-chassis PRs #164 to #175, merged 2026-05-27 after the prior day-closeout (#163). These were code-complete and on main but undocumented.
2. The Phase 1.2 production secret activation on 2026-05-31: setting `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as Edge Function secrets on the prod Supabase project so the billing chassis stops failing closed and begins answering live.

## What shipped

### PR #164 - HSTS and CSP at the edge (D-CSP-01)

Added a full security-header block to `vercel.json` for all routes: HSTS (`max-age=31536000; includeSubDomains; preload`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` locking camera, microphone, and geolocation, and a Content-Security-Policy. The CSP allowlists exactly what the SPA needs: `js.stripe.com` for scripts, the prod Supabase origin for `connect-src` (https and wss), Sentry ingest, PostHog ingest and assets, the Stripe API, Stripe frames for checkout and the billing portal, and `form-action` scoped to self plus Stripe checkout and billing. `object-src 'none'`, `base-uri 'self'`. Closes the D-CSP-01 design-review gap.

### PR #165 - Extend banned-imports (D-DEP-01)

Extended the ESLint `no-restricted-imports` rule in `apps/web/eslint.config.js` so every architecture lock-in refusal named in the constitution is now machine-enforced, not just documented. Adding any refused dependency now trips the linter and forces a constitution review.

### PR #166 - Idempotency-Key on POST /pdf/render (D-IDEMP-01)

Brought the PDF render endpoint under the non-GET idempotency rule. The handler now requires, validates, hashes, and stores the `Idempotency-Key` header, with the body hashed via RFC 8785 canonical JSON so a repeated key with a different body returns `409 IDEMPOTENCY_CONFLICT`.

### PR #167 - Idempotency-Key on POST /orgs/impersonate stub (D-IDEMP-02)

Same idempotency enforcement applied to the impersonation stub endpoint, closing the second of the two idempotency design-review gaps.

### PR #168 - organizations subscription state schema (migration 0071)

Forward-only migration `0071_organizations_subscription.sql` (Wave: Stripe wiring, Phase 10, closes F-Wave10-STRIPE-SCHEMA-01). Adds subscription state to `organizations`: `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` (not null, default `trialing`), `subscription_plan`, `trial_ends_at` (not null, default now plus 14 days), and `subscription_current_period_end`. Partial unique indexes on the two Stripe IDs allow many nulls for unprovisioned orgs. A CHECK constraint pins `subscription_status` to the allowed set via the drop-then-add idempotent pattern. Adds a service-role-only `stripe_webhook_events` table (no authenticated policy). Subscription status changes ride the existing audit helper through a new AFTER UPDATE trigger, reusing the per-org advisory lock and prev_hash chain. All DDL idempotent. No `_cents` columns: org-level subscription state defers monetary accounting to the invoices and payments tables.

### PR #169 - org.billing.read and org.billing.manage caps

Added the two billing capabilities to both capability sources in lockstep: `apps/web/src/lib/capabilities.ts` and `supabase/functions/_shared/capabilities.ts`. Keeps the SPA mirror and the server authority byte-aligned.

### PR #170 - stripe-webhook edge bundle

New `supabase/functions/stripe-webhook/index.ts` (verify_jwt false, HMAC verification via `constructEventAsync`). Maps the 6 live Price IDs back to plan and cadence (PRICE_TO_PLAN) and writes `subscription_*` state onto the org row. `config.toml` declares the function with JWT verification off so Stripe can reach it; `deploy-functions.yml` deploys it. Backed by a regression suite (`edge-stripe-webhook.test.ts`) with a Stripe stub and Supabase mock. Fails closed without `STRIPE_WEBHOOK_SECRET`.

### PR #171 - billing-api edge bundle

New `supabase/functions/billing-api/index.ts` (verify_jwt true) for creating Stripe checkout sessions and billing-portal sessions. Carries the PLAN_TO_PRICE map (the same 6 Price IDs as the webhook, no drift). Backed by `edge-billing-api.test.ts` regression coverage. Fails closed without `STRIPE_SECRET_KEY`.

### PR #172 - SPA /admin/billing page, subscription gate, trial banner

The operator-facing billing surface: `BillingPage.tsx` under `/admin/billing` (lazy route), a `useSubscriptionGate` hook with helpers and tests, a `TrialBanner` in the shell, `billingService` and `billingPlans` services, a billing query-key namespace, and pure `billingFormatters` with tests. Sidebar and routes wired. The gate hides UI client-side only; the server remains the authority.

### PR #173 - members admin Name column (SMOKE-08)

Fixed the members admin so the Name column shows the member name rather than the org name. Closes Cowork smoke finding SMOKE-08.

### PR #174 - hard error on NO_ACTIVE_ORG (SMOKE-03)

A user in the NO_ACTIVE_ORG state now hits a hard, explicit error instead of a silent empty dashboard. Closes SMOKE-03 and removes the silent-failure path surfaced in the Cowork smoke.

### PR #175 - invoice stepper aligned with audit_log (SMOKE-07)

Aligned the invoice stepper state transitions with the full audit_log path so invoice state changes write through the audit chain rather than bypassing it. Closes SMOKE-07.

### Phase 1.2 - production Stripe secret activation (2026-05-31)

Set `STRIPE_SECRET_KEY` (sk_live_) and `STRIPE_WEBHOOK_SECRET` (whsec_) as Edge Function secrets on the prod Supabase project `zmnvwhqjahwidprnjxrq`. Both digests confirmed via `supabase secrets list`. Secrets were set with `supabase secrets set --env-file` so values never entered the transcript; the temp env file was deleted afterward. Verified at the API level:

- The sk_live_ key authenticates against the Stripe API.
- All 6 hardcoded Price IDs (PLAN_TO_PRICE in billing-api, PRICE_TO_PLAN in stripe-webhook) are active, livemode true, USD. Amounts: starter 800 and 8,160 per year, pro 1,800 and 18,360 per year, enterprise 3,500 and 35,700 per year. Annual equals monthly times 12 times 0.85 for all three tiers.
- Mode consistency confirmed: sk_live_ key and livemode prices align, no test/live mismatch.
- Webhook endpoint is Active in Stripe, pointed at the prod stripe-webhook function URL.

Open caveat: the Stripe account showed "Review in progress" on 2026-05-31. Live charge capture and payouts may be gated until the review clears. The wiring is verified at the API level, but the live checkout round-trip (real card, then checkout.session.completed, then the webhook writes subscription_* onto the org row) has not been run and may be blocked by the review. Tracked as F-Wave10-STRIPE-CHECKOUT-SMOKE-01, operator-gated.

## STATUS.md update

Brought current through #175: latest migration 0071, Stripe billing chassis present and API-verified on prod, Cowork P2 and P3 findings SMOKE-03, SMOKE-07, and SMOKE-08 closed, design-review gaps D-CSP-01, D-DEP-01, D-IDEMP-01, and D-IDEMP-02 closed.

## Constitutional invariants verified across the wave

- **Money rules:** No new monetary columns introduced. Migration 0071 deliberately keeps subscription state free of `_cents` columns and defers revenue accounting to the invoices and payments tables. Stripe amounts are read from Stripe, not restored locally.
- **RLS:** New `organizations` columns inherit the existing row policy from migration 0001. The new `stripe_webhook_events` table is service-role-only with no authenticated policy. No change to the 200 plus empty, 404, 404, 403 posture.
- **Migrations:** Forward-only. 0071 is four-digit, snake_case, idempotent DDL, with a full header declaring Wave, Phase, Closes, DOWN MIGRATION, date, and constitutional alignment.
- **Audit log:** Subscription status changes ride the existing audit helper through a new AFTER UPDATE trigger, reusing the per-org advisory lock and prev_hash chain. No best-effort handler writes. SMOKE-07 brought invoice transitions back onto the full audit path.
- **Idempotency:** D-IDEMP-01 and D-IDEMP-02 brought POST /pdf/render and POST /orgs/impersonate under the Idempotency-Key rule with RFC 8785 body hashing and 409 on conflict.
- **Capabilities:** org.billing.read and org.billing.manage added to both capability sources in lockstep. SPA mirror stays advisory; server is authority.
- **Zod canon byte-mirror parity:** No type-shape edits in this wave; contract parity unaffected.
- **Banned deps:** D-DEP-01 strengthened the ESLint enforcement of the refusal list. Stripe is loaded via js.stripe.com (CSP-allowlisted) and the Deno Stripe import in the edge functions; no refused dependency added to the SPA bundle.
- **Brand voice:** Security headers, schema, and SPA copy reviewed; no em-dashes, double hyphens, or emojis in user-facing copy.

## Process notes

- Live secrets were set without ever entering the transcript: masked discovery of the operator's local secret file, label-targeted extraction into a temp env file, `supabase secrets set --env-file`, then temp deletion. Price-ID verification read the key into a variable used only as an Authorization header, never printed, then nulled.
- Activation is verified at the API level but not charge-proven. Before claiming billing works end to end, the live checkout smoke must run once the Stripe account review clears.

## Open after this wave

- F-Wave10-STRIPE-CHECKOUT-SMOKE-01: live checkout round-trip with a real card, operator-gated on the Stripe account review.
- F-Wave9-AUDIT-CHAIN-SAME-TXN-01: audit chain within a single transaction.
- F-Wave9-SALES-CONFIG-3PL-GATE-01: sales config gating on the 3PL bundle.
- F-Wave9-COWORK-SMOKE-09: PILLARS hardcoded to 3.

## Recommended next dispatch

Run the live checkout smoke once Stripe clears the account review (operator action, real card). In parallel, the remaining Cowork follow-up F-Wave9-COWORK-SMOKE-09 and the two audit and sales-config follow-ups are independent and safe to dispatch.
