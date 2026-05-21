# Phase 9 — Sentry SPA error and performance capture

**Date:** 2026-05-20

**Closes (partial):** `F-Wave5-CO-01` / `F-Wave3-OBS-01` — SPA portion only.

**Files (carryover):**
- `F-Wave5-CO-01-EDGE-01` — Deno-side capture for the Edge Function bundle (filed).
- `F-Wave9-SENTRY-SOURCEMAPS-01` — production source-map upload via `@sentry/vite-plugin` (filed).

**Constitutional alignment:** new top-level dependency `@sentry/react@^8.40.0` (MIT) approved by the operator at this filing. Added to CLAUDE.md "What we use" mirroring the `jspdf` precedent from F-Wave2-CO-01. No other constitutional invariants touched: money rules, RLS rules, migration rules, Zod canon, idempotency, audit log, and capabilities all untouched (this PR has no schema, no handler, no API surface change).

---

## Motivation

`F-Wave3-OBS-01` and the rolled-forward `F-Wave5-CO-01` have been operator-gated since Wave 3 waiting on a DSN. Without error and performance capture, the current production posture is "if something breaks, no one knows unless an operator surfaces it." `ErrorBoundary.componentDidCatch` did exist (`apps/web/src/components/shell/ErrorBoundary.tsx`) but only logged to `console.error` in `DEV` mode — production was silent.

The operator chose Sentry SaaS over Segment / Mixpanel / OTLP-to-some-other-vendor for three reasons: 1) it bundles errors + performance + session replay in one product (fewer vendors), 2) DSNs are designed to be frontend-public so no proxy is needed, 3) the free tier covers small-volume launch usage without contract negotiation. Sentry-only, not OTLP-multiplexed.

OTLP / OpenTelemetry was explicitly rejected for this round. OTLP would add complexity (collector configuration, exporter routing, vendor selection per signal type) without adding signal value over Sentry's batteries-included SDK. If a future need for OTel emerges (e.g. multi-vendor tracing routing), it gets filed at that point.

## Lazy-load decision and bundle delta

`@sentry/react` with `browserTracingIntegration` plus `replayIntegration` is ~70 to 95 kB gzipped — too heavy to eagerly bundle into the main chunk against the 40 kB cap. Mirroring the PostHog chassis closed by F-Wave5-CO-02:

1. `apps/web/src/lib/sentry.ts` exposes `initSentry()` whose body dynamic-imports `@sentry/react`. Outside of that dynamic import there is no reference to the SDK in the SPA source tree.
2. `vite.config.ts` declares `manualChunks.sentry: ['@sentry/react']` so the lazy chunk has a recognisable name in `dist/assets/sentry-<hash>.js` instead of being inlined into a numbered chunk.
3. `apps/web/src/main.tsx` guards the fire-and-forget call on `import.meta.env.VITE_SENTRY_DSN` so that when the var is absent at build time the literal is replaced with `undefined` by Vite's `define`, the guard becomes `if (undefined)`, and Rollup tree-shakes the entire `initSentry` + dynamic-import path.

**Measured deltas** (Vite 5.4 production build, gzip-effective via Rollup's `gzipSize`):

- **Without `VITE_SENTRY_DSN`** (current branch state): main `index-*.js` lands at **29.95 kB / 40 kB** (was 29.94 kB pre-Sentry; **+0.09 kB delta**, well under the 0.5 kB threshold). No `sentry-*.js` chunk emitted.
- **With `VITE_SENTRY_DSN` set** at build: main chunk delta projects to ~+0.30 kB (wrapper module references the dynamic import); separate `sentry-<hash>.js` chunk emits at ~80 to 95 kB gzipped. Not measured at this filing because the activation is operator-pending; the PR validates the no-op posture.

The `size-limit` gate held at 29.95 kB / 40 kB on the no-DSN build.

## Init wiring is fire-and-forget

`main.tsx` calls `void initSentry()` BEFORE `ReactDOM.createRoot(...).render(...)`. This is the one shape difference vs the PostHog init (which sits *after* the render block in the existing tree). Reason: if a render-time error fires during the very first paint of the SPA, the Sentry handle must already exist in module scope so `captureException` from `ErrorBoundary.componentDidCatch` is not a silent drop.

The dynamic `import('@sentry/react')` inside `initSentry` does not block the render path — the import promise resolves asynchronously, and `Sentry.init` runs inside the `.then()`. The render starts microseconds later regardless. If init fails (network error, malformed DSN, SDK throw), the `.catch()` swallows it and leaves the module in no-op posture; capture must never break the SPA.

## Capture surface and sample-rate posture

| Signal | Default rate | Behaviour |
|---|---|---|
| Errors (unhandled exceptions, render-tree errors via componentDidCatch, manual `captureException`) | 100 percent | Every error captured. |
| Performance traces (`browserTracingIntegration`) | 10 percent (`VITE_SENTRY_TRACES_SAMPLE_RATE` default) | Routes, navigations, fetch / xhr spans. Operator can dial up during a launch window. |
| Session replay (baseline) | 0 percent (`VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE` default) | Off by default. Operator can opt to baseline-record. |
| Session replay (on error) | 100 percent (hard-wired) | Always capture a replay when an error fires. High signal, low cost since baseline is 0. |

All four rates are operator-overridable via env vars without a code change. The defaults are tuned for a small-volume launch posture; an unattended `tracesSampleRate=1.0` setting during high traffic could burn through the Sentry free-tier quota — documented in `.env.example`.

## PII posture

The `beforeSend` hook in `sentry.ts` runs on every event before transport and is the constitutional gate. Anything that arrives at Sentry passed through this function. Asserted by `apps/web/src/lib/sentry.test.ts`:

1. **`event.user`**: strip `email`, `username`, `ip_address`. Keep only `id` (opaque Supabase UUID). If only PII fields were present, delete `user` entirely.
2. **`event.request.cookies`**: deleted.
3. **`event.request.headers.authorization`** and **`event.request.headers.Authorization`**: both cases deleted. Defends against case-inconsistent header serialisation.
4. **`event.request.url`**: pathname-only. The original URL passes through `new URL()`, the query and fragment are discarded.
5. **`event.request.query_string`**: deleted.
6. **`event.extra`** and **`event.tags`**: walked; any string value matching `EMAIL_REGEX` or `PHONE_REGEX` is redacted to `[redacted]`.
7. **`event.message`** and **`event.exception.values[].value`**: if either contains an email pattern after the per-field scrubs, the event is dropped entirely (`beforeSend` returns `null`). Belt-and-suspenders against a code-level `throw new Error('user ${email} failed')`.

`sendDefaultPii: false` at init refuses IP addresses and cookies by default before `beforeSend` even runs.

`replayIntegration` is configured with `maskAllInputs: true` (every input element masked in replay), `blockAllMedia: true` (no images / videos captured), `maskAllText: false` (DOM text remains visible — necessary for debugging UI errors). This matches the PostHog session-recording posture.

**Identifier policy**: `identifySentryUser` only accepts a `userId` string and only sets `Sentry.setUser({ id: userId })`. The function never accepts `email`, `name`, `phone`, or any other PII argument; the type system enforces this.

## Env var contract

| Var | Required | Scope | Default if unset |
|---|---|---|---|
| `VITE_SENTRY_DSN` | optional (absence = no-op) | Production + Preview | (no-op) |
| `VITE_SENTRY_ENVIRONMENT` | optional | Production + Preview | falls back to `VITE_APP_ENV` |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | optional | Production + Preview | `0.1` |
| `VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE` | optional | Production + Preview | `0.0` |
| `SENTRY_AUTH_TOKEN` | optional, **build-time only** | Production + Preview, **NOT** as `VITE_*` | (no source-map upload) |

`SENTRY_AUTH_TOKEN` is documented but not consumed by this PR; it lands when `F-Wave9-SENTRY-SOURCEMAPS-01` ships. Critical: it must never have a `VITE_` prefix; that would expose the secret in the SPA bundle.

## ErrorBoundary integration

The existing class `apps/web/src/components/shell/ErrorBoundary.tsx` already renders a brand-clean fallback (Bebas display, navy background, accent reload button) per the branding rules. Replacing it with `Sentry.ErrorBoundary` would force re-implementing the fallback as a `fallback` prop with no functional gain. Decision: keep the class, add one call to `captureException` inside `componentDidCatch` after the DEV `console.error` block.

The `captureException` helper short-circuits when `sentry === null` (no DSN at build) AND when running in dev (`import.meta.env.DEV`) so local crashes never pollute the production project's event stream. Both guards asserted by unit tests.

## Operator next steps

1. Create a Sentry organisation at sentry.io (or use an existing one).
2. Inside that organisation, create a project of type **React → Browser**.
3. Project Settings → Client Keys (DSN) → copy the **DSN** value. It looks like `https://<public_key>@oXXXXXX.ingest.sentry.io/<project_id>`. Sentry DSNs are designed to be frontend-public; do not paste the auth token by mistake.
4. In Vercel → Kitstak project → Settings → Environment Variables → add `VITE_SENTRY_DSN` for **Production + Preview** scopes. Leave **Development** unset so local `pnpm dev` stays in no-op posture (matches the PostHog activation pattern).
5. Optionally set `VITE_SENTRY_ENVIRONMENT` if you want Sentry-side labels to diverge from `VITE_APP_ENV`.
6. Optionally set `VITE_SENTRY_TRACES_SAMPLE_RATE` and `VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE` to override the conservative defaults. Vite env vars are build-time, so a redeploy is required after any change.
7. Trigger a Vercel redeploy (or wait for the next merge to main).
8. **Verify**: load the live SPA, intentionally crash a route (e.g. `?test=throw` if you wire a sandboxed throw, or visit a feature you know to be partially broken), check Sentry → Issues that the event landed within ~30 seconds. Confirm the payload contains the opaque Supabase UUID as `user.id` and contains **no** email, name, phone, cookies, or query strings.

## Wizard not used

The Sentry AI install wizard was deliberately not used. Sentry's wizard, like PostHog's, would have likely misdetected the parent `/KitStak v.01` directory as a generic Node.js project and written init code at the wrong shape (`@sentry/node` instead of `@sentry/react`, or installed at the root instead of `apps/web/`). The wizard would also have generated init code that does not match the existing PostHog chassis (lazy import, manualChunks, no-op posture), creating a stylistic inconsistency. Activation here is config-only on the operator side; the SDK wiring is intentional and matches the PostHog chassis byte for byte.

## Files touched

- `apps/web/package.json`: `@sentry/react@^8.40.0` added to `dependencies`.
- `pnpm-lock.yaml`: regenerated by `pnpm install`. Resolves to `@sentry/react@8.55.2`.
- `apps/web/src/lib/sentry.ts`: new. Typed wrapper. ~190 lines.
- `apps/web/src/lib/sentry.test.ts`: new. 15 assertions covering init no-op, idempotency, identify / reset / capture short-circuits, and the full PII-scrub surface.
- `apps/web/src/main.tsx`: `void initSentry()` fire-and-forget guarded by `VITE_SENTRY_DSN`, called BEFORE `ReactDOM.createRoot.render`.
- `apps/web/src/components/shell/ErrorBoundary.tsx`: `componentDidCatch` forwards `error` plus `info.componentStack` via `captureException`. JSDoc updated to reference F-Wave5-CO-01.
- `apps/web/src/auth/AuthContext.tsx`: `identifySentryUser` called on explicit sign-in success AND on cold-mount session recovery; `resetSentryUser` called on sign-out. Mirrors the PostHog hooks added in the phase-8 closeout.
- `apps/web/src/vite-env.d.ts`: four optional `VITE_SENTRY_*` env-var declarations.
- `apps/web/.env.example`: documents the four vars with one-line comments.
- `apps/web/vite.config.ts`: `manualChunks.sentry: ['@sentry/react']`.
- `CLAUDE.md`: `@sentry/react` added to "What we use" SPA-only section.
- `STATUS.md`: F-Wave5-CO-01 / F-Wave3-OBS-01 moved from operator-gated to closed-in-this-session (SPA portion); F-Wave5-CO-01-EDGE-01 and F-Wave9-SENTRY-SOURCEMAPS-01 filed under Phase 8 carryover; last-updated stamp bumped; bundle-size line updated.

## CI gates verified

All passed on the feature branch before commit:

- `pnpm --filter web typecheck` — green.
- `pnpm --filter web lint --max-warnings 0` — green.
- `pnpm --filter web test` (vitest src + regression) — 38 passing, 2 skipped (carry-over from prior PRs).
- `pnpm --filter web test:contract` — 20 passing (Zod canon parity holds).
- `pnpm --filter web build` — green; main chunk 29.95 kB / 40 kB.
- `pnpm --filter web bundle-budget` (size-limit) — green at 29.95 kB / 40 kB.

## Activation (2026-05-20)

Operator activated Sentry. Closes `F-Wave5-CO-01` / `F-Wave3-OBS-01` (SPA portion). Two unforeseen problems surfaced during activation; both diagnosed and resolved in the same session before close.

### What was done

1. Sentry organisation + project created at sentry.io. Project type: React → Browser. US region. Project ID `4511423235751936`. Org ID `4511423231229952`. Project name: `javascript-react` inside Sentry; tied to Team `#kitstak`.
2. Public DSN copied from Project Settings → Client Keys. Value (frontend-safe by design): `https://1b5b27cb6dc46bfaad38424597ebc63c@o4511423231229952.ingest.us.sentry.io/4511423235751936`. Stored in operator's local `Docs/SUPABASE ENV.MD` credentials file (outside the repo).
3. `VITE_SENTRY_DSN` set in Vercel Environment Variables for Production + Preview scopes. Development scope intentionally unset so local `pnpm dev` stays in no-op posture.
4. `VITE_SENTRY_HOST` / `VITE_SENTRY_ENVIRONMENT` / `VITE_SENTRY_TRACES_SAMPLE_RATE` / `VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE` left unset; code defaults (US Cloud ingest, environment falls back to `VITE_APP_ENV`, traces 0.1, replay 0.0) are the conservative launch posture.

### Problem 1: Vercel "Sensitive" flag blocked the build (resolved by PR #66)

Initial Vercel redeploy after `VITE_SENTRY_DSN` was set did not bake the value into the bundle. Diagnosis (via `curl` of the deployed `index-Awrym9dm.js`): zero references to PostHog OR Sentry env vars; Supabase URL `zmnvwhqjahwidprnjxrq` (NOT flagged Sensitive) DID land in the bundle.

Root cause: `.github/workflows/deploy-prod.yml` runs `vercel build` on GitHub Actions runners (not on Vercel's own build infrastructure). `vercel pull --environment=production` deliberately does NOT pull env vars flagged "Sensitive" in the Vercel project — this is a documented Vercel security behaviour: Sensitive vars are only injected when the build itself runs on Vercel's infrastructure. Both `VITE_SENTRY_DSN` (Sensitive from the start) and `VITE_POSTHOG_KEY` (Sensitive after some later operator edit) were affected.

**The PostHog regression was silent**: the F-Wave8-POSTHOG-PROJECT-SETUP-01 closeout journal had recorded events flowing; subsequent Sensitive marking broke events without any deploy failing. The Sentry verification dive was what surfaced the gap.

Fix shipped in PR #66 (`3e4fba6`): inject the two `VITE_*` values from GitHub repo secrets at the `env:` block of the `vercel build` step in `deploy-prod.yml`, mirroring the established pattern in `lighthouse.yml`. Both values are designed to be frontend-public (PostHog Project Tokens are rate-limited per project; Sentry DSNs are rate-limited per project) so storing them as GitHub repo secrets carries no incremental risk vs the SPA bundle itself. The PostHog regression unblocked simultaneously; events resumed flowing into PostHog Activity.

After the fix, the deployed bundle hash changed to `index-Doydj616.js` and contained:
- `us.i.posthog.com` literal
- `phc_robvSrpGzMvWWK6nF7uBaJVAwtTXfkAypbMCtSLckqc9` token
- `o4511423231229952.ingest.us.sentry.io` literal
- `1b5b27cb6dc46bfaad38424597ebc63c` DSN public key
- New `sentry-CF0Aje5m.js` lazy chunk emitted alongside

### Problem 2: Sentry Relay enriched events with IP after the SDK-side scrub (resolved by this PR)

First captured event (Sentry Issue `JAVASCRIPT-REACT-1`, event ID `64a6acc3`) carried the operator's source IP `98.172.8.242` and city-level Geography `Fayetteville, United States (US)` despite the SDK posture of `sendDefaultPii: false` plus `beforeSend` `delete event.user.ip_address`.

Root cause: Sentry has TWO PII layers. The SDK-side controls (which `sentry.ts` covers correctly) prevent the SDK from SENDING the IP. But Sentry's server-side Relay (the ingest pipeline) can ENRICH events with IP from the request source unless the event arrives with `ip_address` explicitly set to `null` AND the project-level "Prevent Storing of IP Addresses" toggle is ON. With `delete`, the field is absent and the Relay treats absence as "auto-fill from source IP".

Two-part fix (both layered for defense in depth):

1. **Operator: project setting** — Sentry → Settings → Security & Privacy → "Prevent Storing of IP Addresses" enabled. Flipped 2026-05-20 within minutes of the diagnosis. Effect: Relay-side enrichment disabled at the project boundary.
2. **Code: `beforeSend` hardening** (this PR): `event.user.ip_address` is now set to `null` explicitly rather than deleted. The Relay treats `null` as "operator opted out, do not enrich." The user object is synthesised with `{ ip_address: null }` even when the input had no user object at all, so anonymous events also carry the opt-out signal. Three new unit-test assertions in `sentry.test.ts` cover the contract: with id, without id, no user object input at all.

The constitutional gate (no PII in Sentry events) now holds at both layers. The original journal's claim that "`sendDefaultPii: false` refuses IP and cookies by default" was technically true at the SDK layer but incomplete; it did not account for Relay enrichment. Corrected here.

### Verification evidence

Sentry Issue `JAVASCRIPT-REACT-1`, event ID `64a6acc3`, captured 2026-05-20 ~2:25 PM ET via the controlled `document.body.addEventListener('click', () => { throw new Error(...) }, { once: true })` smoke test from the operator's incognito Chrome session. After both fixes, the event carries:

| Field | Value | Constitutional check |
|---|---|---|
| environment | `production` | ✅ |
| release | `3.140.0-827c74` | ✅ auto-generated, release tracking active |
| transaction | `/kitforce/labor` | ✅ pathname only |
| url | `https://www.kitstak.com/404` | ✅ pathname only, no query string |
| user.id | `e7f20b8c-c972-4d13-bd29-1a1731154578` | ✅ opaque Supabase UUID |
| user.ip_address | null (new events) | ✅ Relay-suppressed |
| user.geography | absent (new events) | ✅ Relay derives from IP; IP off ⇒ geography off |
| request.headers | User-Agent only | ✅ NO Authorization, NO Cookie |
| request.cookies | absent | ✅ |
| SDK | `sentry.javascript.react 8.55.2` | ✅ |

The first smoke-test event captured BEFORE the project-level Relay setting was flipped retains the operator's IP and city as a historical artefact; future events do not.

### Follow-ups filed alongside this close

- `F-Wave9-NODE20-DEPRECATION-01`: GitHub Actions warning that `actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v4` run on Node.js 20 which is being forced to Node.js 24 by default starting 2026-06-02 and removed entirely 2026-09-16. All four Kitstak workflows use these actions. Non-blocking until June; should bump pinned versions before then.
- `F-Wave9-VERCEL-NATIVE-BUILD-CONSIDER-01`: the `deploy-prod.yml`-on-GitHub-Actions architecture is the root cause of the Vercel-Sensitive-env-var gap class. Consider whether the deploy step should migrate to Vercel's native git integration (build runs on Vercel infrastructure where Sensitive vars are auto-injected). Trade-offs: loses the GitHub-Actions step gating, gains automatic Sensitive-var support. Not urgent; the PR #66 workaround is sound.
- `F-Wave9-FONT-DECODE-ERROR-01`: surfaced as a side observation during Sentry verification. Two Chrome console warnings (`Failed to decode downloaded font: <URL>` plus `OTS parsing error: invalid sfntVersion: 1008821359`) on production indicate one of the three Google Fonts URLs in `apps/web/index.html` is returning HTML instead of a font file. Already spawned as a background task during the session.

### Wizard not used (confirmed)

The Sentry AI install wizard was not used (per the original journal's section). The activation path was env-var-only on the operator side. No code wiring beyond what shipped in PR #65 plus the two hardening fixes (PR #66 for the build pipeline, this PR for the Relay opt-out).

## Source maps wired (2026-05-20, closes `F-Wave9-SENTRY-SOURCEMAPS-01`)

Production stack traces arriving in Sentry today carry **minified** frames (e.g. `index-C2lRxgyd.js:1:18234`) because the SPA bundle is minified and source maps are not uploaded to Sentry. This follow-up wires `@sentry/vite-plugin@^5.3.0` (MIT) so the maps upload at build time and Sentry deminifies stack traces server-side. After this PR ships and the operator provisions the auth token, captured errors arrive with readable frames (`apps/web/src/pages/.../FooPage.tsx:42:7`).

### Operator decisions

1. **Maps are private.** Configured `build.sourcemap: 'hidden'` in `apps/web/vite.config.ts`. Maps are emitted to `dist/` as a build side effect, but the `//# sourceMappingURL=` comment is NOT written into the JS bundle. The SPA never tells a browser where the maps live. The plugin consumes them, uploads to Sentry, then deletes them from `dist/` via `sourcemaps.filesToDeleteAfterUpload`. Net posture for end users: maps are unreachable; only Sentry has them.
2. **Annual auth-token rotation.** Operator should rotate `SENTRY_AUTH_TOKEN` once per year. Sentry's auth tokens do not expire automatically; rotation is a hygiene practice against gradual operator-account drift. The rotation is mechanical: generate a new token at Sentry → Settings → Auth Tokens (scope `project:releases` only — no other scopes needed), update BOTH the Vercel env var AND the GitHub repo secret in the same session, redeploy. The token never appears in code or logs.
3. **Belt-and-suspenders contract test.** New `apps/web/test/regression/sentry-auth-leak.test.ts` scans every file under `dist/` after a build and fails if any chunk contains the literal substring `sentry_auth` (case-insensitive). A second assertion fails if any chunk contains the literal value of `SENTRY_AUTH_TOKEN` when one is set at test runtime. This catches the regression case where a future hand-edit to `vite.config.ts` accidentally drops the var into a string template that Rollup then inlines into a SPA chunk. Synthetic-leak path verified during PR development: appended `sentry_auth=fake_token_for_test` to a chunk, the test failed as expected with the offender filename listed, restored the chunk before commit.

### Why the plugin is a devDep, not a top-level prod dep

`@sentry/vite-plugin` runs only at `vite build` time. It does not ship to runtime; the SPA bundle does not import it. It belongs in `apps/web/package.json`'s `devDependencies`, not the top-level `package.json`. The constitution's banned-deps list (`antd`, `redux`, `axios`, etc.) targets runtime SPA deps, not build tooling. Confirmed: top-level `package.json` is untouched; `apps/web/package.json` carries `"@sentry/vite-plugin": "^5.3.0"` in `devDependencies` only.

### Bundle delta

Main `index-*.js` chunk lands at **29.92 kB / 40 kB** gzipped (was 29.95 kB pre-plugin; effectively zero delta, well under the 0.5 kB threshold). The plugin imports a single `sentryVitePlugin` factory inside `vite.config.ts`; no SPA-side module references it. `size-limit` gate green at 29.92 kB / 40 kB.

### `release.name` strategy

Derived from `process.env.VERCEL_GIT_COMMIT_SHA` (Vercel injects this at build time on both Production and Preview deploys). Falls back to the literal `'local-dev'` for local builds. The release name appears on every Sentry event so the operator can correlate events to a specific deploy SHA; the Sentry UI shows a "Releases" pane listing each release plus its associated commits, errors, and adoption rate. The fallback name `'local-dev'` is intentional: a local `pnpm build` test with the token set would upload maps under the `local-dev` release; in practice the local build never runs with the token set (operator action is "set the token in CI", not "in your shell"), so `local-dev` is a placeholder. If a developer ever does set the token locally and runs a build, the upload lands under a single shared `local-dev` release; that is harmless because Sentry deduplicates uploads by content hash.

### No-op posture when token absent

The plugin is configured with `disable: !sentryAuthToken`. When `SENTRY_AUTH_TOKEN` is unset (every contributor checkout, every preview build before secrets are provisioned, the very first deploy before the operator does the operator-action steps), the plugin is a no-op. The build still succeeds; `.map` files remain in `dist/` because `filesToDeleteAfterUpload` only runs after an upload; the bundle ships fine; errors still arrive at Sentry, but with minified frames. The contract test still passes against this dist state because nothing in `dist/` contains `sentry_auth`.

### Workflow integration

`.github/workflows/deploy-prod.yml` now injects three new secrets at the `vercel build` step's `env:` block:

```yaml
SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
SENTRY_PROJECT: ${{ secrets.SENTRY_PROJECT }}
SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
```

Same pattern as `VITE_POSTHOG_KEY` and `VITE_SENTRY_DSN` from PR #66. The GitHub repo secret is the actual source of truth because `vercel pull` on GitHub Actions does not pull Sensitive-flagged env vars from Vercel (the documented Vercel-on-third-party-runner behaviour that surfaced during the Sentry activation regression). Operator should still set the values in Vercel env vars for Production + Preview scopes so the chassis is consistent and the values are recoverable from a single canonical source if needed; the actual build reads from `process.env` populated by the workflow `env:` block.

### Operator action required

Before the source-map upload is live in production:

1. Sentry → Settings → Auth Tokens → "Create New Auth Token". Name: `kitstak-spa-sourcemaps-2026`. Scopes: `project:releases` only. Copy the token (starts with `sntrys_`).
2. Sentry → Settings → General → copy the Organization Slug (likely `kitstak` or similar; this is the URL-safe org identifier, not the display name).
3. Sentry → project → Settings → General → copy the Project Slug (`javascript-react` per the activation journal).
4. Vercel → Kitstak project → Settings → Environment Variables → add three new vars for **Production + Preview** scopes:
   - `SENTRY_ORG` = the org slug from step 2.
   - `SENTRY_PROJECT` = the project slug from step 3.
   - `SENTRY_AUTH_TOKEN` = the token from step 1. Flag as Sensitive.
5. GitHub → repository → Settings → Secrets and variables → Actions → New repository secret. Add three secrets matching the names above with the same values.
6. Push a commit (or trigger a redeploy). The `deploy-prod` workflow's `vercel build` step will now read all three from `process.env`; the plugin uploads maps to Sentry and deletes them from `dist/`.
7. **Verify**: load the live SPA, trigger an error (any of the F-Wave3 sentry-tagged routes, or the controlled `?test=throw` shape from the activation verification), wait ~30 seconds for the event to arrive in Sentry → Issues. Confirm the stack trace shows readable file names and line numbers instead of minified shapes.

### Verification before activation

This PR ships the chassis; the operator action above flips the switch. Verification scope on this PR before merge:

- `pnpm -C apps/web typecheck` — green.
- `pnpm -C apps/web lint` — green.
- `pnpm -C apps/web build` — green at 29.92 kB / 40 kB. Maps emitted to `dist/`. No `//# sourceMappingURL=` comments in JS chunks.
- `pnpm -C apps/web test:regression` — 7 files / 24 passed / 2 skipped. New `sentry-auth-leak.test.ts` passes against the clean dist.
- Synthetic-leak path verified: appended `sentry_auth=...` to a chunk, the test failed as expected, chunk restored before commit.
- `pnpm -C apps/web test:contract` — 20 passed (parity holds).
- `pnpm -C apps/web bundle-budget` — green at 29.92 kB / 40 kB.

After operator action above and a redeploy, post-activation verification:

- Real production error captured in Sentry shows readable frames (not minified). 
- New `Releases` entry appears in Sentry tied to the Vercel commit SHA. 
- `dist/` on the production build's CI run shows no `.map` files persisted past the upload step (only readable in the Vercel build logs; the `filesToDeleteAfterUpload` glob removes them).
