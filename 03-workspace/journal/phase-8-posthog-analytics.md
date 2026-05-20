# Phase 8: PostHog analytics wiring (F-Wave5-CO-02)

Closes F-Wave5-CO-02, the long-standing operator-gated carry that was
waiting on an analytics-provider pick.

Baseline: `549f148` (PR #57, Phase 8 SPA: drag-and-drop phase reorder).

## Motivation

The Phase 8 follow-up batch surfaced one operator-gated carry that
required a single decision plus a chassis: which analytics provider to
wire in. The operator picked PostHog over Segment / Mixpanel for three
reasons:

1. **Cost.** PostHog Cloud's free tier covers 1M events per month;
   neither Segment nor Mixpanel comes close at the price point Kitstak
   needs to maintain at zero-customer through ten-customer scale.
2. **Session replay.** PostHog ships session recording in the same SDK
   as the events product. The operator wants to watch first-customer
   sessions debug-style without standing up a separate Hotjar / FullStory
   subscription.
3. **Feature flags.** PostHog's feature-flag product is in the same SDK.
   That gives a near-term path to layer PostHog flags on top of the
   existing server-authoritative `useOrgFlags()` pattern for gradual
   rollouts and A/B tests, without adding LaunchDarkly to the dependency
   list.

The analytics surface is the chassis the operator needs before any of
those three capabilities are useful. This filing ships the chassis only;
the feature-flag layering is filed as `F-Wave8-POSTHOG-FEATURE-FLAGS-01`.

## Lazy-load decision and bundle delta

PostHog's full SDK is approximately 30 kB gzipped. The pre-PostHog main
bundle was 29.79 kB / 40 kB, so a top-level import would have pushed the
main chunk above the constitutional cap.

`apps/web/src/lib/analytics.ts` dynamic-imports `posthog-js` inside the
`initAnalytics` function body. `vite.config.ts` gains a
`manualChunks.posthog: ['posthog-js']` entry so the lazy chunk has a
recognisable name in `dist/assets/` and so Vite preserves the chunk
across builds where `VITE_POSTHOG_KEY` is set at compile time.

**Verified bundle posture:**

- Build without `VITE_POSTHOG_KEY`: main `index-*.js` lands at 29.94 kB
  gzipped (was 29.79; +0.15 kB delta from the analytics wrapper). No
  `posthog-*.js` chunk emitted; the entire posthog-js dependency is
  tree-shaken because the `if (import.meta.env.VITE_POSTHOG_KEY)` guard
  in `main.tsx` becomes `if (undefined)` after Vite's define plugin
  substitutes the value.
- Build with `VITE_POSTHOG_KEY=phc_test_dummy`: main `index-*.js` lands
  at 30.27 kB gzipped; `posthog-Bmg4LlCH.js` sits in its own chunk at
  194.25 kB raw / 64.72 kB gzipped. Main chunk is still under cap.

`size-limit` cap (40 kB on `dist/assets/index-*.js` gzipped) holds in
both build modes.

## The 5 funnel events and why each

The event surface is intentionally bounded to exactly 5 funnel events
covering the operator's revenue-validation signal: quote-to-cash. New
events go through `F-Wave8-POSTHOG-FUNNEL-EXPANSION-01` once the first
five accumulate signal, not preemptively.

1. **`signed_in`** fired in `AuthContext.signIn` on a successful
   `supabase.auth.signInWithPassword`. Property: `method`. This anchors
   every other event to a user session.
2. **`quote_sent`** fired in `useSendQuote.onSuccess` after the send
   mutation lands. Properties: `quote_id`, `customer_id`,
   `total_cents_bucket`. This is the first revenue-intent signal in the
   funnel.
3. **`project_converted`** fired in `useConvertQuoteToProject.onSuccess`.
   Properties: `source_quote_id`, `project_id`. Conversion is the gate
   between sales intent and operational work; absolute amount is not
   tracked here because the dollar value already rode the upstream
   `quote_sent` event.
4. **`invoice_sent`** fired in `useSendInvoice.onSuccess`. Properties:
   `invoice_id`, `customer_id`, `total_cents_bucket`. Invoice issuance
   is the second revenue-intent signal.
5. **`payment_received`** fired in `useCreatePayment.onSuccess`.
   Properties: `payment_id`, `invoice_id` (always `null` at this stage
   because a payment can be received as unapplied cash and allocated
   later via `useApplyPayment`), `customer_id`, `amount_cents_bucket`.
   This is the funnel's closing event.

Stage two of `payment_received` (the `useApplyPayment` allocation step)
is intentionally not instrumented in this filing. The current event
already fires when cash hits the system; the allocation step is an
internal accounting move with multiple invoice ids per call and would
need a different event shape. If the operator wants per-invoice
allocation visibility later, that is a follow-up.

## PII posture

Every property type and value below is the actual contract that ships
in this filing. No surprises later.

- **Identifier.** `identifyUser(user.id)` passes only the opaque
  Supabase `user.id` UUID. Never email, never name, never phone.
  PostHog needs the id; PII is unnecessary for session stitching.
- **Amount bucketing.** Monetary values go through `bucketCents` before
  they leave the SPA. Bucket boundaries (`under_1k`, `1k_to_10k`,
  `10k_to_100k`, `over_100k`) live as named cent constants in
  `analytics.ts` so the conversion is auditable in one place. Raw cents
  values never reach a `posthog.capture` call.
- **Property-value type.** `AnalyticsPropValue` is
  `string | number | boolean | null`. Nested objects are not permitted
  by the type, so a careless call site cannot accidentally pass a full
  customer record or a line-item array.
- **Session recording.** `session_recording.maskAllInputs: true` is
  passed to `posthog.init`. Sign-in forms, customer contact entry,
  and money fields never replay raw keystrokes. The recording captures
  DOM structure and click targets only.
- **Autocapture.** Enabled (the default) because the operator wants the
  navigation telemetry without manually instrumenting every page. The
  same `maskAllInputs` setting governs the autocapture click stream.
- **Pageview capture.** Enabled. URL paths are not PII for this app.

## Env var contract

Two env vars, both optional. Both documented in `apps/web/.env.example`
with placeholder values and a one-line comment each.

- **`VITE_POSTHOG_KEY`**. PostHog public project key. Frontend-safe
  (PostHog public keys are designed for client-side use). Absent in dev
  and staging without analytics; the SPA stays in no-op posture
  (no network calls, no warnings, no console noise).
- **`VITE_POSTHOG_HOST`**. PostHog API host. Defaults to
  `https://us.i.posthog.com` (PostHog Cloud US) when unset. Operator can
  override to `https://eu.i.posthog.com` (PostHog Cloud EU) or to a
  self-hosted domain by setting the env var explicitly.

Both vars are declared in `apps/web/src/vite-env.d.ts` as optional
strings so TypeScript reflects the runtime contract.

## No-op posture

`initAnalytics` returns a resolved promise immediately when
`VITE_POSTHOG_KEY` is absent; the `posthog-js` dynamic import never
runs in that case. The module-private `posthog` handle stays `null`, so
`identifyUser`, `resetAnalytics`, and `track` all short-circuit. Dev
workstations and staging deployments without analytics produce zero
network calls and zero log output from the analytics module.

If `import('posthog-js')` itself fails (offline, blocked, CDN failure)
the `.catch` handler resets `posthog` to `null` and the SPA stays
functional. Analytics is observational; it never blocks the UI.

## Init wiring is fire-and-forget

`main.tsx` calls `void initAnalytics()` after `ReactDOM.createRoot.render`
returns. The init promise is not awaited from any UI-blocking path. The
React tree mounts first; analytics catches up in the background. A slow
PostHog init (or a fully failing init) never delays the sign-in screen.

## Auth integration shape

`AuthContext.signIn` calls `identifyUser(data.user.id)` and then
`track('signed_in', { method: 'password' })` on a successful auth.
`AuthContext.signOut` calls `resetAnalytics()` so the next sign-in on
the same browser starts a fresh distinct_id.

`AuthContext` also calls `identifyUser` on the cold-mount session
recovery path (when `supabase.auth.getSession` returns a session that
was persisted in `localStorage`). This re-stitches the analytics session
to the right user on page reload. The `signed_in` event is NOT fired on
the recovery path; that event represents the explicit auth action, not
a session resume.

## Operator next steps

1. Create a PostHog project in the operator's preferred region (US by
   default, EU available).
2. Copy the public project key from PostHog's project settings.
3. Set `VITE_POSTHOG_KEY` in the Vercel project's environment variables
   (Production, Preview, and Development scopes as appropriate).
4. Set `VITE_POSTHOG_HOST` only if overriding the US-Cloud default.
5. Redeploy. Verify events arrive in PostHog's live event view by
   signing in and walking the quote-to-cash chain.

## Follow-ups filed

- `F-Wave8-POSTHOG-FEATURE-FLAGS-01`. Wire PostHog feature flags into
  the existing `useOrgFlags()` pattern. Server-side flags stay
  authoritative; PostHog flags layer in for gradual rollouts and A/B
  tests. Lazy-load via the same dynamic-import pattern used by the
  analytics module so the main chunk stays under cap.
- `F-Wave8-POSTHOG-FUNNEL-EXPANSION-01`. Once the 5 funnel events
  accumulate enough data to be readable, expand the event set based
  on what the operator wants to learn. Bounded by operator priorities,
  not preemptive guesswork.

## Files touched

- `apps/web/package.json` plus `pnpm-lock.yaml`: `posthog-js@^1.374.2`.
- `apps/web/src/lib/analytics.ts`: new. Typed wrapper.
- `apps/web/src/main.tsx`: `void initAnalytics()` after mount.
- `apps/web/src/auth/AuthContext.tsx`: `identifyUser` plus `signed_in`
  on sign-in; `resetAnalytics` on sign-out; `identifyUser` on session
  recovery.
- `apps/web/src/lib/hooks/useQuotes.ts`: `useSendQuote` fires
  `quote_sent`; `useConvertQuoteToProject` fires `project_converted`.
- `apps/web/src/lib/hooks/useInvoices.ts`: `useSendInvoice` fires
  `invoice_sent`.
- `apps/web/src/lib/hooks/usePayments.ts`: `useCreatePayment` fires
  `payment_received`.
- `apps/web/src/vite-env.d.ts`: two optional env-var declarations.
- `apps/web/.env.example`: new. Documents all four `VITE_` env vars
  (Supabase URL plus anon key plus app env plus app URL plus the two
  PostHog vars) with placeholder values and one-line comments.
- `apps/web/vite.config.ts`: `manualChunks.posthog: ['posthog-js']`.
- `STATUS.md`: F-Wave5-CO-02 moved from operator-gated to closed;
  two follow-ups filed; bundle size line updated; last-updated stamp
  bumped.

## Activation (2026-05-20)

Operator activated PostHog. Closes `F-Wave8-POSTHOG-PROJECT-SETUP-01`.

### What was done

1. PostHog project created on US Cloud. Project ID `433097`. Dashboard
   at `https://us.posthog.com/project/433097`. Renamed from
   "Default project" to `KitStak v.01` inside PostHog.
2. Project Token (`phc_...`) copied from PostHog Project Settings
   (the public, frontend-safe token; not the Personal API key or
   Feature Flags secure key).
3. `VITE_POSTHOG_KEY` set in the Vercel project's Environment
   Variables for **Production + Preview** scopes. Development scope
   intentionally left unset so local `pnpm dev` stays in the
   build-time-tree-shaken no-op posture documented in
   `apps/web/.env.example`.
4. `VITE_POSTHOG_HOST` not set. Project is on US Cloud and
   `analytics.ts` already defaults to `https://us.i.posthog.com`.
5. Vercel triggered a fresh production build (env vars are Vite
   build-time, so a redeploy was required for the key to land in
   the bundle). New build includes the named `posthog-<hash>.js`
   chunk per the `manualChunks.posthog` config; SPA index chunk
   unchanged at 29.94 kB / 40 kB.

### Verification

First events landed in PostHog's Activity view within ~30 seconds
of the deploy completing:

- `signed_in` event from `https://www.kitstak.com/signin`. This is
  the explicit funnel event fired from `AuthContext.signIn` on a
  successful auth; its presence confirms both the SDK is loaded
  and the named-event wiring works end-to-end.
- Autocapture event `clicked button with text "Sign out"` from
  `https://www.kitstak.com/dashboard`. Confirms autocapture is on
  (which it is by default in `initAnalytics`).
- Library reported as `web` on both events: confirms the source
  is `posthog-js` (SPA SDK), not a server-side library.
- Two distinct distinct_ids visible across the anonymous →
  identified flow, confirming that `identifyUser` re-keys the
  session on the explicit sign-in path as designed.

PII posture verified in-band: no email, name, phone, or address
visible on any event property; identifier is the opaque Supabase
user UUID; session recording masks all inputs per
`session_recording.maskAllInputs: true`.

### Follow-ups unblocked

- `F-Wave8-POSTHOG-FEATURE-FLAGS-01`: the project now exists to
  host flags. The feature-flag SDK can be lazy-loaded via the same
  dynamic-import pattern as the analytics module.
- `F-Wave8-POSTHOG-FUNNEL-EXPANSION-01`: actionable once enough
  data accumulates across the 5 named events to be readable.
  Bounded by operator priorities, not preemptive guesswork.

### Wizard not used

The PostHog AI install wizard (`npx @posthog/wizard@latest`) was
not used. The wizard auto-detected the parent directory as a
Node.js project (it does not understand the Vite + React SPA in
`apps/web/`), and the SDK is already wired by PR #58. Running the
wizard would have created a duplicate / conflicting init and
written outside the worktree. Activation was env-var-only.
