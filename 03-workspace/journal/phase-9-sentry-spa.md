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
